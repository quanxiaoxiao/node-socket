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

test('createConnector unable connect', async () => {
  const socket = net.Socket();
  const onError = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onConnect = mock.fn(() => {});
  const onData = mock.fn(() => {});
  createConnector(
    {
      onConnect,
      onData,
      onClose,
      onError,
    },
    () => socket,
  );
  await waitFor(500);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onConnect.mock.calls.length, 1);
});

test('createConnector unable connect remote', async () => {
  const port = getPort();
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });
  const onConnect = mock.fn(() => {});
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn((error, isConnect) => {
    assert(!isConnect);
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
  assert(socket.eventNames().includes('connect'));
  assert(!socket.eventNames().includes('close'));
  assert(socket.eventNames().includes('error'));
  assert.equal(typeof connector, 'function');
  await waitFor(200);
  assert.equal(onConnect.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 1);
  assert(!socket.eventNames().includes('connect'));
  assert(!socket.eventNames().includes('error'));
});

test('createConnector unable connect remote 2', async () => {
  const port = getPort();
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });
  const onConnect = mock.fn(() => {});
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  createConnector(
    {
      onConnect,
      onData,
      onClose,
    },
    () => socket,
  );
  await waitFor(200);
  assert.equal(onConnect.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
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
    setTimeout(() => {
      assert(!socket.eventNames().includes('timeout'));
    });
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
  assert(!socket.eventNames().includes('close'));
  assert(socket.eventNames().includes('error'));

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

  assert(!socket.eventNames().includes('connect'));
  assert(socket.eventNames().includes('close'));

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

  const onError = mock.fn((error, isConnect) => {
    assert(isConnect);
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

  server.on('close', () => {
    assert.equal(onClose.mock.calls.length, 0);
    assert.equal(onError.mock.calls.length, 0);
  });

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
      assert(socket.eventNames().includes('finish'));
      assert(!socket.eventNames().includes('close'));
      assert(!socket.eventNames().includes('data'));
      assert(!socket.eventNames().includes('drain'));
      setTimeout(() => {
        assert(!socket.eventNames().includes('finish'));
        server.close();
      }, 100);
    }
  }
  setTimeout(() => {
    walk();
  }, 200);
});

test('createConnector, stream outgoing 2', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_222`);
  const ws = fs.createWriteStream(pathname);
  const server = net.createServer((socket) => {
    socket.pipe(ws);
    socket.on('close', handleCloseOnSocket);
    socket.on('pause', () => {
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, 1500);
    });
  });
  server.listen(port);
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  let isClose = false;
  let i = 0;
  let isPause = false;

  const onClose = mock.fn(() => {});

  const onError = mock.fn(() => {
    assert(!socket.eventNames().includes('error'));
    assert(!socket.eventNames().includes('close'));
    assert(!socket.eventNames().includes('data'));
    assert(!socket.eventNames().includes('drain'));
    assert(socket.destroyed);
    assert(i > 0);
    isClose = true;
    setTimeout(() => {
      server.close();
    }, 1000);
  });

  const onData = mock.fn(() => {});

  server.on('close', () => {
    setTimeout(() => {
      fs.unlinkSync(pathname);
    }, 100);
    assert.equal(onError.mock.calls.length, 1);
    assert.equal(onClose.mock.calls.length, 0);
  });

  const onDrain = mock.fn(() => {
    isPause = false;
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
    while (!isPause && !isClose) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = connector.write(Buffer.from(s));
      if (ret === false) {
        isPause = true;
      }
      i++;
    }
  }
  setTimeout(() => {
    walk();
  }, 200);
});

test('createConnector stream incoming', () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_333`);
  const ws = fs.createWriteStream(pathname);
  const content = 'aaaaaaaabbbbbbbcccccc';
  const count = 8000;
  let i = 0;
  const server = net.createServer((socket) => {
    let isPause = false;
    let isClose = false;
    function walk() {
      while (!isPause && !isClose) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(Buffer.from(s));
        if (ret === false) {
          isPause = true;
        }
        i++;
      }
    }

    socket.on('drain', () => {
      isPause = false;
      walk();
    });

    socket.on('close', () => {
      isClose = true;
    });
    setTimeout(() => {
      walk();
    }, 50);
  });
  server.listen(port);

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const state = {
    connector: null,
  };

  const onDrain = mock.fn(() => {
    state.connector.resume();
  });

  const onError = mock.fn(() => {});

  const onClose = mock.fn(() => {});

  ws.on('drain', onDrain);

  ws.on('finish', () => {
    setTimeout(() => {
      server.close();
      fs.unlinkSync(pathname);
      assert(onDrain.mock.calls.length > 0);
      assert.equal(onClose.mock.calls.length, 0);
      assert.equal(onError.mock.calls.length, 0);
    }, 100);
  });

  state.connector = createConnector(
    {
      onData: (chunk) => {
        if (i >= count) {
          state.connector.end();
          ws.end();
        } else {
          const ret = ws.write(chunk);
          if (ret === false) {
            state.connector.pause();
          }
        }
      },
      onError,
      onClose,
    },
    () => socket,
  );
});

