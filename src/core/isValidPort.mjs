export default (port) => {
  const n = parseInt(port, 10);
  return `${n}` === `${port}` && port >= 0 && port <= 65535;
};
