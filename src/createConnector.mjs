/* eslint no-use-before-define: 0 */
import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import process from 'node:process';

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

  const state = {
    isConnect: false,
    isAttachEvents: false,
    isActive: true,
    isConnectEventBind: false,
    isEndEmit: false,
    isErrorEventBind: true,
    isEndEventBind: false,
    isEventsClear: false,
    isSignalEventBind: false,
    outgoingBufList: [],
    incomingBufList: [],
  };

  function emitError(error) {
    if (onError) {
      onError(error, state.isConnect);
    } else {
      console.error(error);
    }
  }

  function clearEventsListener() {
    if (!state.isEventsClear) {
      state.isEventsClear = true;
      if (state.isConnectEventBind) {
        socket.off('connect', handleConnectOnSocket);
      } else {
        socket.off('close', handleCloseOnSocket);
      }
      if (state.isAttachEvents) {
        socket.off('data', handleDataOnSocket);
        socket.off('drain', handleDrainOnSocket);
        if (timeout != null) {
          socket.off('timeout', handleTimeoutOnSocket);
        }
      }
    }
  }

  function handleErrorOnSocket(error) {
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

  function handleDrainOnSocket() {
    assert(state.isActive);
    if (onDrain) {
      onDrain();
    }
  }

  async function handleConnectOnSocket() {
    if (state.isConnectEventBind) {
      assert(state.isActive);
      state.isConnectEventBind = false;
      socket.once('close', handleCloseOnSocket);
    }
    state.isConnect = true;
    if (onConnect && state.isActive) {
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
      state.isAttachEvents = true;
      socket.on('data', handleDataOnSocket);
      if (timeout != null) {
        assert(typeof timeout === 'number' && timeout >= 0);
        socket.setTimeout(timeout);
        socket.once('timeout', handleTimeoutOnSocket);
      }
      socket.on('drain', handleDrainOnSocket);
      process.nextTick(() => {
        if (state.isActive && socket.isPaused()) {
          socket.resume();
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
    if (!state.isEventsClear) {
      state.isEventsClear = true;
      if (state.isAttachEvents) {
        socket.off('data', handleDataOnSocket);
        socket.off('drain', handleDrainOnSocket);
        if (timeout != null) {
          socket.off('timeout', handleTimeoutOnSocket);
        }
      }
    }
    unbindSocketError();
    if (doClose() && onClose) {
      const buf = Buffer.concat(state.incomingBufList);
      state.incomingBufList = [];
      onClose(buf);
    }
  }

  function handleTimeoutOnSocket() {
    state.isEventsClear = true;
    socket.off('data', handleDataOnSocket);
    socket.off('drain', handleDrainOnSocket);
    if (!socket.destroyed) {
      socket.destroy();
    }
  }

  function pause() {
    if (state.isActive
      && state.isAttachEvents
      && !socket.isPaused()) {
      socket.pause();
    }
  }

  function resume() {
    if (state.isActive
      && state.isAttachEvents
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

  function handleDataOnSocket(chunk) {
    assert(state.isActive);
    assert(!state.isEndEventBind);
    if (onData) {
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
    } else {
      state.incomingBufList.push(chunk);
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
    assert(state.isActive && !state.isEndEventBind);
    if (!state.isAttachEvents) {
      state.outgoingBufList.push(chunk);
      return false;
    }
    if (socket.writable) {
      return socket.write(chunk);
    }
    return false;
  };

  connector.end = (chunk) => {
    assert(state.isActive && !state.isEndEventBind && !socket.writableEnded);
    if (!state.isConnect) {
      connector();
      emitError(new Error('socket is not connect'));
    } else {
      clearEventsListener();
      doClose();
      if (socket.writable) {
        state.isEndEventBind = true;
        socket.once('end', handleSocketEnd);
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
    }
  };

  socket.once('error', handleErrorOnSocket);

  if (socket.connecting) {
    state.isConnectEventBind = true;
    socket.once('connect', handleConnectOnSocket);
  } else {
    socket.once('close', handleCloseOnSocket);
    process.nextTick(() => {
      handleConnectOnSocket();
    });
  }

  if (signal) {
    state.isSignalEventBind = true;
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }

  return connector;
};

export default createConnector;
