import assert from 'node:assert';
import createConnector from './createConnector.mjs';

export default (
  socketSource,
  getDestSocket,
  options = {},
) => {
  const {
    onConnect,
    onIncoming,
    onOutgoing,
    onClose,
    onError,
  } = options;

  const controller = new AbortController();

  const state = {
    source: null,
    dest: null,
    timeStart: performance.now(),
    timeConnectOnSource: null,
    timeConnectOnDest: null,
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
      timeConnectOnSource: null,
      timeConnectOnDest: null,
      timeConnect: null,
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
      onConnect: () => {
        assert(!controller.signal.aborted);
        state.timeConnectOnSource = performance.now();
        if (onConnect && isPipe()) {
          onConnect(getState());
        }
      },
      onData: (chunk) => {
        if (onOutgoing) {
          onOutgoing(chunk);
        }
        return state.dest.write(chunk);
      },
      onDrain: () => {
        state.dest.resume();
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        if (isPipe()) {
          state.dest.end();
        } else {
          controller.abort();
        }
        if (onClose) {
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
    () => socketSource,
    controller.signal,
  );

  state.dest = createConnector(
    {
      onConnect: () => {
        assert(!controller.signal.aborted);
        state.timeConnectOnDest = performance.now();
        if (onConnect && isPipe()) {
          onConnect(getState());
        }
      },
      onData: (chunk) => {
        if (onIncoming) {
          onIncoming(chunk);
        }
        return state.source.write(chunk);
      },
      onDrain: () => {
        state.source.resume();
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        if (isPipe()) {
          state.source.end();
        } else {
          controller.abort();
        }
        if (onClose) {
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
};
