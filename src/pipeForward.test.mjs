import test from 'node:test';
import net from 'node:net';
import assert from 'node:assert';
import pipeForward from './pipeForward.mjs';

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
