import net from 'node:net';

const port = 5257;

const server = net.createServer((socket) => {
  socket.on('data', (chunk) => {
    console.log(chunk.toString());
  });
  setTimeout(() => {
    setTimeout(() => {
      socket.destroy();
      setTimeout(() => {
        server.close();
      }, 200);
    }, 50);
  }, 200);
  socket.on('error', () => {});
  /*
  const content = 'asdfbgb';
  setTimeout(() => {
    let j = 0;
    while (j < 60000) {
      const s = `${_.times(300).map(() => content).join('')}:${j}`;
      socket.write(s);
      j++;
    }
  }, 100);
  socket.on('close', () => {
    console.log('close');
    server.close();
  });
  socket.on('error', (error) => {
    console.log(error);
    if (!socket.destroyed) {
      socket.destroy();
    }
    setTimeout(() => {
      server.close();
    }, 100);
  });
  */
});

server.listen(port);
