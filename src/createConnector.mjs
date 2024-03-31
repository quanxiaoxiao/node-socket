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
    isDataEventBind: false,
    isConnectActive: false,
    isTimeoutEventBind: false,
    isConnectEventBind: false,
    isErrorEventBind: true,
    isCloseEventBind: false,
    isSocketFinishBind: false,
    isDrainEventBind: false,
    isSignalEventBind: !!signal,
    outgoingBufList: [],
    incomingBufList: [],
  };

  function unbindSignalEvent() {
    if (state.isSignalEventBind) {
      state.isSignalEventBind = false;
      signal.removeEventListener('abort', handleAbortOnSignal);
    }
  }

  function unbindSocketError() {
    if (state.isErrorEventBind) {
      setTimeout(() => {
        if (state.isErrorEventBind) {
          state.isErrorEventBind = false;
          socket.off('error', handleErrorOnSocket);
        }
      }, 100);
    }
  }

  function clearEventListeners() {
    if (state.isConnectEventBind) {
      state.isConnectEventBind = false;
      socket.off('connect', handleConnectOnSocket);
    }
    if (state.isDataEventBind) {
      state.isDataEventBind = false;
      socket.off('data', handleDataOnSocket);
    }
    if (state.isCloseEventBind) {
      state.isCloseEventBind = false;
      socket.off('close', handleCloseOnSocket);
    }
    if (state.isDrainEventBind) {
      state.isDataEventBind = false;
      socket.off('drain', handleDrainOnSocket);
    }
    if (state.isTimeoutEventBind) {
      state.isTimeoutEventBind = false;
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
    state.isErrorEventBind = false;
    clearEventListeners();
    unbindSignalEvent();
    if (state.isActive) {
      state.isActive = false;
      if (!state.isSocketFinishBind) {
        emitError(error);
      }
    }
    if (state.isSocketFinishBind) {
      state.isSocketFinishBind = false;
      socket.off('finish', handleSocketFinish);
    }
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  function handleDrainOnSocket() {
    assert(state.isActive);
    if (onDrain) {
      onDrain();
    }
  }

  async function handleConnectOnSocket() {
    assert(state.isActive);
    assert(!state.isConnect);
    if (state.isConnectEventBind) {
      state.isConnectEventBind = false;
    }
    if (!state.isCloseEventBind) {
      state.isCloseEventBind = true;
      socket.once('close', handleCloseOnSocket);
    }
    state.isConnect = true;
    if (onConnect) {
      try {
        await onConnect();
      } catch (error) {
        clearEventListeners();
        unbindSignalEvent();
        if (!socket.destroyed) {
          socket.destroy();
        }
        unbindSocketError();
        if (state.isActive) {
          state.isActive = false;
          emitError(error);
        }
      }
    }
    if (state.isActive && !state.isSocketFinishBind) {
      state.isDataEventBind = true;
      socket.on('data', handleDataOnSocket);
      if (timeout != null) {
        socket.setTimeout(timeout);
        state.isTimeoutEventBind = true;
        socket.once('timeout', handleTimeoutOnSocket);
      }
      state.isDrainEventBind = true;
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
    assert(state.isActive);
    state.isCloseEventBind = false;
    clearEventListeners();
    unbindSignalEvent();
    unbindSocketError();
    const buf = Buffer.concat(state.incomingBufList);
    state.incomingBufList = [];
    state.isActive = false;
    if (onClose) {
      try {
        onClose(buf);
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

  function pause() {
    if (state.isActive && !socket.isPaused()) {
      socket.pause();
    }
  }

  function resume() {
    if (state.isActive && socket.isPaused()) {
      socket.resume();
    }
  }

  function handleDataOnSocket(chunk) {
    assert(state.isActive);
    if (onData) {
      try {
        if (onData(chunk) === false) {
          pause();
        }
      } catch (error) {
        clearEventListeners();
        unbindSignalEvent();
        if (!socket.destroyed) {
          socket.destroy();
        }
        unbindSocketError();
        if (state.isActive) {
          state.isActive = false;
          emitError(error);
        }
      }
    } else {
      state.incomingBufList.push(chunk);
    }
  }

  function handleSocketFinish() {
    state.isSocketFinishBind = false;
    if (state.isErrorEventBind) {
      state.isErrorEventBind = false;
      socket.off('error', handleErrorOnSocket);
    }
  }

  function connector() {
    if (state.isActive) {
      state.isActive = false;
      clearEventListeners();
      unbindSignalEvent();
      if (state.isErrorEventBind) {
        state.isErrorEventBind = false;
        socket.off('error', handleErrorOnSocket);
      }
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
  }

  function handleAbortOnSignal() {
    state.isSignalEventBind = false;
    connector();
  }

  connector.pause = pause;
  connector.resume = resume;

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
      clearEventListeners();
      unbindSignalEvent();
      state.isSocketFinishBind = true;
      socket.once('finish', handleSocketFinish);
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
    clearEventListeners();
    unbindSignalEvent();
    state.isErrorEventBind = false;
    socket.off('error', handleErrorOnSocket);
    return socket;
  };

  socket.once('error', handleErrorOnSocket);

  if (socket.connecting) {
    state.isConnectEventBind = true;
    socket.once('connect', handleConnectOnSocket);
  } else {
    state.isCloseEventBind = true;
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
