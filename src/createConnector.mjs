/* eslint no-use-before-define: 0 */
import assert from 'node:assert';
import {
  SocketConnectError,
} from './errors.mjs';

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
    timeout = 1000 * 60,
    onConnect,
    onData,
    onDrain,
    onClose,
    onError,
  } = options;

  const state = {
    isConnect: false,
    isConnectActive: false,
    isActive: true,
    isConnectEventBind: false,
    isErrorEventBind: true,
    isEndEventBind: false,
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
    const eventNames = socket.eventNames();
    if (eventNames.includes('timeout')) {
      socket.off('timeout', handleTimeout);
    }
    if (state.isConnectEventBind) {
      state.isConnectEventBind = false;
      socket.off('connect', handleConnect);
    }
    if (state.isEndEventBind) {
      state.isEndEventBind = false;
      socket.off('end', handleSocketEnd);
    }
    if (state.isConnectActive && eventNames.includes('data')) {
      socket.off('data', handleData);
      socket.off('close', handleClose);
      socket.off('drain', handleDrain);
    }
  }

  function destroy() {
    if (!socket.destroyed) {
      socket.destroy();
    }
    unbindSocketError();
  }

  function handleError(error) {
    state.isErrorEventBind = false;
    if (doClose()) {
      clearEventsListener();
      emitError(error);
    }
  }

  socket.once('error', handleError);

  if (socket.connecting) {
    state.isConnectEventBind = true;
    socket.once('connect', handleConnect);
  } else {
    handleConnect();
  }

  function handleDrain() {
    assert(state.isActive);
    if (onDrain) {
      onDrain();
    }
  }

  function handleConnect() {
    if (state.isConnectEventBind) {
      state.isConnectEventBind = false;
    }
    if (state.isActive) {
      assert(!state.isConnect);
      if (!socket.remoteAddress) {
        doClose();
        emitError(new SocketConnectError('socket get remote address fail'));
        destroy();
      } else {
        state.isConnect = true;
        while (state.isActive
          && state.outgoingBufList.length > 0
          && socket.writable
        ) {
          const chunk = state.outgoingBufList.shift();
          if (chunk.length > 0) {
            socket.write(chunk);
          }
        }
        process.nextTick(() => {
          if (state.isActive) {
            state.isConnectActive = true;
            if (onConnect) {
              try {
                onConnect();
              } catch (error) {
                doClose();
                destroy();
              }
            }
            if (state.isActive) {
              socket.on('data', handleData);
              socket.once('close', handleClose);
              if (timeout != null) {
                socket.setTimeout(timeout);
                socket.once('timeout', handleTimeout);
              }
              socket.on('drain', handleDrain);
            }
          }
        });
      }
    } else {
      destroy();
    }
  }

  function handleClose() {
    if (doClose() && onClose) {
      onClose();
    }
    unbindSocketError();
  }

  function handleTimeout() {
    socket.off('data', handleData);
    socket.off('drain', handleDrain);
    destroy();
  }

  function pause() {
    if (state.isConnectActive
      && state.isActive
      && !socket.isPaused()) {
      socket.pause();
    }
  }

  function resume() {
    if (state.isConnectActive
      && state.isActive
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
    if (state.isActive) {
      try {
        if (onData(chunk) === false) {
          pause();
        }
      } catch (error) {
        clearEventsListener();
        doClose();
        destroy();
      }
    } else {
      socket.off('data', handleData);
      destroy();
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
    state.isEndEventBind = false;
    unbindSocketError();
  }

  function connector() {
    if (doClose()) {
      if (state.isConnectActive) {
        clearEventsListener();
      } else if (socket.connecting) {
        socket.off('connect', handleConnect);
      }
    }
    destroy();
  }

  connector.pause = pause;
  connector.resume = resume;

  connector.write = (chunk) => {
    assert(state.isActive);
    if (!state.isConnect) {
      state.outgoingBufList.push(chunk);
      return false;
    }
    if (socket.writable) {
      return socket.write(chunk);
    }
    return false;
  };

  connector.end = (chunk) => {
    assert(state.isActive);
    if (!state.isConnectActive) {
      connector();
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
      } else {
        destroy();
      }
    }
  };

  function handleAbortOnSignal() {
    state.isSignalEventBind = false;
    connector();
  }

  if (signal) {
    state.isSignalEventBind = true;
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }

  return connector;
};

export default createConnector;
