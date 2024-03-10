export class ConnectorWriteAfterActiveError extends Error { // eslint-disable-line
  constructor(message) {
    super(message);
    this.message = message || 'Connector Write Error, is not active';
  }
}

export class SocketConnectError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Connect Error';
  }
}

export class SocketCloseError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Close Error';
  }
}

export class NotIsSocketError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Invalid';
  }
}

export class SocketUnableOperateError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Unalbe Operate';
  }
}

export class SocketConnectTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Connect Timeout';
  }
}

export class ConnectorCreateError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Create Connector Fail';
  }
}

export class SocketPipeTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Pipe Timeout';
  }
}

export class SocketPipeError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Pipe Error';
  }
}