test('createConnector stream incoming 2', () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_4444`);
  const ws = fs.createWriteStream(pathname);
  const content = 'aaaaaaaabbbbbbbcccccc';
  const count = 8000;
  let i = 0;
  const server = net.createServer((socket) => {
    let isPause = false;
    function walk() {
      while (!isPause && i < count) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(Buffer.from(s));
        if (ret === false) {
          isPause = true;
        }
        i++;
      }
      if (i >= count) {
        socket.end();
      }
    }

    socket.on('drain', () => {
      isPause = false;
      walk();
    });

    setTimeout(() => {
      walk();
    }, 50);
  });
  server.listen(port);

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const state = {
    connector: null,
  };

  const onDrain = mock.fn(() => {
    state.connector.resume();
  });

  const onError = mock.fn(() => { });

  const onClose = mock.fn(() => {
    ws.end();
  });

  ws.on('drain', onDrain);

  ws.on('finish', () => {
    const buf = fs.readFileSync(pathname);
    assert(new RegExp(`:${i - 1}$`).test(buf.toString()));
    setTimeout(() => {
      server.close();
      fs.unlinkSync(pathname);
      assert(onDrain.mock.calls.length > 0);
      assert.equal(onError.mock.calls.length, 0);
    }, 100);
  });

  state.connector = createConnector(
    {
      onData: (chunk) => {
        const ret = ws.write(chunk);
        if (ret === false) {
          state.connector.pause();
        }
      },
      onError,
      onClose,
    },
    () => socket,
  );
});

test('createConnector stream incoming 3', () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_555`);
  const ws = fs.createWriteStream(pathname);
  const content = 'aaaaaaaabbbbbbbcccccc';
  let i = 0;
  const server = net.createServer((socket) => {
    let isPause = false;
    let isClose = false;
    function walk() {
      while (!isPause && !isClose) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(Buffer.from(s));
        if (ret === false) {
          isPause = true;
        }
        i++;
      }
    }

    socket.once('error', () => {});

    socket.on('drain', () => {
      isPause = false;
      walk();
    });

    socket.on('close', () => {
      isClose = true;
      server.close();
    });

    setTimeout(() => {
      walk();
    }, 50);
  });
  server.listen(port);

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const state = {
    connector: null,
  };

  const onDrain = mock.fn(() => {
    state.connector.resume();
    setTimeout(() => {
      state.connector();
      setTimeout(() => {
        if (!ws.writableEnded) {
          ws.end();
        }
      }, 200);
    }, 2000);
  });

  const onError = mock.fn(() => {});
  const onClose = mock.fn(() => {});

  ws.on('drain', onDrain);

  ws.on('finish', () => {
    setTimeout(() => {
      fs.unlinkSync(pathname);
      assert.equal(onError.mock.calls.length, 0);
      assert.equal(onClose.mock.calls.length, 0);
      assert(!socket.eventNames().includes('error'));
      assert(!socket.eventNames().includes('data'));
      assert(!socket.eventNames().includes('drain'));
      assert(!socket.eventNames().includes('close'));
    }, 200);
  });

  state.connector = createConnector(
    {
      onData: (chunk) => {
        assert(!ws.writableEnded);
        return ws.write(chunk);
      },
      onError,
      onClose,
    },
    () => socket,
  );
});

test('createConnector onData trigger error', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    setTimeout(() => {
      socket.write('111');
    }, 10);
    setTimeout(() => {
      socket.write('222');
    }, 20);
    setTimeout(() => {
      socket.write('333');
    }, 30);
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  let i = 0;

  const onData = mock.fn((chunk) => {
    if (i === 1) {
      assert.equal(chunk.toString(), '222');
      throw new Error('bbbb');
    } else if (i === 0) {
      assert.equal(chunk.toString(), '111');
    }
    i++;
  });

  const onError = mock.fn((error) => {
    assert.equal(error.message, 'bbbb');
  });

  const onClose = mock.fn(() => {});

  createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => socket,
  );

  await waitFor(300);

  server.close();
  assert.equal(onError.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onData.mock.calls.length, 2);
  assert(!socket.eventNames().includes('close'));
  assert(!socket.eventNames().includes('error'));
  assert(!socket.eventNames().includes('data'));
  assert(!socket.eventNames().includes('drain'));
});

