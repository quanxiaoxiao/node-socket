import assert from 'node:assert';
import tls from 'node:tls';

import { waitTick } from '@quanxiaoxiao/utils';

const checkSocketEnable = (socket) => {
  assert(!socket.destroyed);
  assert(socket.readyState === 'opening');
};

const createError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
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

    const tickWait = timeout == null
      ? () => {}
      : waitTick(timeout, () => {
        // eslint-disable-next-line no-use-before-define
        clearEvents();
        if (!state.complete) {
          state.complete = true;
          reject(createError('socket connection timeout', 'ERR_SOCKET_CONNECTION_TIMEOUT'));
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
            // eslint-disable-next-line no-use-before-define
            socket.off('error', handleErrorOnSocket);
          }
        }, 200);
      }
    }

    function clearEvents() {
      if (state.isEventConnectBind) {
        state.isEventConnectBind = false;
        if (socket instanceof tls.TLSSocket) {
          // eslint-disable-next-line no-use-before-define
          socket.once('secureConnect', handleConnectOnSocket);
        } else {
          // eslint-disable-next-line no-use-before-define
          socket.off('connect', handleConnectOnSocket);
        }
      }
      if (state.isSignalEventBind) {
        state.isSignalEventBind = false;
        // eslint-disable-next-line no-use-before-define
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
        resolve(socket);
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
        reject(createError('abort', 'ABORT_ERR'));
      }
      if (!socket.destroyed) {
        socket.destroy();
      }
    }

    socket.setNoDelay(true)
      .on('error', handleErrorOnSocket);

    if (socket instanceof tls.TLSSocket) {
      socket.once('secureConnect', handleConnectOnSocket);
    } else {
      socket.once('connect', handleConnectOnSocket);
    }

    if (!state.complete && signal) {
      state.isSignalEventBind = true;
      signal.addEventListener('abort', handleAbortOnSignal, { once: true });
    }
  });
};
