/* eslint no-use-before-define: 0 */
import assert from 'node:assert';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import _ from 'lodash';
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

test('createConnector unable connet remote', async () => {
  const port = getPort();
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });
  const onConnect = mock.fn(() => {});
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => socket,
  );
  assert(socket.eventNames().includes('connect'));
  assert(socket.eventNames().includes('error'));
  assert.equal(typeof connector, 'function');
  await waitFor(200);
  assert.equal(onConnect.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 1);
  assert(!socket.eventNames().includes('connect'));
  assert(!socket.eventNames().includes('error'));
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

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onConnect = mock.fn(() => {
    assert.equal(handleDataOnSocket.mock.calls.length, 0);
    assert(socket.eventNames().includes('error'));
    assert(socket.eventNames().includes('close'));
  });
  const onData = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'aabbcc');
  });

  const onClose = mock.fn(() => {
    assert(socket.eventNames().includes('error'));
    assert(!socket.eventNames().includes('data'));
    assert(!socket.eventNames().includes('drain'));
  });

  const onError = mock.fn(() => {});

  const connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => socket,
  );

  assert.equal(typeof connector, 'function');

  connector.write(Buffer.from('445566'));

  await waitFor(300);

  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  assert(!socket.eventNames().includes('error'));

  server.close();
});

test('createConnector, socket already connect', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn((chunk) => {
    assert.equal(chunk.toString(), '777');
  });
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('aabbcc');
    }, 50);
    setTimeout(() => {
      socket.destroy();
    }, 200);
  });
  server.listen(port);

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  await waitFor(100);

  const onConnect = mock.fn(() => {
    assert(socket.eventNames().includes('error'));
    assert(socket.eventNames().includes('close'));
  });
  const onData = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'aabbcc');
  });

  const onClose = mock.fn(() => {
    assert(socket.eventNames().includes('error'));
    assert(!socket.eventNames().includes('data'));
    assert(!socket.eventNames().includes('drain'));
  });

  const onError = mock.fn(() => {});

  const connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => socket,
  );

  connector.write(Buffer.from('777'));

  await waitFor(400);

  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onConnect.mock.calls.length, 1);
  assert(!socket.eventNames().includes('error'));
  assert.equal(handleDataOnSocket.mock.calls.length, 1);

  server.close();
});

test('createConnector, onConnect trigger error', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write(Buffer.from('aabbcc'));
    }, 10);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onConnect = mock.fn(async () => {
    assert(socket.eventNames().includes('close'));
    assert(socket.eventNames().includes('error'));
    await waitFor(200);
    assert(!socket.eventNames().includes('data'));
    assert(!socket.eventNames().includes('drain'));
    throw new Error('aaaa');
  });

  const onData = mock.fn(() => {});

  const onClose = mock.fn(() => {});

  const onError = mock.fn((error) => {
    assert.equal(error.message, 'aaaa');
    assert(!socket.eventNames().includes('close'));
  });

  const connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => socket,
  );

  connector.write(Buffer.from('777'));

  await waitFor(400);

  assert.equal(onError.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 0);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 0);
  assert(!socket.eventNames().includes('error'));

  server.close();
});

test('createConnector onConnect, wait delay', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn((chunk) => {
    assert.equal(chunk.toString(), '777');
  });
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onConnect = mock.fn(async () => {
    await waitFor(200);
  });

  const onData = mock.fn(() => {});

  const onClose = mock.fn(() => {});

  const onError = mock.fn(() => {});

  const connector = createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => socket,
  );

  connector.write(Buffer.from('777'));

  setTimeout(() => {
    assert.equal(handleDataOnSocket.mock.calls.length, 0);
  }, 100);

  await waitFor(400);

  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  assert.equal(handleCloseOnSocket.mock.calls.length, 0);
  connector();
  await waitFor(100);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);

  server.close();
});

test('createConnector, close before connect', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', () => {
    });
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const socket = net.Socket();

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const onData = mock.fn(() => {});

  socket.connect({
    host: '127.0.0.1',
    port,
  });
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => socket,
  );
  connector.write(Buffer.from('------ start --------'));
  assert(socket.eventNames().includes('connect'));
  connector();
  assert(!socket.eventNames().includes('connect'));
  assert(socket.eventNames().includes('error'));
  assert(socket.destroyed);
  await waitFor(100);
  assert.equal(handleCloseOnSocket.mock.calls.length, 0);
  assert(!socket.eventNames().includes('error'));
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  server.close();
});

test('createConnector, stream outgoing', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_111`);
  const ws = fs.createWriteStream(pathname);
  const count = 5000;
  const handleFinishOnWriteStream = mock.fn(() => {
    const s = fs.readFileSync(pathname).toString();
    assert(/^-- start --/.test(s));
    assert(new RegExp(`:${count - 1}$`).test(s));
    setTimeout(() => {
      fs.unlinkSync(pathname);
    }, 100);
  });
  ws.on('finish', handleFinishOnWriteStream);
  const server = net.createServer((socket) => {
    socket.pipe(ws);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const onData = mock.fn(() => {});

  let i = 0;
  let isPause = false;
  const onDrain = mock.fn(() => {
    isPause = false;
    assert(socket.eventNames().includes('drain'));
    assert(socket.eventNames().includes('close'));
    assert(socket.eventNames().includes('error'));
    assert(socket.eventNames().includes('data'));
    walk();
  });
  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
      onDrain,
    },
    () => socket,
  );
  connector.write(Buffer.from('-- start --'));
  const content = 'aabbccddee';
  function walk() {
    while (i < count && !isPause) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = connector.write(Buffer.from(s));
      if (ret === false) {
        isPause = true;
      }
      i++;
    }
    if (i >= count) {
      assert(socket.eventNames().includes('close'));
      assert(socket.eventNames().includes('data'));
      assert(socket.eventNames().includes('drain'));
      connector.end();
      assert(!socket.eventNames().includes('close'));
      assert(!socket.eventNames().includes('data'));
      assert(!socket.eventNames().includes('drain'));
      setTimeout(() => {
        server.close();
      }, 100);
    }
  }
  setTimeout(() => {
    walk();
  }, 200);
});