test('createConnector signal', async () => {
  const port = getPort();
  const onConnect = mock.fn(() => {});
  const server = net.createServer(onConnect);
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const controller = new AbortController();

  const connector = createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => socket,
    controller.signal,
  );

  assert(socket.eventNames().includes('connect'));
  connector.write(Buffer.from('aaabbbccc'));
  assert(!socket.destroyed);
  controller.abort();
  assert(socket.destroyed);
  assert(socket.eventNames().includes('error'));
  assert(!socket.eventNames().includes('connect'));

  assert.throws(
    () => {
      connector.write(Buffer.from('quan'));
    },
    (error) => error instanceof assert.AssertionError,
  );

  await waitFor(300);
  assert(!socket.eventNames().includes('error'));

  assert.equal(onConnect.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);

  server.close();
});

test('createConnector timeout', async () => {
  const port = getPort();
  const server = net.createServer(() => {
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {
    assert(!socket.eventNames().includes('timeout'));
    assert(!socket.eventNames().includes('data'));
    assert(!socket.eventNames().includes('close'));
    assert(!socket.eventNames().includes('drain'));
  });

  const onError = mock.fn(() => {});

  const onConnect = mock.fn(() => {
    setTimeout(() => {
      assert(socket.eventNames().includes('timeout'));
    });
  });

  createConnector(
    {
      onData: () => {},
      onClose,
      onConnect,
      onError,
      timeout: 1000 * 2,
    },
    () => socket,
  );

  await waitFor(1000 * 3);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);

  server.close();
});

test('createConnector timeout 2', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.write('aabb');
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});

  const onError = mock.fn((error) => {
    assert.equal(error.message, 'bbbb');
    assert(!socket.eventNames().includes('timeout'));
  });

  const onData = mock.fn(() => {
    assert(socket.eventNames().includes('timeout'));
    throw new Error('bbbb');
  });

  createConnector(
    {
      onData,
      onClose,
      onError,
      timeout: 1000 * 2,
    },
    () => socket,
  );

  await waitFor(200);
  assert.equal(onData.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  assert(socket.destroyed);
  server.close();
});

test('createConnector socket emit error', async () => {
  const port = getPort();
  const server = net.createServer(() => {});
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});
  const onConnect = mock.fn(() => {});

  const onError = mock.fn((error) => {
    assert.equal(error.message, 'aaaa');
    assert(!socket.eventNames().includes('connect'));
  });

  const onData = mock.fn(() => {
  });

  createConnector(
    {
      onData,
      onClose,
      onError,
      onConnect,
    },
    () => socket,
  );

  process.nextTick(() => {
    assert(socket.eventNames().includes('error'));
    assert(socket.eventNames().includes('connect'));
    socket.emit('error', new Error('aaaa'));
    assert(!socket.eventNames().includes('error'));
    assert(!socket.eventNames().includes('connect'));
  });

  await waitFor(200);
  assert.equal(onError.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  server.close();
});

test('createConnector socket emit error 2', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    if (!socket.writable) {
      socket.write(Buffer.from('aaa'));
    }
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});

  const onError = mock.fn((error) => {
    assert.equal(error.message, 'cccc');
    assert(!socket.eventNames().includes('connect'));
  });

  const onData = mock.fn(() => {});

  const onConnect = mock.fn(() => {
    socket.emit('error', new Error('cccc'));
    process.nextTick(() => {
      assert(!socket.eventNames().includes('data'));
      assert(!socket.eventNames().includes('drain'));
      assert(!socket.eventNames().includes('close'));
    });
  });

  createConnector(
    {
      onData,
      onConnect,
      onClose,
      onError,
    },
    () => socket,
  );

  await waitFor(200);
  assert.equal(onData.mock.calls.length, 0);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  server.close();
});

test('createConnector end before connect', async () => {
  const port = getPort();
  const server = net.createServer(() => {});
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onData = mock.fn(() => {});
  const onConnect = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn((error) => {
    assert.equal(error.message, 'end fail, socket is not connect');
  });

  const connector = createConnector(
    {
      onData,
      onConnect,
      onClose,
      onError,
    },
    () => socket,
  );

  assert(socket.eventNames().includes('connect'));

  connector.end();
  assert(!socket.eventNames().includes('finish'));
  assert(!socket.eventNames().includes('connect'));

  await waitFor(200);
  assert.equal(onError.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onConnect.mock.calls.length, 0);
  server.close();
});

