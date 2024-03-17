import { test, mock } from 'node:test';
import net from 'node:net';
import assert from 'node:assert';
import pipeForward from './pipeForward.mjs';

const _getPort = () => {
  let _port = 5750;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

const createSockert = (port) => {
  const socket = net.Socket();
  if (port != null) {
    socket.connect({
      host: '127.0.0.1',
      port,
    });
  }
  return socket;
};

const waitFor = async (t = 100) => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, t);
  });
};

test('pipeForward fail', () => {
  assert.throws(
    () => {
      const socketSource = net.Socket();
      socketSource.destroy();
      pipeForward(
        () => socketSource,
        () => net.Socket(),
        {},
      );
    },
    (error) => error instanceof assert.AssertionError,
  );
  assert.throws(
    () => {
      const socketSource = net.Socket();
      pipeForward(
        () => socketSource,
        {},
        {},
      );
    },
    (error) => error instanceof assert.AssertionError,
  );
  assert.throws(
    () => {
      const socketSource = net.Socket();
      const socketDest = net.Socket();
      socketDest.destroy();
      pipeForward(
        () => socketSource,
        () => socketDest,
        {},
      );
    },
    (error) => error instanceof assert.AssertionError,
  );
});

test('pipeForward', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const server1 = net.createServer(() => {});
  const server2 = net.createServer(() => {});
  server1.listen(port1);
  server2.listen(port2);

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
    socketDest.destroy();
  });
  const onClose = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
  });
  const onError = mock.fn(() => {});

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onError,
    },
  );
  await waitFor(500);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  server1.close();
  server2.close();
});

test('pipeForward unable connect', async () => {
  const port1 = getPort();
  const port2 = getPort();

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn((error, state) => {
    assert.equal(state.timeConnectOnSource, null);
    assert.equal(state.timeConnectOnDest, null);
  });

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onError,
    },
  );
  await waitFor(500);
  assert.equal(onConnect.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 1);
});

test('pipeForward unable connect 2', async () => {
  const port1 = getPort();
  const port2 = getPort();

  const server1 = net.createServer(() => {});
  server1.listen(port1);

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn((error, state) => {
    assert.equal(state.timeConnectOnDest, null);
  });

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onError,
    },
  );
  await waitFor(500);
  assert.equal(onConnect.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 1);
  server1.close();
});

test('pipeForward 2', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const server1 = net.createServer(() => {});
  const server2 = net.createServer(() => {});
  server1.listen(port1);
  server2.listen(port2);

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
    socketDest.destroy();
  });
  const onClose = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
  });
  const onError = mock.fn(() => {});

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onError,
    },
  );
  await waitFor(500);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  server1.close();
  server2.close();
});

test('pipeForward 3', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const server1 = net.createServer((socket) => {
    setTimeout(() => {
      socket.destroy();
    }, 100);
  });
  const server2 = net.createServer(() => {});
  server1.listen(port1);
  server2.listen(port2);

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
  });
  const onClose = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
  });
  const onError = mock.fn(() => {});

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onError,
    },
  );
  await waitFor(500);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  server1.close();
  server2.close();
});

test('pipeForward 3', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const server1 = net.createServer(() => {});
  const server2 = net.createServer((socket) => {
    setTimeout(() => {
      socket.destroy();
    }, 100);
  });
  server1.listen(port1);
  server2.listen(port2);

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
  });
  const onClose = mock.fn((state) => {
    assert.equal(typeof state.timeConnect, 'number');
    assert.equal(typeof state.timeConnectOnSource, 'number');
    assert.equal(typeof state.timeConnectOnDest, 'number');
  });
  const onError = mock.fn(() => {});

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onError,
    },
  );
  await waitFor(500);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  server1.close();
  server2.close();
});

test('pipeForward 4', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const server1 = net.createServer((socket) => {
    socket.destroy();
  });
  const server2 = net.createServer((socket) => {
    socket.destroy();
  });
  server1.listen(port1);
  server2.listen(port2);

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn(() => {
  });
  const onClose = mock.fn(() => {
  });
  const onError = mock.fn(() => {});

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onError,
    },
  );
  await waitFor(500);
  // assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  server1.close();
  server2.close();
});

test('pipeForward onIncoming', async () => {
  const port1 = getPort();
  const port2 = getPort();
  const handleDataOnSocket1 = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'quan');
  });
  const server1 = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket1);
  });
  const server2 = net.createServer((socket) => {
    setTimeout(() => {
      socket.end(Buffer.from('quan'));
    }, 100);
  });
  server1.listen(port1);
  server2.listen(port2);

  const socketSource = createSockert(port1);
  const socketDest = createSockert(port2);

  const onConnect = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const onIncoming = mock.fn(() => {});
  const onOutgoing = mock.fn(() => {});

  pipeForward(
    () => socketSource,
    () => socketDest,
    {
      onConnect,
      onClose,
      onIncoming,
      onOutgoing,
      onError,
    },
  );
  await waitFor(500);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(handleDataOnSocket1.mock.calls.length, 1);
  assert.equal(onIncoming.mock.calls.length, 1);
  assert.equal(onOutgoing.mock.calls.length, 0);
  server1.close();
  server2.close();
});
