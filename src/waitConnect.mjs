import assert from 'node:assert';
import { waitTick } from '@quanxiaoxiao/utils';

const checkSocketEnable = (socket) => {
  assert(!socket.destroyed);
  assert(socket.readyState === 'opening');
};

export default (
  socket,
  timeout = 1000 * 10,
  signal,
) => {
  if (signal) {
    assert(!signal.aborted);
  }
  checkSocketEnable(socket);

  return new Promise((resolve, reject) => {
    const state = {
      complete: false,
      tickWithError: null,
      isSignalEventBind: false,
      isEventErrorBind: true,
      isEventConnectBind: true,
    };

    const tickWait = waitTick(timeout, () => {
      clearEvents();
      if (!state.complete) {
        state.complete = true;
        const error = new Error('socket connection timeout');
        error.code = 'ERR_SOCKET_CONNECTION_TIMEOUT';
        reject(error);
      }
      if (!socket.destroyed) {
        socket.destroy();
      }
    });

    function removeEventSocketError() {
      if (state.tickWithError) {
        clearTimeout(state.tickWithError);
        state.tickWithError = null;
      }
      if (state.isEventErrorBind) {
        state.tickWithError = setTimeout(() => {
          state.tickWithError = null;
          if (state.isEventErrorBind) {
            state.isEventErrorBind = false;
            socket.off('error', handleErrorOnSocket);
          }
        }, 200);
      }
    }

    function clearEvents() {
      if (state.isEventConnectBind) {
        state.isEventConnectBind = false;
        socket.off('connect', handleConnectOnSocket);
      }
      if (state.isSignalEventBind) {
        state.isSignalEventBind = false;
        signal.removeEventListener('abort', handleAbortOnSignal);
      }
    }

    function handleConnectOnSocket() {
      state.isEventConnectBind = false;
      tickWait();
      clearEvents();
      if (!state.complete) {
        state.complete = true;
        removeEventSocketError();
        resolve();
      }
    };

    function handleErrorOnSocket(error) {
      clearEvents();
      tickWait();
      if (!state.complete) {
        state.complete = true;
        reject(error);
      }
    };

    function handleAbortOnSignal() {
      clearEvents();
      tickWait();
      if (!state.complete) {
        state.complete = true;
        const error = new Error('abort');
        error.code = 'ABORT_ERR';
        reject(error);
      }
      if (!socket.destroyed) {
        socket.destroy();
      }
    }

    socket
      .setNoDelay(true)
      .once('connect', handleConnectOnSocket)
      .on('error', handleErrorOnSocket);

    if (!state.complete && signal) {
      state.isSignalEventBind = true;
      signal.addEventListener('abort', handleAbortOnSignal, { once: true });
    }
  });
};
