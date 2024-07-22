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

  assert(socket);
  assert(!socket.destroyed);
  assert(socket.writable && socket.readable);

  const {
    timeout,
    onConnect,
    onData,
    onDrain,
    onClose,
    onError,
  } = options;

  const state = {
    isActive: true,
    isConnect: false,
    isDetach: false,
    isSocketDataEventBind: false,
    isConnectActive: false,
    isSocketTimeoutEventBind: false,
    isSocketCloseEventBind: false,
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
          socket.off('error', handleErrorOnSocket);
        }
      }, 200);
    }
  }

  function unbindEventSignal() {
    if (state.isSignalEventBind) {
      state.isSignalEventBind = false;
      signal.removeEventListener('abort', handleAbortOnSignal);
    }
  }

  function clearSocketEvents() {
    if (state.isSocketCloseEventBind) {
      state.isSocketCloseEventBind = false;
      socket.off('close', handleCloseOnSocket);
    }

    if (state.isSocketDataEventBind) {
      state.isSocketDataEventBind = false;
      socket.off('data', handleDataOnSocket);
    }

    if (state.isSocketDrainEventBind) {
      state.isSocketDrainEventBind = false;
      socket.off('drain', handleDrainOnSocket);
    }
    if (state.isSocketTimeoutEventBind) {
      state.isSocketTimeoutEventBind = false;
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
      removeEventSocketError();
    });
  }

  function handleDrainOnSocket() {
    if (!state.isDetach && state.isActive && onDrain) {
      onDrain();
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
      socket.on('data', handleDataOnSocket);
      if (timeout != null) {
        socket.setTimeout(timeout);
        state.isSocketTimeoutEventBind = true;
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

  function handleTimeoutOnSocket() {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  function handleDataOnSocket(chunk) {
    if (state.isActive) {
      if (onData) {
        try {
          const ret = onData(chunk);
          if (ret === false && !socket.isPaused()) {
            socket.pause();
          }
        } catch (error) {
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
  }

  function connector() {
    checkConnectSignalAbort();
    if (state.isActive) {
      state.isActive = false;
    }
    unbindEventSignal();
    clearSocketEvents();
    if (!socket.destroyed) {
      socket.destroy();
    }
    removeEventSocketError();
  }

  function handleAbortOnSignal() {
    state.isSignalEventBind = false;
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
    assert(!state.isDetach);
    if (!state.isConnect) {
      state.isActive = false;
      checkConnectSignalAbort();
      unbindEventSignal();
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
    socket.on('error', handleErrorOnSocket);
    socket.once('close', handleCloseOnSocket);
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
          assert(state.isActive && !state.isDetach);
          doConnect();
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

  return connector;
};

export default createConnector;
