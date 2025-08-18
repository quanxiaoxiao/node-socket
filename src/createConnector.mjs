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
};

const DEFAULT_OPTIONS = {
  keepAlive: true,
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
  const { timeout, onConnect, onData, onDrain, onClose, onFinish, onError } = config;

  const state = {
    status: ConnectionState.IDLE,

    isActive: true,
    isConnect: false,
    isDetached: false,
    isSocketDataEventBind: false,
    isConnectActive: false,
    isSocketTimeoutEventBind: false,
    isSocketCloseEventBind: false,
    isSocketFinishEventBind: false,
    isSocketDrainEventBind: false,
    isSocketErrorEventBind: false,
    isSignalEventBind: !!signal,
    outgoingBufList: [],
    incomingBufList: [],
    tickWithError: null,

    events: new Set(),
    timers: new Map(),
  };

  const timer = {
    set: (key, callback, delay) => {
      timer.clear(key);
      state.timers.set(key, setTimeout(callback, delay));
    },

    clear: (key) => {
      const timerId = state.timers.get(key);
      if (timerId) {
        clearTimeout(timerId);
        state.timers.delete(key);
      }
    },

    clearAll: () => {
      state.timers.forEach(timerId => clearTimeout(timerId));
      state.timers.clear();
    },
  };

  const eventManager = {
    bind: (target, event, handler, once = false) => {
      const eventKey = `${target.constructor.name}-${event}`;

      if (state.events.has(eventKey)) return;

      state.events.add(eventKey);
      if (once) {
        target.once(event, handler);
      } else {
        target.on(event, handler);
      }
    },

    unbind: (target, event, handler) => {
      const eventKey = `${target.constructor.name}-${event}`;

      if (!state.events.has(eventKey)) return;

      state.events.delete(eventKey);
      target.off(event, handler);
    },

    unbindAll: () => {
      const socketEvents = ['data', 'drain', 'timeout', 'finish', 'close', 'error'];
      socketEvents.forEach((event) => {
        socket.removeAllListeners(event);
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

    isActive: () => ![ConnectionState.CLOSED, ConnectionState.ERROR, ConnectionState.DETACHED].includes(state.status),
  };

  function removeEventSocketError() {
    if (state.tickWithError) {
      clearTimeout(state.tickWithError);
      state.tickWithError = null;
    }
    if (state.isSocketErrorEventBind) {
      state.tickWithError = setTimeout(() => {
        state.tickWithError = null;
        if (state.isSocketErrorEventBind) {
          state.isSocketErrorEventBind = false;
          // eslint-disable-next-line no-use-before-define
          socket.off('error', handleErrorOnSocket);
        }
      }, 200);
    }
  }

  function unbindEventSignal() {
    if (state.isSignalEventBind) {
      state.isSignalEventBind = false;
      // eslint-disable-next-line no-use-before-define
      signal.removeEventListener('abort', handleAbortOnSignal);
    }
  }

  function unbindSocketCloseEvent() {
    if (state.isSocketCloseEventBind) {
      state.isSocketCloseEventBind = false;
      // eslint-disable-next-line no-use-before-define
      socket.off('close', handleCloseOnSocket);
    }
  }

  function clearSocketEvents() {
    if (state.isSocketFinishEventBind) {
      state.isSocketFinishEventBind = false;
      // eslint-disable-next-line no-use-before-define
      socket.off('finish', handleFinishOnSocket);
    }

    if (state.isSocketDataEventBind) {
      state.isSocketDataEventBind = false;
      // eslint-disable-next-line no-use-before-define
      socket.off('data', handleDataOnSocket);
    }

    if (state.isSocketDrainEventBind) {
      state.isSocketDrainEventBind = false;
      // eslint-disable-next-line no-use-before-define
      socket.off('drain', handleDrainOnSocket);
    }

    if (state.isSocketTimeoutEventBind) {
      state.isSocketTimeoutEventBind = false;
      // eslint-disable-next-line no-use-before-define
      socket.off('timeout', handleTimeoutOnSocket);
    }
  }

  function checkConnectSignalAbort() {
    if (!state.isConnect && !controller.signal.aborted) {
      controller.abort();
    }
  }

  function emitError(error) {
    if (onError) {
      onError(error, state.isConnect);
    } else {
      console.error(error);
    }
  }

  function handleErrorOnSocket(error) {
    checkConnectSignalAbort();
    unbindSocketCloseEvent();
    clearSocketEvents();
    unbindEventSignal();

    if (state.isActive) {
      state.isActive = false;
      if (!state.isDetached && !socket.writableEnded) {
        emitError(error);
      }
    }

    process.nextTick(() => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
  }

  function handleDrainOnSocket() {
    if (!state.isDetached && state.isActive && onDrain) {
      onDrain();
    }
  }

  function handleFinishOnSocket() {
    if (!state.isActive) {
      return;
    }
    unbindSocketCloseEvent();
    clearSocketEvents();
    unbindEventSignal();
    if (onFinish) {
      onFinish();
    }
  }

  async function handleConnectOnSocket() {
    assert(state.isActive);
    assert(state.isConnect);
    assert(!state.isDetached);
    if (onConnect) {
      try {
        await onConnect();
      } catch (error) {
        unbindSocketCloseEvent();
        clearSocketEvents();
        unbindEventSignal();
        if (!socket.destroyed) {
          socket.destroy();
        }
        if (state.isActive) {
          state.isActive = false;
          emitError(error);
        }
      }
    }
    while (state.isActive
      && !socket.writableEnded
      && state.outgoingBufList.length > 0) {
      const chunk = state.outgoingBufList.shift();
      if (chunk.length > 0) {
        socket.write(chunk);
      }
    }
    if (state.isActive && !socket.writableEnded) {
      state.isSocketDataEventBind = true;
      // eslint-disable-next-line no-use-before-define
      socket.on('data', handleDataOnSocket);
      if (timeout != null) {
        socket.setTimeout(timeout);
        state.isSocketTimeoutEventBind = true;
        // eslint-disable-next-line no-use-before-define
        socket.once('timeout', handleTimeoutOnSocket);
      }
      state.isSocketDrainEventBind = true;
      socket.on('drain', handleDrainOnSocket);
      process.nextTick(() => {
        if (state.isActive && !state.isDetached && !socket.writableEnded) {
          state.isConnectActive = true;
          if (socket.isPaused()) {
            socket.resume();
          }
        }
      });
    }
  }

  function handleCloseOnSocket() {
    state.isSocketCloseEventBind = false;
    if (state.isSocketFinishEventBind) {
      clearSocketEvents();
      unbindEventSignal();
      if (state.isActive) {
        state.isActive = false;
        const error = new Error('Socket close error');
        error.code = 'ERR_SOCKET_CLOSE';
        emitError(error);
      }
    } else {
      clearSocketEvents();
      unbindEventSignal();
      const buf = Buffer.concat(state.incomingBufList);
      state.incomingBufList = [];
      if (state.isActive) {
        state.isActive = false;
        try {
          if (onClose) {
            onClose(buf);
          }
        } catch (error) {
          emitError(error);
        }
      }
    }
  }

  function handleTimeoutOnSocket() {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  function handleDataOnSocket(chunk) {
    if (!state.isActive) {
      return;
    }
    if (onData) {
      try {
        const ret = onData(chunk);
        if (ret === false && !socket.isPaused()) {
          socket.pause();
        }
      } catch (error) {
        unbindSocketCloseEvent();
        clearSocketEvents();
        unbindEventSignal();
        if (!socket.destroyed) {
          socket.destroy();
        }
        if (state.isActive) {
          state.isActive = false;
          emitError(error);
        }
      }
    } else {
      state.incomingBufList.push(chunk);
    }
  }

  function connector() {
    if (state.isActive) {
      state.isActive = false;
    }
    checkConnectSignalAbort();
    unbindSocketCloseEvent();
    clearSocketEvents();
    unbindEventSignal();
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  function handleAbortOnSignal() {
    state.isSignalEventBind = false;
    if (state.isActive) {
      state.isActive = false;
      if (!state.isDetached) {
        const error = new Error('abort');
        error.code = 'ABORT_ERR';
        emitError(error);
      }
    }
    connector();
  }

  connector.pause = () => {
    if (!state.isDetached && state.isActive && !socket.isPaused()) {
      socket.pause();
    }
  };
  connector.resume = () => {
    if (!state.isDetached && state.isActive && socket.isPaused()) {
      socket.resume();
    }
  };

  connector.write = (chunk) => {
    assert(state.isActive && !socket.writableEnded);
    assert(!state.isSocketFinishEventBind);
    assert(!state.isDetached);
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
    assert(state.isActive && !socket.writableEnded);
    assert(!state.isSocketFinishEventBind);
    assert(!state.isDetached);
    if (!state.isConnect) {
      state.isActive = false;
      checkConnectSignalAbort();
      unbindEventSignal();
      if (!socket.destroyed) {
        socket.destroy();
      }
      emitError(new Error('socket not connect'));
    } else {
      clearSocketEvents();
      unbindEventSignal();
      const bufList = [...state.outgoingBufList];
      state.outgoingBufList = [];
      if (chunk && chunk.length > 0) {
        bufList.push(chunk);
      }
      const buf = Buffer.concat(bufList);
      socket.once('finish', handleFinishOnSocket);
      state.isSocketFinishEventBind = true;
      if (buf.length > 0) {
        socket.end(buf);
      } else {
        socket.end();
      }
    }
  };

  connector.detach = () => {
    if (!state.isActive || socket.writableEnded || state.isDetached) {
      return null;
    }
    if (!state.isConnect) {
      connector();
      return null;
    }
    state.isDetached = true;
    unbindSocketCloseEvent();
    clearSocketEvents();
    unbindEventSignal();
    if (timeout != null) {
      socket.setTimeout(0);
    }
    removeEventSocketError();
    return socket;
  };

  function establishConnection() {
    state.isConnect = true;
    state.isSocketErrorEventBind = true;
    state.isSocketCloseEventBind = true;
    socket
      .on('error', handleErrorOnSocket)
      .once('close', handleCloseOnSocket);

    if (config.keepAlive && socket.setKeepAlive) {
      socket.setKeepAlive(true, config.keepAliveInitialDelay);
    }

    process.nextTick(() => {
      if (!state.isDetached && state.isActive) {
        handleConnectOnSocket();
      }
    });
  }

  if (socket.readyState === 'opening') {
    waitConnect(socket, config.connectTimeout, controller.signal)
      .then(() => {
        assert(state.isActive);
        if (!state.isDetached) {
          establishConnection();
        }
      })
      .catch((error) => {
        unbindEventSignal();
        if (!socket.destroyed) {
          socket.destroy();
        }
        if (state.isActive) {
          state.isActive = false;
          if (!controller.signal.aborted) {
            emitError(error);
          }
        }
      });

  } else {
    establishConnection();
  }

  if (signal) {
    state.isSignalEventBind = true;
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }

  connector.socket = socket;

  connector.getState = () => ({ ...state, status: state.status });

  return connector;
};

export default createConnector;
