import assert from 'node:assert';
import net from 'node:net';
import { test } from 'node:test';
import waitConnect from './waitConnect.mjs';

const _getPort = () => {
  let _port = 5750;
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

test('waitConnect invalid', () => {
  assert.throws(
    () => {
      const socket = net.Socket();
      waitConnect(socket);
    },
    (error) => {
      return error instanceof assert.AssertionError;
    },
  );
});

test('waitConnect 1', async () => {
  const socket = net.Socket();
  try {
    socket.connect({
      host: '127.0.0.1',
      port: 9998,
    });
    await waitConnect(socket);
    throw new Error('xxxx');
  } catch (error) {
    assert(!socket.eventNames().includes('connect'));
    assert(error.message !== 'xxxx');
    assert(socket.eventNames().includes('error'));
    assert(!!error.message.match(/ECONNREFUSED/));
  }
  await waitFor(200);
  assert(!socket.eventNames().includes('error'));
});

test('waitConnect connect timeout', async () => {
  const now = Date.now();
  const timeout = 3000;
  const socket = net.Socket();
  try {
    socket.connect({
      host: '192.168.101.66',
      port: 9998,
    });
    await waitConnect(socket, timeout);
    throw new Error('xxxx');
  } catch (error) {
    assert.equal(error.message, 'timeout');
    const diff = Date.now() - now;
    assert(diff >= timeout && diff < timeout + 100);
    assert(socket.destroyed);
    assert(socket.eventNames().includes('error'));
    assert(!socket.eventNames().includes('connect'));
  }
  await waitFor(200);
  assert(!socket.eventNames().includes('error'));
});

test('waitConnect connect signal abort', async () => {
  const now = Date.now();
  const timeout = 3000;
  const socket = net.Socket();
  const controller = new AbortController();
  try {
    socket.connect({
      host: '192.168.101.66',
      port: 9998,
    });
    setTimeout(() => {
      controller.abort();
    }, 100);
    await waitConnect(socket, timeout, controller.signal);
    throw new Error('xxxx');
  } catch (error) {
    assert.equal(error.message, 'abort');
    const diff = Date.now() - now;
    assert(diff >= 100 && diff < 200);
    assert(socket.destroyed);
    assert(socket.eventNames().includes('error'));
    assert(!socket.eventNames().includes('connect'));
  }
  await waitFor(200);
  assert(!socket.eventNames().includes('error'));
});

test('waitConnect 111', async () => {
  const port = getPort();
  const server = net.createServer(() => {
  });
  server.listen(port);
  const socket = net.Socket();
  await waitFor(100);
  socket.connect({
    host: '127.0.0.1',
    port,
  });
  assert.equal(socket.readyState, 'opening');
  await waitConnect(socket);
  assert(socket.eventNames().includes('error'));
  assert(!socket.eventNames().includes('connect'));
  await waitFor(200);
  assert(!socket.eventNames().includes('error'));
  assert(!socket.destroyed);
  assert.equal(socket.readyState, 'open');
  socket.destroy();
  await waitFor(100);
  server.close();
});
