import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import process from 'node:process';

import waitConnect from './waitConnect.mjs';

const ConnectionState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',

  DETACHED: 'detached',
  CLOSED: 'closed',
  ERROR: 'error',
  DESTROYED: 'destroyed',
};

const DEFAULT_OPTIONS = {
  keepAlive: false,
  keepAliveInitialDelay: 60_000,
  connectTimeout: 10_000,
  errorCleanupDelay: 200,
};

const createConnector = (
  options,
  getConnect,
  signal,
) => {
  assert(typeof getConnect === 'function', 'getConnect must be a function');

  if (signal) {
    assert(!signal.aborted, 'AbortSignal is already aborted');
  }

  const controller = new AbortController();

  const socket = getConnect();

  assert(socket, 'Socket is required');
  assert(!socket.destroyed, 'Socket is already destroyed');
  assert(socket.writable && socket.readable, 'Socket must be readable and writable');

  const config = { ...DEFAULT_OPTIONS, ...options };
  const {
    timeout,
    onConnect,
    onData,
    onDrain,
    onClose,
    onFinish,
    onError,
  } = config;

  const state = {
    status: ConnectionState.IDLE,

    isConnectActive: false,
    isErrorEmit: false,
    outgoingBufList: [],
    incomingBufList: [],

    events: new Map(),
    timers: new Map(),
  };

  const eventManager = {
    bind: (target, event, handler, once = false) => {
      if (state.events.has(event)) return;

      const eventHandler = (...args) => {
        if (once && state.events.has(event)) {
          state.events.delete(event);
        }
        handler(...args);
      };

      state.events.set(event, eventHandler);
      if (once) {
        target.once(event, eventHandler);
      } else {
        target.on(event, eventHandler);
      }
    },

    unbind: (target, event) => {
      const eventHandler = state.events.get(event);
      if (eventHandler) {
        target.off(event, eventHandler);
        state.events.delete(event);
      }
    },

    unbindAll: () => {
      const socketEvents = ['data', 'drain', 'timeout', 'finish', 'close'];
      socketEvents.forEach((event) => {
        const eventHandler = state.events.get(event);
        if (eventHandler) {
          socket.off(event, eventHandler);
        }
      });

      if (signal) {
        // eslint-disable-next-line no-use-before-define
        signal.removeEventListener('abort', handleAbortOnSignal);
      }

      state.events.clear();
    },
  };

  const stateManager = {
    is: (status) => state.status === status,

    canTransitionTo: (newStatus) => {
      const validTransitions = {
        [ConnectionState.IDLE]: [ConnectionState.CONNECTING, ConnectionState.ERROR, ConnectionState.CLOSED],
        [ConnectionState.CONNECTING]: [ConnectionState.CONNECTED, ConnectionState.ERROR, ConnectionState.CLOSED],
        [ConnectionState.CONNECTED]: [ConnectionState.DETACHED, ConnectionState.ERROR, ConnectionState.CLOSED],
        [ConnectionState.DETACHED]: [ConnectionState.CLOSED],
        [ConnectionState.ERROR]: [ConnectionState.CLOSED],
        [ConnectionState.CLOSED]: [],
      };

      return validTransitions[state.status]?.includes(newStatus) || false;
    },

    transition: (newStatus) => {
      if (stateManager.canTransitionTo(newStatus)) {
        state.status = newStatus;
        return true;
      }
      return false;
    },

    isActive: () => ![
      ConnectionState.CLOSED,
      ConnectionState.DESTROYED,
      ConnectionState.ERROR,
      ConnectionState.DETACHED,
    ].includes(state.status),
  };

  const isDetached = () => stateManager.is(ConnectionState.DETACHED);

  const emitError = (error) => {
    if (state.isErrorEmit) {
      return;
    }
    state.isErrorEmit = true;
    if (!controller.signal.aborted) {
      controller.abort();
    }
    if (onError) {
      if (!isDetached()) {
        onError(error);
      }
    } else {
      console.error('Connector Error:', error);
    }
  };

  const safeExecute = async (callback, ...args) => {
    if (!callback || typeof callback !== 'function') {
      return;
    }

    try {
      const result = callback(...args);
      if (result && typeof result.then === 'function') {
        await result;
      }
      return result; // eslint-disable-line consistent-return
    } catch (error) {
      emitError(error);
      throw error;
    }
  };

  const cleanup = (shouldDestroySocket = true) => {
    eventManager.unbindAll();

    if (shouldDestroySocket && !socket.destroyed) {
      process.nextTick(() => socket.destroy());
    }

    state.outgoingBufList.length = 0;
    state.outgoingBufList.length = 0;
  };

  const handleErrorOnSocket = (error) => {
    if (isDetached() || stateManager.is(ConnectionState.ERROR)) return;

    stateManager.transition(ConnectionState.ERROR);
    cleanup(true);
    if (!socket.writableEnded) {
      emitError(error);
    }
  };

  const handleDrainOnSocket = () => {
    if (!isDetached() && stateManager.isActive()) {
      safeExecute(onDrain);
    }
  };

  const handleFinishOnSocket = () => {
    if (!stateManager.isActive()) return;
    cleanup(false);
    safeExecute(onFinish);
  };

  const handleDataOnSocket = async (chunk) => {
    if (!stateManager.isActive()) return;

    if (onData) {
      try {
        const result = await safeExecute(onData, chunk);
        if (result === false && !socket.isPaused()) {
          socket.pause();
        }
      } catch (error) {
        stateManager.transition(ConnectionState.ERROR);
        cleanup(true);
      }
    } else {
      state.incomingBufList.push(chunk);
    }
  };

  const handleTimeoutOnSocket = () => {
    if (!socket.destroyed) {
      socket.destroy();
    }
  };

  const handleConnection = async () => {
    if (!stateManager.is(ConnectionState.CONNECTING)) {
      return;
    }

    try {
      stateManager.transition(ConnectionState.CONNECTED);
      await safeExecute(onConnect);
      while (stateManager.isActive()
        && !socket.writableEnded
        && state.outgoingBufList.length > 0) {
        const chunk = state.outgoingBufList.shift();
        if (chunk?.length > 0) {
          socket.write(chunk);
        }
      }
      if (!stateManager.isActive() || socket.writableEnded) return;
      eventManager.bind(socket, 'data', handleDataOnSocket);
      eventManager.bind(socket, 'drain', handleDrainOnSocket);
      if (timeout != null) {
        socket.setTimeout(timeout);
        eventManager.bind(socket, 'timeout', handleTimeoutOnSocket, true);
      }
      process.nextTick(() => {
        if (stateManager.isActive() && !isDetached() && !socket.writableEnded) {
          state.isConnectActive = true;
          if (socket.isPaused()) {
            socket.resume();
          }
        }
      });
    } catch (error) {
      cleanup(true);
      if (stateManager.isActive()) {
        stateManager.transition(ConnectionState.ERROR);
        emitError(error);
      }
    }
  };

  const handleCloseOnSocket = async () => {
    if (stateManager.is(ConnectionState.CLOSED)) return;

    const wasFinishing = state.events.has('finish');
    cleanup(false);

    if (wasFinishing) {
      if (stateManager.isActive()) {
        stateManager.transition(ConnectionState.ERROR);
        const error = new Error('Socket closed unexpectedly');
        error.code = 'ERR_SOCKET_CLOSE';
        emitError(error);
      }
    } else {
      const bufferedData = Buffer.concat(state.incomingBufList);
      state.incomingBufList.length = 0;

      if (stateManager.isActive()) {
        stateManager.transition(ConnectionState.CLOSED);
        try {
          await safeExecute(onClose, bufferedData);
        } catch (error) {
          stateManager.transition(ConnectionState.ERROR);
          cleanup(true);
        }
      }
    }
  };

  function handleAbortOnSignal() {
    if (!stateManager.isActive()) return;

    stateManager.transition(ConnectionState.ERROR);

    if (!isDetached()) {
      const error = new Error('Operation aborted');
      error.code = 'ABORT_ERR';
      emitError(error);
    }

    if (!controller.signal.aborted) {
      controller.abort();
    }

    cleanup(true);
  }

  const establishConnection = () => {
    if (!stateManager.transition(ConnectionState.CONNECTING)) {
      return;
    }

    socket.on('error', handleErrorOnSocket);
    eventManager.bind(socket, 'close', handleCloseOnSocket, true);

    if (config.keepAlive && config.keepAliveInitialDelay) {
      socket.setKeepAlive(true, config.keepAliveInitialDelay);
    }

    process.nextTick(() => {
      if (!isDetached() && stateManager.isActive()) {
        handleConnection();
      }
    });
  };

  function connector() {
    if (stateManager.isActive()) {
      stateManager.transition(ConnectionState.DESTROYED);
    }
    if (!controller.signal.aborted) {
      controller.abort();
    }
    cleanup(true);
  }

  connector.pause = () => {
    if (!isDetached()
      && stateManager.isActive()
      && !socket.isPaused()) {
      socket.pause();
    }
  };
  connector.resume = () => {
    if (!isDetached()
      && stateManager.isActive()
      && socket.isPaused()) {
      socket.resume();
    }
  };

  connector.write = (chunk) => {
    assert(stateManager.isActive() && !socket.writableEnded, 'Cannot write to inactive or ended socket');
    assert(!isDetached(), 'Cannot write to detached socket');
    if (!state.isConnectActive) {
      state.outgoingBufList.push(chunk);
      return false;
    }
    if (socket.writable) {
      return socket.write(chunk);
    }
    return false;
  };

  connector.end = (chunk) => {
    assert(stateManager.isActive() && !socket.writableEnded, 'Cannot end inactive or ended socket');
    assert(!isDetached(), 'Cannot end detached socket');
    if (!stateManager.is(ConnectionState.CONNECTED)) {
      stateManager.transition(ConnectionState.ERROR);
      cleanup(true);
      emitError(new Error('socket not connect'));
      return;
    }
    const dataToSend = [...state.outgoingBufList];
    state.outgoingBufList.length = 0;
    if (chunk?.length > 0) {
      dataToSend.push(chunk);
    }
    eventManager.bind(socket, 'finish', handleFinishOnSocket, true);
    eventManager.unbind(socket, 'data');
    eventManager.unbind(socket, 'drain');
    const finalData = Buffer.concat(dataToSend);
    if (finalData.length > 0) {
      socket.end(finalData);
    } else {
      socket.end();
    }
  };

  connector.detach = () => {
    if (!stateManager.isActive()
      || socket.writableEnded
      || isDetached()) {
      return null;
    }
    if (!stateManager.is(ConnectionState.CONNECTED)) {
      connector();
      return null;
    }
    stateManager.transition(ConnectionState.DETACHED);

    eventManager.unbindAll();

    if (timeout != null) {
      socket.setTimeout(0);
    }
    setTimeout(() => {
      socket.off('error', handleErrorOnSocket);
    }, config.errorCleanupDelay);
    return socket;
  };

  if (socket.readyState === 'opening') {
    waitConnect(socket, config.connectTimeout, controller.signal)
      .then(() => {
        if (stateManager.isActive() && !isDetached()) {
          establishConnection();
        }
      })
      .catch((error) => {
        cleanup(true);
        if (stateManager.isActive() && !controller.signal.aborted) {
          stateManager.transition(ConnectionState.ERROR);
          emitError(error);
        }
      });

  } else {
    establishConnection();
  }

  if (signal) {
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }

  connector.socket = socket;

  connector.getState = () => ({ ...state, status: state.status });

  return connector;
};

export default createConnector;
