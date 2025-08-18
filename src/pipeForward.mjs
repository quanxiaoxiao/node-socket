import assert from 'node:assert';

import { waitTick } from '@quanxiaoxiao/utils';

import createConnector from './createConnector.mjs';

const DEFAULT_TIMEOUT = 15_000; // 15秒
const ERROR_CODES = {
  SOURCE_CLOSE: 'ERR_SOCKET_PIPE_SOURCE_CLOSE',
  DEST_CLOSE: 'ERR_SOCKET_PIPE_DEST_CLOSE',
  TIMEOUT: 'ERR_SOCKET_PIPE_TIMEOUT',
};

const ERROR_MESSAGES = {
  SOURCE_CLOSE: 'Pipe connect fail, source socket is closed, but dest socket is not connected',
  DEST_CLOSE: 'Pipe connect fail, dest socket is closed, but source socket is not connected',
  TIMEOUT: 'Connect Pipe failed due to timeout',
};

export default (
  getSourceSocket,
  getDestSocket,
  options = {},
) => {
  assert(typeof getSourceSocket === 'function', 'getSourceSocket must be a function');
  assert(typeof getDestSocket === 'function', 'getDestSocket must be a function');

  const {
    onConnect,
    onClose,
    onError,
    onIncoming,
    onOutgoing,
    ...other
  } = options;

  const controller = new AbortController();

  const state = {
    tick: null,
    source: null,
    dest: null,
    isCloseEmitted: false,
    performanceStart: performance.now(),
    timeConnectOnSource: null,
    timeConnectOnDest: null,
  };

  const isPipeReady = () => {
    return state.timeConnectOnSource != null && state.timeConnectOnDest != null;
  };

  const createError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
  };

  const getState = () => {
    const result = {
      timeConnectOnSource: null,
      timeConnectOnDest: null,
      timeConnect: null,
    };

    if (state.timeConnectOnSource != null) {
      result.timeConnectOnSource = state.timeConnectOnSource - state.performanceStart;
    }

    if (state.timeConnectOnDest != null) {
      result.timeConnectOnDest = state.timeConnectOnDest - state.performanceStart;
    }

    if (result.timeConnectOnDest != null && result.timeConnectOnSource != null) {
      result.timeConnect = Math.max(result.timeConnectOnSource, result.timeConnectOnDest);
    }
    return result;
  };

  const cleanupTimer = () => {
    if (state.tick != null) {
      state.tick();
      state.tick = null;
    }
  };

  state.source = createConnector(
    {
      ...other,
      onConnect: async () => {
        assert(!controller.signal.aborted);
        state.timeConnectOnSource = performance.now();
        if (isPipeReady()) {
          if (state.tick != null) {
            state.tick();
            state.tick = null;
          }
          if (onConnect) {
            await onConnect(getState());
          }
        }
      },
      onData: (chunk) => {
        if (onOutgoing) {
          onOutgoing(chunk);
        }
        if (state.dest.socket.writableEnded) {
          return false;
        }
        const ret = state.dest.write(chunk);
        if (!isPipeReady()) {
          return false;
        }
        return ret;
      },
      onDrain: () => {
        state.dest.resume();
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        if (!isPipeReady()) {
          const error = new Error('Pipe connect fail, source socket is close, but dest socket is not connect');
          error.code = 'ERR_SOCKET_PIPE_SOURCE_CLOSE';
          throw error;
        }
        if (!state.dest.socket.writableEnded) {
          state.dest.end();
        }
        if (!state.isCloseEmitted && onClose) {
          state.isCloseEmitted = true;
          onClose(getState());
        }
      },
      onError: (error) => {
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
      ...other,
      onConnect: async () => {
        assert(!controller.signal.aborted);
        state.timeConnectOnDest = performance.now();
        if (isPipeReady()) {
          if (state.tick != null) {
            state.tick();
            state.tick = null;
          }
          if (onConnect) {
            await onConnect(getState());
          }
        }
      },
      onData: (chunk) => {
        if (onIncoming) {
          onIncoming(chunk);
        }
        if (state.source.socket.writableEnded) {
          return false;
        }
        const ret = state.source.write(chunk);
        if (!isPipeReady()) {
          return false;
        }
        return ret;
      },
      onDrain: () => {
        state.source.resume();
      },
      onClose: () => {
        assert(!controller.signal.aborted);

        if (!isPipeReady()) {
          const error = new Error('Pipe connect fail, dest socket is close, but souce socket is not connect');
          error.code = 'ERR_SOCKET_PIPE_DEST_CLOSE';
          throw new Error(error);
        }

        if (!state.source.socket.writableEnded) {
          state.source.end();
        }
        if (!state.isCloseEmitted && onClose) {
          state.isCloseEmitted = true;
          onClose(getState());
        }
      },
      onError: (error) => {
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

  controller.signal.addEventListener('abort', cleanupTimer, { once: true });

  state.tick = waitTick(DEFAULT_TIMEOUT, () => {
    state.tick = null;
    if (!controller.signal.aborted && !isPipeReady()) {
      controller.abort();
      if (onError) {
        const error = createError(ERROR_CODES.TIMEOUT, ERROR_MESSAGES.TIMEOUT);
        onError(error, getState());
      }
    }
  });
};