test('createConnector end', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'aabb');
  });
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const state = {
    connector: null,
  };

  const onConnect = mock.fn(() => {
    state.connector.end(Buffer.from('aabb'));
    assert(socket.eventNames().includes('finish'));
  });
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onConnect,
      onClose,
      onError,
    },
    () => socket,
  );

  await waitFor(300);
  assert(!socket.eventNames().includes('finish'));
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  server.close();
});

test('createConnector end 2', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {
  });
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const state = {
    connector: null,
  };

  const onConnect = mock.fn(() => {
    state.connector.end(Buffer.from('aabb'));
    assert(!socket.destroyed);
    assert(socket.eventNames().includes('error'));
    socket.emit('error', new Error('33333'));
    assert(socket.destroyed);
    assert(!socket.eventNames().includes('error'));
    setTimeout(() => {
      assert(!socket.eventNames().includes('data'));
    });
  });
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onConnect,
      onClose,
      onError,
    },
    () => socket,
  );

  await waitFor(300);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  server.close();
});

test('createConnector end 3', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn((chunk) => {
    assert.equal(chunk.toString(), '44557788');
  });
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const state = {
    connector: null,
  };

  const onConnect = mock.fn(() => {
    state.connector.end();
  });
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onConnect,
      onClose,
      onError,
    },
    () => socket,
  );

  state.connector.write(Buffer.from('4455'));
  state.connector.write(Buffer.from('7788'));

  await waitFor(300);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  server.close();
});

test('createConnector open resume', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {
  });
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);

    setTimeout(() => {
      socket.end('aabbcc');
    });
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  await waitFor(100);

  const state = {
    connector: null,
  };

  const onConnect = mock.fn(() => {
    socket.pause();
  });
  const controller = new AbortController();
  const onData = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'aabbcc');
  });
  const onClose = mock.fn(() => {
    assert(!controller.signal.aborted);
  });
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onConnect,
      onClose,
      onError,
      timeout: 1000 * 20,
    },
    () => socket,
    controller.signal,
  );

  await waitFor(300);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 1);
  server.close();
});

test('createConnector end after write', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'ccbb');
  });
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
  });
  server.listen(port);

  const socket = net.Socket();

  socket.connect({
    host: '127.0.0.1',
    port,
  });

  await waitFor(100);

  const state = {
    connector: null,
  };

  const onConnect = mock.fn(() => {
    state.connector.end(Buffer.from('ccbb'));
    setTimeout(() => {
      assert(socket.eventNames().includes('error'));
      assert(!socket.eventNames().includes('data'));
    });
    try {
      state.connector.write(Buffer.from('dd'));
      throw new Error('xxxx');
    } catch (error) {
      assert(error instanceof assert.AssertionError);
    }
  });
  const onData = mock.fn(() => {});
  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  state.connector = createConnector(
    {
      onData,
      onConnect,
      onClose,
      onError,
    },
    () => socket,
  );

  await waitFor(300);

  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  server.close();
});

test('createConnector onClose', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    setTimeout(() => {
      socket.write('aa');
    }, 10);
    setTimeout(() => {
      socket.write('bb');
    }, 30);
    setTimeout(() => {
      socket.write('cc');
      socket.end();
    }, 60);
  });
  server.listen(port);

  const socket = net.Socket();
  const onError = mock.fn(() => {});
  const onClose = mock.fn((buf) => {
    assert.equal(buf.toString(), '');
  });
  const onData = mock.fn(() => {});
  createConnector(
    {
      onData,
      onClose,
      onError,
    },
    () => socket,
  );

  socket.connect({
    host: '127.0.0.1',
    port,
  });
  await waitFor(500);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onData.mock.calls.length, 3);
  assert.equal(
    Buffer.concat(onData.mock.calls.map((d) => d.arguments[0])),
    'aabbcc',
  );
  server.close();
});

test('createConnector onClose 2', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    setTimeout(() => {
      socket.write('aa');
    }, 10);
    setTimeout(() => {
      socket.write('bb');
    }, 30);
    setTimeout(() => {
      socket.write('cc');
      socket.end();
    }, 60);
  });
  server.listen(port);

  const socket = net.Socket();
  const onError = mock.fn(() => {});
  const onClose = mock.fn((buf) => {
    assert.equal(buf.toString(), 'aabbcc');
  });
  createConnector(
    {
      onClose,
      onError,
    },
    () => socket,
  );

  socket.connect({
    host: '127.0.0.1',
    port,
  });
  await waitFor(500);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 1);
  server.close();
});

