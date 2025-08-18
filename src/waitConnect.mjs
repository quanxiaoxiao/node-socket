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
    let isCompleted = false;
    let tickWait;
    let errorTimeoutId;

    const state = {
      isSignalEventBind: false,
      isEventErrorBind: true,
      isEventConnectBind: true,
    };

    const complete = (fn) => {
      if (isCompleted) return;
      isCompleted = true;
      if (tickWait) {
        tickWait();
      }
      // eslint-disable-next-line no-use-before-define
      clearEvents();
      fn();
    };

    function removeEventSocketError() {
      if (errorTimeoutId) {
        clearTimeout(errorTimeoutId);
        errorTimeoutId = null;
      }
      if (state.isEventErrorBind) {
        errorTimeoutId = setTimeout(() => {
          errorTimeoutId = null;
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
          socket.off('secureConnect', handleConnectOnSocket);
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
      complete(() => {
        removeEventSocketError();
        resolve(socket);
      });
    };

    function handleErrorOnSocket(error) {
      complete(() => {
        reject(error);
      });
    };

    function handleAbortOnSignal() {
      complete(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
        reject(createError('abort', 'ABORT_ERR'));
      });
    }

    if (timeout != null) {
      tickWait = waitTick(timeout, () => {
        complete(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
          reject(createError('socket connection timeout', 'ERR_SOCKET_CONNECTION_TIMEOUT'));
        });
      });
    }

    socket.setNoDelay(true);
    socket.on('error', handleErrorOnSocket);

    const connectEvent = socket instanceof tls.TLSSocket ? 'secureConnect' : 'connect';
    socket.once(connectEvent, handleConnectOnSocket);

    if (!isCompleted && signal) {
      state.isSignalEventBind = true;
      signal.addEventListener('abort', handleAbortOnSignal, { once: true });
    }
  });
};
