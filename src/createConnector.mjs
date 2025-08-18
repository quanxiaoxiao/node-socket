import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import process from 'node:process';

import waitConnect from './waitConnect.mjs';

const createConnector = (
  options,
  getConnect,
  signal,
) => {
  assert(typeof getConnect === 'function');

  if (signal) {
    assert(!signal.aborted);
  }

  const controller = new AbortController();

  const socket = getConnect();

  assert(socket, 'Socket is required');
  assert(!socket.destroyed, 'Socket is already destroyed');
  assert(socket.writable && socket.readable, 'Socket must be readable and writable');

  const {
    timeout,
    onConnect,
    onData,
    onDrain,
    onClose,
    onFinish,
    onError,
    keepAlive = true,
    keepAliveInitialDelay = 1000 * 60,
  } = options;

  const state = {
    isActive: true,
    isConnect: false,
    isDetach: false,
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
      if (!state.isDetach && !socket.writableEnded) {
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
    if (!state.isDetach && state.isActive && onDrain) {
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
    assert(!state.isDetach);
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
        if (state.isActive && !state.isDetach && !socket.writableEnded) {
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
      if (!state.isDetach) {
        const error = new Error('abort');
        error.code = 'ABORT_ERR';
        emitError(error);
      }
    }
    connector();
  }

  connector.pause = () => {
    if (!state.isDetach && state.isActive && !socket.isPaused()) {
      socket.pause();
    }
  };
  connector.resume = () => {
    if (!state.isDetach && state.isActive && socket.isPaused()) {
      socket.resume();
    }
  };

  connector.write = (chunk) => {
    assert(state.isActive && !socket.writableEnded);
    assert(!state.isSocketFinishEventBind);
    assert(!state.isDetach);
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
    assert(!state.isDetach);
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
    if (!state.isActive || socket.writableEnded || state.isDetach) {
      return null;
    }
    if (!state.isConnect) {
      connector();
      return null;
    }
    state.isDetach = true;
    unbindSocketCloseEvent();
    clearSocketEvents();
    unbindEventSignal();
    if (timeout != null) {
      socket.setTimeout(0);
    }
    removeEventSocketError();
    return socket;
  };

  function doConnect() {
    state.isConnect = true;
    state.isSocketErrorEventBind = true;
    state.isSocketCloseEventBind = true;
    socket
      .on('error', handleErrorOnSocket)
      .once('close', handleCloseOnSocket);

    if (keepAlive && socket.setKeepAlive) {
      socket.setKeepAlive(true, keepAliveInitialDelay);
    }

    process.nextTick(() => {
      if (!state.isDetach && state.isActive) {
        handleConnectOnSocket();
      }
    });
  }

  if (socket.readyState === 'opening') {
    waitConnect(socket, 1000 * 10, controller.signal)
      .then(
        () => {
          assert(state.isActive);
          if (!state.isDetach) {
            doConnect();
          }
        },
        (error) => {
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
        },
      );

  } else {
    doConnect();
  }

  if (signal) {
    state.isSignalEventBind = true;
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }

  connector.socket = socket;

  return connector;
};

export default createConnector;
