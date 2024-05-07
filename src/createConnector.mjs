/* eslint no-use-before-define: 0 */
import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const createConnector = (
  options,
  getConnect,
  signal,
) => {
  assert(typeof getConnect === 'function');

  if (signal) {
    assert(!signal.aborted);
  }

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
    isConnect: false,
    isDetach: false,
    isActive: true,
    isSocketDataEventBind: false,
    isConnectActive: false,
    isSocketTimeoutEventBind: false,
    isSocketConnectEventBind: false,
    isSocketErrorEventBind: true,
    isSocketCloseEventBind: false,
    isSocketFinishBind: false,
    isSocketDrainEventBind: false,
    isSignalEventBind: !!signal,
    outgoingBufList: [],
    incomingBufList: [],
    tickOnUnbindError: null,
  };

  function unbindEventSignal() {
    if (state.isSignalEventBind) {
      state.isSignalEventBind = false;
      signal.removeEventListener('abort', handleAbortOnSignal);
    }
  }

  function unbindEventSocketError() {
    if (state.isSocketErrorEventBind) {
      if (state.tickOnUnbindError) {
        clearTimeout(state.tickOnUnbindError);
      }
      state.tickOnUnbindError = setTimeout(() => {
        state.tickOnUnbindError = null;
        if (state.isSocketErrorEventBind) {
          state.isSocketErrorEventBind = false;
          socket.off('error', handleErrorOnSocket);
        }
      }, 150);
    }
  }

  function clearSocketEvents() {
    if (state.isSocketConnectEventBind) {
      state.isSocketConnectEventBind = false;
      socket.off('connect', handleConnectOnSocket);
    }
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

  function emitError(error) {
    if (onError) {
      onError(error, state.isConnect);
    } else {
      console.error(error);
    }
  }

  function handleErrorOnSocket(error) {
    clearSocketEvents();
    unbindEventSignal();
    if (state.isActive) {
      state.isActive = false;
      if (!state.isSocketFinishBind && !state.isDetach) {
        emitError(error);
      }
    }
    if (state.isSocketFinishBind) {
      state.isSocketFinishBind = false;
      socket.off('finish', handleFinishOnSocket);
    }
    if (!socket.destroyed) {
      socket.destroy();
    }
    unbindEventSocketError();
  }

  function handleDrainOnSocket() {
    if (state.isActive && onDrain) {
      onDrain();
    }
  }

  async function handleConnectOnSocket() {
    assert(state.isActive);
    assert(!state.isConnect);
    if (state.isSocketConnectEventBind) {
      state.isSocketConnectEventBind = false;
    }
    if (!state.isSocketCloseEventBind) {
      state.isSocketCloseEventBind = true;
      socket.once('close', handleCloseOnSocket);
    }
    state.isConnect = true;
    if (onConnect) {
      try {
        await onConnect();
      } catch (error) {
        clearSocketEvents();
        unbindEventSignal();
        if (!socket.destroyed) {
          socket.destroy();
        }
        unbindEventSocketError();
        if (state.isActive) {
          state.isActive = false;
          emitError(error);
        }
      }
    }
    if (state.isActive && !state.isSocketFinishBind) {
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
        if (state.isActive) {
          state.isConnectActive = true;
          if (socket.isPaused()) {
            socket.resume();
          }
        }
      });
    }
    while (state.isActive && state.outgoingBufList.length > 0) {
      const chunk = state.outgoingBufList.shift();
      if (chunk.length > 0) {
        socket.write(chunk);
      }
    }
  }

  function handleCloseOnSocket() {
    state.isSocketCloseEventBind = false;
    clearSocketEvents();
    unbindEventSignal();
    unbindEventSocketError();
    const buf = Buffer.concat(state.incomingBufList);
    state.incomingBufList = [];
    if (state.isActive) {
      state.isActive = false;
      if (onClose) {
        try {
          onClose(buf);
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
          unbindEventSocketError();
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

  function handleFinishOnSocket() {
    state.isSocketFinishBind = false;
    unbindEventSocketError();
  }

  function connector() {
    if (state.isActive) {
      state.isActive = false;
    }
    unbindEventSignal();
    clearSocketEvents();
    if (!socket.destroyed) {
      socket.destroy();
    }
    unbindEventSocketError();
  }

  function handleAbortOnSignal() {
    state.isSignalEventBind = false;
    connector();
  }

  connector.pause = () => {
    if (state.isActive && !socket.isPaused()) {
      socket.pause();
    }
  };
  connector.resume = () => {
    if (state.isActive && socket.isPaused()) {
      socket.resume();
    }
  };

  connector.write = (chunk) => {
    assert(state.isActive && !state.isSocketFinishBind);
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
    assert(state.isActive && !state.isSocketFinishBind && !socket.writableEnded);
    if (!state.isConnect) {
      connector();
      emitError(new Error('end fail, socket is not connect'));
    } else {
      clearSocketEvents();
      unbindEventSignal();
      state.isSocketFinishBind = true;
      socket.once('finish', handleFinishOnSocket);
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
    if (!state.isActive || state.isSocketFinishBind || state.isDetach) {
      return null;
    }
    state.isDetach = true;
    clearSocketEvents();
    unbindEventSignal();
    unbindEventSocketError();
    if (timeout != null) {
      socket.setTimeout(0);
    }
    return socket;
  };

  socket.on('error', handleErrorOnSocket);

  if (socket.connecting) {
    state.isSocketConnectEventBind = true;
    socket.once('connect', handleConnectOnSocket);
  } else {
    state.isSocketCloseEventBind = true;
    socket.once('close', handleCloseOnSocket);
    process.nextTick(() => {
      if (!state.isDetach && state.isActive) {
        handleConnectOnSocket();
      }
    });
  }

  if (signal) {
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }

  return connector;
};

export default createConnector;
