import assert from 'node:assert';

export default (
  socket,
  timeout = 1000 * 10,
  signal,
) => {
  if (signal) {
    assert(!signal.aborted);
  }
  assert(!socket.destroyed);
  assert(socket.readyState === 'opening');

  if (timeout != null && timeout !== 0) {
    assert(timeout >= 50);
  }

  return new Promise((resolve, reject) => {
    const state = {
      complete: false,
      tick: null,
      tickWithError: null,
      isSignalEventBind: false,
      isEventErrorBind: true,
      isEventConnectBind: true,
    };

    function removeTimeTick() {
      if (state.tick != null) {
        clearTimeout(state.tick);
        state.tick = null;
      }
    }

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
      removeTimeTick();
      removeEventSocketError();
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
      clearEvents();
      if (!state.complete) {
        state.complete = true;
        resolve();
      }
    };

    function handleErrorOnSocket(error) {
      clearEvents();
      if (!state.complete) {
        state.complete = true;
        reject(error);
      }
    };

    function handleAbortOnSignal() {
      clearEvents();
      if (!state.complete) {
        state.complete = true;
        reject(new Error('abort'));
      }
      if (!socket.destroyed) {
        socket.destroy();
      }
    }

    socket.on('error', handleErrorOnSocket);
    socket.once('connect', handleConnectOnSocket);

    if (signal && !state.complete) {
      state.isSignalEventBind = true;
      signal.addEventListener('abort', handleAbortOnSignal, { once: true });
    }

    if (timeout && !state.complete) {
      state.tick = setTimeout(() => {
        state.tick = null;
        clearEvents();
        if (!state.complete) {
          state.complete = true;
          reject(new Error('timeout'));
        }
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, timeout);
    }
  });
};
