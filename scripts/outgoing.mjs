/* eslint no-inner-declarations: 0 */
/* eslint no-use-before-define: 0 */
import net from 'node:net';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import _ from 'lodash';
import createConnector from '../src/createConnector.mjs';

const port = 5255;

const count = 64;
let index = 0;
let countComplete = 0;

const dir = path.resolve(process.cwd(), '_temp');

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

const server = net.createServer((socket) => {
  const filename = `outoging_test_data_${index}`;
  const pathname = path.join(dir, filename);
  const ws = fs.createWriteStream(pathname);
  socket.pipe(ws);
  socket.once('close', () => {
    console.log(`\`${filename}\`, complete: ${countComplete}`);
    if (count - 1 === countComplete) {
      console.log('done');
      setTimeout(() => {
        server.close();
        check();
      }, 100);
    }
    countComplete++;
  });
  index++;
});

server.listen(port);

setTimeout(() => {
  for (let i = 0; i < count; i++) {
    const content = `aabbccddee_${i}`;
    let isPause = false;
    const connector = createConnector(
      {
        onConnect: () => {
          setTimeout(() => {
            walk();
          }, 200);
        },
        onDrain: () => {
          assert(isPause);
          isPause = false;
          walk();
        },
        onError: (error) => {
          console.log(error);
          process.exit(1);
        },
        onClose: () => {
          console.log('close');
          process.exit(1);
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
    const countRepeat = _.random(400, 1200);
    let j = 0;

    function walk() {
      while (j < countRepeat && !isPause) {
        if (j === 0) {
          connector.write(`--${countRepeat}--`);
        }
        const s = `${_.times(800).map(() => content).join('')}:${j}`;
        const ret = connector.write(Buffer.from(s));
        if (ret === false) {
          isPause = true;
        }
        j++;
      }
      if (j >= countRepeat) {
        connector.end();
      }
    }
  }
}, 100);
