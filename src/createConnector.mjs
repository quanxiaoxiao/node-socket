/* eslint no-use-before-define: 0 */
import assert from 'node:assert';

// net.Socket.CONNECTING -> net.Socket.OPEN -> net.Socket.CLOSED

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

  assert(typeof onData === 'function');

  const state = {
    isConnectActive: false,
    isActive: true,
    isConnectEventBind: false,
    isEndEmit: false,
    isErrorEventBind: true,
    isEndEventBind: false,
    isEventsClear: false,
    isSignalEventBind: false,
    socket,
    outgoingBufList: [],
  };

  function emitError(error) {
    const err = typeof error === 'string' ? new Error(error) : error;
    if (onError) {
      onError(err);
    } else {
      console.error(err);
    }
  }

  function clearEventsListener() {
    if (!state.isEventsClear) {
      state.isEventsClear = true;
      if (state.isConnectEventBind) {
        socket.off('connect', handleConnect);
      } else {
        socket.off('close', handleClose);
      }
      if (state.isConnectActive) {
        socket.off('data', handleData);
        socket.off('drain', handleDrain);
        if (timeout != null) {
          socket.off('timeout', handleTimeout);
        }
      }
    }
  }

  function handleError(error) {
    if (state.isConnectEventBind) {
      state.isConnectEventBind = false;
      socket.off('connect', handleConnect);
    }
    state.isErrorEventBind = false;
    if (state.isEndEventBind) {
      if (!state.isEndEmit) {
        socket.off('end', handleSocketEnd);
      }
    } else {
      clearEventsListener();
    }
    if (doClose()) {
      emitError(error);
    }
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  function handleDrain() {
    assert(state.isActive);
    if (onDrain) {
      onDrain();
    } else {
      resume();
    }
  }

  async function handleConnect() {
    if (state.isConnectEventBind) {
      state.isConnectEventBind = false;
      if (state.isActive) {
        socket.once('close', handleClose);
      }
    }
    if (!state.isActive) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    } else {
      if (onConnect) {
        try {
          await onConnect();
        } catch (error) {
          clearEventsListener();
          if (!socket.destroyed) {
            socket.destroy();
          }
          unbindSocketError();
          if (doClose()) {
            emitError(error);
          }
        }
      }
      if (state.isActive) {
        state.isConnectActive = true;
        socket.on('data', handleData);
        if (timeout != null) {
          assert(typeof timeout === 'number' && timeout >= 0);
          socket.setTimeout(timeout);
          socket.once('timeout', handleTimeout);
        }
        socket.on('drain', handleDrain);
        process.nextTick(() => {
          if (state.isActive && socket.isPaused()) {
            socket.resume();
          }
        });
      }
      while (state.isActive
          && state.outgoingBufList.length > 0
      ) {
        const chunk = state.outgoingBufList.shift();
        if (chunk.length > 0) {
          socket.write(chunk);
        }
      }
    }
  }

  function handleClose() {
    if (!state.isEventsClear) {
      state.isEventsClear = true;
      if (state.isConnectActive) {
        socket.off('data', handleData);
        socket.off('drain', handleDrain);
        if (timeout != null) {
          socket.off('timeout', handleTimeout);
        }
      }
    }
    if (doClose() && onClose) {
      onClose();
    }
    unbindSocketError();
  }

  function handleTimeout() {
    state.isEventsClear = true;
    socket.off('data', handleData);
    socket.off('drain', handleDrain);
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  function pause() {
    if (state.isActive
      && state.isConnectActive
      && !socket.isPaused()) {
      socket.pause();
    }
  }

  function resume() {
    if (state.isActive
      && state.isConnectActive
      && socket.isPaused()) {
      socket.resume();
    }
  }

  function doClose() {
    if (state.isSignalEventBind) {
      state.isSignalEventBind = false;
      signal.removeEventListener('abort', handleAbortOnSignal);
    }
    if (state.isActive) {
      state.isActive = false;
      return true;
    }
    return false;
  }

  function handleData(chunk) {
    assert(state.isActive);
    try {
      if (onData(chunk) === false) {
        pause();
      }
    } catch (error) {
      clearEventsListener();
      if (doClose()) {
        emitError(error);
      }
      if (!socket.destroyed) {
        socket.destroy();
      }
      unbindSocketError();
    }
  }

  function unbindSocketError() {
    if (state.isErrorEventBind) {
      setTimeout(() => {
        if (state.isErrorEventBind) {
          state.isErrorEventBind = false;
          socket.off('error', handleError);
        }
      }, 100);
    }
  }

  function handleSocketEnd() {
    state.isEndEmit = true;
    unbindSocketError();
  }

  function connector() {
    if (!state.isEndEventBind) {
      clearEventsListener();
      doClose();
      if (!socket.destroyed) {
        socket.destroy();
      }
      unbindSocketError();
    }
  }

  function handleAbortOnSignal() {
    state.isSignalEventBind = false;
    connector();
  }

  connector.pause = pause;
  connector.resume = resume;

  connector.write = (chunk) => {
    assert(state.isActive);
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
    assert(state.isActive && !state.isEndEventBind);
    if (!state.isConnectActive) {
      connector();
      emitError(new Error('socket is not connect'));
    } else {
      clearEventsListener();
      doClose();
      if (socket.writable) {
        state.isEndEventBind = true;
        socket.once('end', handleSocketEnd);
        if (chunk && chunk.length > 0) {
          socket.end(chunk);
        } else {
          socket.end();
        }
      } else if (!socket.destroyed) {
        socket.destroy();
      }
    }
  };

  socket.once('error', handleError);

  if (socket.connecting) {
    state.isConnectEventBind = true;
    socket.once('connect', handleConnect);
  } else {
    socket.once('close', handleClose);
    handleConnect();
  }

  if (signal) {
    state.isSignalEventBind = true;
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }

  return connector;
};

export default createConnector;