test('createConnector, stream with outgoing abort', () => {
  const port = getPort();
  const controller = new AbortController();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_888`);
  const ws = fs.createWriteStream(pathname);
  const server = net.createServer((socket) => {
    socket.pipe(ws);
    socket.on('close', () => {
      ws.end();
    });
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
    setTimeout(() => {
      if (!controller.signal.aborted) {
        assert(socket.eventNames().includes('data'));
        assert(socket.eventNames().includes('drain'));
        assert(socket.eventNames().includes('close'));
        assert(!socket.destroyed);
        controller.abort();
        assert(!socket.eventNames().includes('data'));
        assert(!socket.eventNames().includes('drain'));
        assert(!socket.eventNames().includes('close'));
        assert(socket.destroyed);
      }
    }, 1000);
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
    controller.signal,
  );
  const content = 'aabbccddee';
  function walk() {
    while (!isPause) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      try {
        const ret = connector.write(Buffer.from(s));
        if (ret === false) {
          isPause = true;
        }
        i++;
      } catch (error) {
        break;
      }
    }
  }

  setTimeout(() => {
    walk();
  }, 200);

  ws.on('finish', () => {
    setTimeout(() => {
      server.close();
      fs.unlinkSync(pathname);
      assert.equal(onError.mock.calls.length, 0);
      assert.equal(onClose.mock.calls.length, 0);
      assert(socket.destroyed);
    }, 100);
  });
});

test('createConnector stream with incoming abort', () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_4444_aaa`);
  const ws = fs.createWriteStream(pathname);
  const content = 'aaaaaaaabbbbbbbcccccc';
  let i = 0;
  const controller = new AbortController();
  const server = net.createServer((socket) => {
    let isPause = false;
    socket.on('error', () => {});
    function walk() {
      while (!isPause && !socket.destroyed) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(Buffer.from(s));
        if (ret === false) {
          isPause = true;
        }
        i++;
      }
    }

    socket.on('drain', () => {
      isPause = false;
      walk();
    });

    setTimeout(() => {
      walk();
    }, 50);
  });
  server.listen(port);

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const state = {
    connector: null,
  };

  const onError = mock.fn(() => {});

  const onClose = mock.fn(() => {});

  ws.on('drain', () => {
    state.connector.resume();
    setTimeout(() => {
      if (!controller.signal.aborted) {
        assert(socket.eventNames().includes('close'));
        assert(socket.eventNames().includes('data'));
        assert(socket.eventNames().includes('drain'));
        assert(!socket.destroyed);
        controller.abort();
        assert(!socket.eventNames().includes('close'));
        assert(!socket.eventNames().includes('data'));
        assert(!socket.eventNames().includes('drain'));
        assert(socket.destroyed);
        ws.end();
      }
    }, 1000);
  });

  ws.on('finish', () => {
    setTimeout(() => {
      server.close();
      fs.unlinkSync(pathname);
      assert.equal(onError.mock.calls.length, 0);
      assert.equal(onClose.mock.calls.length, 0);
    }, 100);
  });

  state.connector = createConnector(
    {
      onData: (chunk) => ws.write(chunk),
      onError,
      onClose,
    },
    () => socket,
    controller.signal,
  );
});

test('createConnector end signal abort', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});

  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
  });
  server.listen(port);
  const controller = new AbortController();

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const s = `${_.times(80000).map(() => 'adfasdfw;asdfw').join('')}`;

  const connector = createConnector(
    {
      onConnect: () => {
        connector.end(Buffer.from(s));
        controller.abort();
      },
      onClose,
      onError,
    },
    () => socket,
    controller.signal,
  );

  await waitFor(500);
  server.close();
  assert(controller.signal.aborted);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  assert(handleDataOnSocket.mock.calls.length > 0);
  assert.equal(
    Buffer.concat(handleDataOnSocket.mock.calls.map((d) => d.arguments[0])),
    s,
  );
});

