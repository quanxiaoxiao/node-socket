/* eslint no-use-before-define: 0 */
/* eslint no-loop-func: 0 */
import net from 'node:net';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import _ from 'lodash';
import createConnector from '../src/createConnector.mjs';

const port = 5256;
let index = 0;
let countComplete = 0;
const count = 120;

const dir = path.resolve(process.cwd(), '_temp');

const server = net.createServer((socket) => {
  index++;
  const countRepeat = _.random(400, 1200);
  let j = 0;
  const content = `aabbccddee_${index}`;
  socket.on('drain', () => {
    walk();
  });
  function walk() {
    while (j < countRepeat && !socket.writableEnded) {
      if (j === 0) {
        socket.write(`--${countRepeat}--`);
      }
      const s = `${_.times(800).map(() => content).join('')}:${j}`;
      j++;
      const ret = socket.write(Buffer.from(s));
      if (ret === false) {
        break;
      }
    }
    if (j >= countRepeat && !socket.writableEnded) {
      socket.end();
    }
  }
  walk();
});

server.listen(port);

const check = () => {
  const fileList = fs.readdirSync(dir);
  assert(fileList.length === count);
  for (let i = 0; i < fileList.length; i++) {
    const filename = fileList[i];
    const pathname = path.join(dir, filename);
    const str = fs.readFileSync(pathname).toString();
    const matches = str.match(/^--(\d+)--/);
    if (!matches) {
      process.exit(1);
    }
    const matches2 = str.match(/:(\d+)$/);
    if (!matches2) {
      process.exit(1);
    }
    assert(parseInt(matches[1], 10) === (parseInt(matches2[1], 10) + 1));
    fs.unlinkSync(pathname);
  }
};

setTimeout(() => {
  for (let i = 0; i < count; i++) {
    const filename = `incoming_test_data_${i}`;
    const pathname = path.join(dir, filename);
    const ws = fs.createWriteStream(pathname);
    ws.on('finish', () => {
      countComplete++;
      console.log(`finish, complete:${countComplete}  --- ${pathname}`);
      if (countComplete === count) {
        setTimeout(() => {
          server.close();
          check();
        }, 100);
      }
    });
    const connector = createConnector(
      {
        onData: (chunk) => ws.write(chunk),
        onClose: () => {
          ws.end();
        },
        onError: (error) => {
          console.log(error);
          process.eixt(1);
        },
      },
      () => {
        const socket = net.Socket();
        socket.connect({
          host: '127.0.0.1',
          port,
        });
        return socket;
      },
    );
    ws.on('drain', () => {
      connector.resume();
    });
  }
}, 100);
