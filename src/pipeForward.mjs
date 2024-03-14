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
    isSourceConnect: false,
    isDestConnect: false,
  };

  const isPipe = () => state.isSourceConnect && state.isDestConnect;

  state.source = createConnector(
    {
      onConnect: () => {
        state.isSourceConnect = true;
      },
      onData: (chunk) => state.dest.write(chunk),
      onDrain: () => {
        assert(!controller.signal.aborted);
        state.dest.resume();
      },
      onClose: () => {
        assert(!controller.signal.aborted);
        if (isPipe()) {
          state.dest.end();
        } else {
          controller.abort();
        }
      },
      onError: () => {
        assert(!controller.signal.aborted);
        controller.abort();
      },
    },
    () => socketSource,
    controller.signal,
  );

  state.dest = createConnector(
    {
      onConnect: () => {
        state.isDestConnect = true;
      },
      onData: (chunk) => state.source.write(chunk),
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
      },
      onError: () => {
        assert(!controller.signal.aborted);
        controller.abort();
      },
    },
    getDestSocket,
    controller.signal,
  );
};