test('createConnector signal abort 1', () => {
  const port = getPort();

  const server = net.createServer((socket) => {
    socket.on('data', () => {});
  });
  server.listen(port);
  const controller = new AbortController();

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});

  const connector = createConnector(
    {
      onClose,
      onError,
    },
    () => socket,
    controller.signal,
  );
  let i = 0;
  const tick = setInterval(() => {
    try {
      connector.write(Buffer.from(`aaa:${i}`));
      if (controller.signal.aborted) {
        throw new Error('xxx');
      }
      i++;
    } catch (error) {
      assert(controller.signal.aborted);
      assert(error.message !== 'xxx');
      clearInterval(tick);
      setTimeout(() => {
        assert.equal(onClose.mock.calls.length, 0);
        assert.equal(onError.mock.calls.length, 0);
        server.close();
      }, 100);
    }
  }, 1);
  setTimeout(() => {
    controller.abort();
  }, 2000);
});

test('createConnector signal abort 2', () => {
  const port = getPort();

  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    let i = 0;
    const tick = setInterval(() => {
      socket.write(Buffer.from(`aaaadfasdfwefasdfasdf asdfawefasdfasw:${i}`));
      i++;
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearInterval(tick);
    });
  });
  server.listen(port);
  const controller = new AbortController();

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  let aborted = false;
  const onData = mock.fn(() => {
    aborted = controller.signal.aborted;
  });

  createConnector(
    {
      onClose,
      onData,
      onError,
    },
    () => socket,
    controller.signal,
  );
  setTimeout(() => {
    controller.abort();
  }, 2000);
  setTimeout(() => {
    assert(!aborted);
    assert(socket.destroyed);
    assert(!socket.eventNames().includes('data'));
    assert.equal(onClose.mock.calls.length, 0);
    assert.equal(onError.mock.calls.length, 0);
    assert(onData.mock.calls.length > 0);
    server.close();
  }, 2500);
});

test('createConnector read epipe', async () => {
  const port = getPort();

  const server = net.createServer((socket) => {
    const content = 'asdfbgbasd fasdfawefadsf';
    setTimeout(() => {
      let j = 0;
      while (j < 60000) {
        const s = `${_.times(300).map(() => content).join('')}:${j}`;
        socket.write(s);
        j++;
      }
    }, 100);
    socket.on('close', () => {
      server.close();
    });
    socket.on('error', () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
      server.close();
    });
  });
  server.listen(port);
  const controller = new AbortController();

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onClose = mock.fn(() => {});
  const onError = mock.fn(() => {});
  const onData = mock.fn(() => {});

  const onConnect = mock.fn(() => {
    setTimeout(() => {
      controller.abort();
    }, 200);
  });

  createConnector(
    {
      onConnect,
      onClose,
      onData,
      onError,
    },
    () => socket,
    controller.signal,
  );
  await waitFor(1000);
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 0);
  assert.equal(onClose.mock.calls.length, 0);
  assert(controller.signal.aborted);
});

test('createConnector onClose trigger error', async () => {
  const port = getPort();

  const server = net.createServer((socket) => {
    socket.on('data', () => {});
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

  const onConnect = mock.fn(() => {});
  const onClose = mock.fn(() => {
    throw new Error('bbb');
  });
  const onError = mock.fn((error) => {
    assert.equal(error.message, 'bbb');
  });

  createConnector(
    {
      onConnect,
      onClose,
      onError,
    },
    () => socket,
  );
  await waitFor(1000);
  server.close();
  assert.equal(onConnect.mock.calls.length, 1);
  assert.equal(onClose.mock.calls.length, 1);
  assert.equal(onError.mock.calls.length, 1);
});

test('createConnector detach', async () => {
  const port = getPort();

  const server = net.createServer(() => {
  });
  server.listen(port);

  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });

  const onConnect = mock.fn(() => {});
  const onClose = mock.fn(() => {
  });

  const onError = mock.fn(() => {});
  const controller = new AbortController();

  const connector = createConnector(
    {
      onConnect,
      onClose,
      onError,
    },
    () => socket,
    controller.signal,
  );
  await waitFor(500);
  assert(socket.eventNames().includes('data'));
  assert(socket.eventNames().includes('drain'));
  assert(socket.eventNames().includes('error'));
  assert.equal(onConnect.mock.calls.length, 1);
  const s = connector.detach();
  assert.equal(s, socket);
  assert(!socket.eventNames().includes('data'));
  assert(!socket.eventNames().includes('drain'));
  assert(!socket.eventNames().includes('error'));
  assert.equal(connector.detach(), null);
  await waitFor(100);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  socket.destroy();
  await waitFor(100);
  assert.equal(onClose.mock.calls.length, 0);
  assert.equal(onError.mock.calls.length, 0);
  server.close();
});
