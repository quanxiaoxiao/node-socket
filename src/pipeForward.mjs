import assert from 'node:assert';
import createConnector from './createConnector.mjs';

export default (
  getSourceSocket,
  getDestSocket,
  options = {},
) => {

  assert(typeof getSourceSocket === 'function');
  assert(typeof getDestSocket === 'function');

  const {
    onConnect,
    onClose,
    onError,
    onIncoming,
    onOutgoing,
    timeout,
  } = options;

  const controller = new AbortController();

  const state = {
    'tick': null,
    'source': null,
    'dest': null,
    'timeStart': performance.now(),
    'timeConnectOnSource': null,
    'timeConnectOnDest': null,
  };

  const isPipe = () => {

    if (state.timeConnectOnSource == null) {

      return false;

    }
    if (state.timeConnectOnDest == null) {

      return false;

    }
    return true;

  };

  const getState = () => {

    const result = {
      'timeConnectOnSource': null,
      'timeConnectOnDest': null,
      'timeConnect': null,
    };
    if (state.timeConnectOnSource != null) {

      result.timeConnectOnSource = state.timeConnectOnSource - state.timeStart;

    }
    if (state.timeConnectOnDest != null) {

      result.timeConnectOnDest = state.timeConnectOnDest - state.timeStart;

    }
    if (result.timeConnectOnDest != null && result.timeConnectOnSource != null) {

      result.timeConnect = Math.max(result.timeConnectOnSource, result.timeConnectOnDest);

    }
    return result;

  };

  state.source = createConnector(
    {
      timeout,
      'onConnect': async () => {

        assert(!controller.signal.aborted);
        state.timeConnectOnSource = performance.now();
        if (isPipe()) {

          if (state.tick != null) {

            clearTimeout(state.tick);
            state.tick = null;

          }
          if (onConnect) {

            await onConnect(getState());

          }

        }

      },
      'onData': (chunk) => {

        if (onOutgoing) {

          onOutgoing(chunk);

        }
        return state.dest.write(chunk);

      },
      'onDrain': () => {

        state.dest.resume();

      },
      'onClose': () => {

        assert(!controller.signal.aborted);
        if (!isPipe()) {

          const error = new Error('Pipe connect fail, source socket is close, but dest socket is not connect');
          error.code = 'ERR_SOCKET_PIPE_SOURCE_CLOSE';
          throw error;

        }
        state.dest.end();
        if (onClose) {

          onClose(getState());

        }

      },
      'onError': (error) => {

        if (!controller.signal.aborted) {

          controller.abort();
          if (onError) {

            onError(error, getState());

          }

        }

      },
    },
    getSourceSocket,
    controller.signal,
  );

  state.dest = createConnector(
    {
      timeout,
      'onConnect': async () => {

        assert(!controller.signal.aborted);
        state.timeConnectOnDest = performance.now();
        if (isPipe()) {

          if (state.tick != null) {

            clearTimeout(state.tick);
            state.tick = null;

          }
          if (onConnect) {

            await onConnect(getState());

          }

        }

      },
      'onData': (chunk) => {

        if (onIncoming) {

          onIncoming(chunk);

        }
        return state.source.write(chunk);

      },
      'onDrain': () => {

        state.source.resume();

      },
      'onClose': () => {

        assert(!controller.signal.aborted);
        if (!isPipe()) {

          const error = new Error('Pipe connect fail, dest socket is close, but souce socket is not connect');
          error.code = 'ERR_SOCKET_PIPE_DEST_CLOSE';
          throw new Error(error);

        }
        state.source.end();
        if (onClose) {

          onClose(getState());

        }

      },
      'onError': (error) => {

        if (!controller.signal.aborted) {

          controller.abort();
          if (onError) {

            onError(error, getState());

          }

        }

      },
    },
    getDestSocket,
    controller.signal,
  );

  controller.signal.addEventListener('abort', () => {

    if (state.tick != null) {

      clearTimeout(state.tick);
      state.tick = null;

    }

  }, {'once': true});

  state.tick = setTimeout(() => {

    state.tick = null;
    if (!controller.signal.aborted && !isPipe()) {

      controller.abort();
      if (onError) {

        const error = new Error('Connect Pipe fail');
        error.code = 'ERR_SOCKET_PIPE_TIMEOUT';
        onError(error, getState());

      }

    }

  }, 1000 * 15);

};
