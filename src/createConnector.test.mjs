import assert from 'node:assert';
import net from 'node:net';
import { test, mock } from 'node:test';
import createConnector from './createConnector.mjs';

const _getPort = () => {
  let _port = 5250;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

const waitFor = async (t = 100) => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, t);
  });
};

const connect = (port) => () => {
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });
  return socket;
};

test('createConnector fail', () => {
  assert.throws(
    () => {
      createConnector(
        {},
      );
    },
    (error) => error instanceof assert.AssertionError,
  );

  assert.throws(
    () => {
      const controller = new AbortController();
      controller.abort();
      createConnector(
        {},
        () => {
          const socket = net.Socket();
          return socket;
        },
        controller.signal,
      );
    },
    (error) => error instanceof assert.AssertionError,
  );
});

test('createConnector', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn((chunk) => {
    assert.equal(chunk.toString(), '445566');
  });
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('aabbcc');
    }, 50);
    setTimeout(() => {
      socket.destroy();
    }, 100);
  });
  server.listen(port);

  const onConnect = mock.fn(() => {
    assert.equal(handleDataOnSocket.mock.calls.length, 0);
  });
  const onData = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'aabbcc');
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    connect(port),
  );

  assert.equal(typeof connector, 'function');

  connector.write(Buffer.from('445566'));

  await waitFor(200);

  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);

  server.close();
});
