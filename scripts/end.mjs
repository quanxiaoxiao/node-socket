import net from 'node:net';
import _ from 'lodash';
import createConnector from '../src/createConnector.mjs';

const port = 5257;

const connector = createConnector(
  {
    onConnect: () => {
      console.log('connect');
      setTimeout(() => {
        const content = 'casdfwbbb';
        let i = 0;
        while (i < 10000) {
          const s = `${_.times(300).map(() => content).join('')}:${i}`;
          connector.write(s);
          i++;
        }
        /*
        setTimeout(() => {
          console.log('end');
          try {
            connector.end();
          } catch (error) {
            // ---
          }
        }, 20);
        */
      }, 100);
    },
    onData: () => {
    },
    onClose: () => {
      console.log('close');
    },
    onError: (error) => {
      console.log('-------- error', error);
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
