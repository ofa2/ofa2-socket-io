import _ from 'lodash';
import humps from 'humps';
import socketIO from 'socket.io';

async function parseHeaders(keys, socket, next) {
  let errors = [];
  socket.userProps = {};
  keys.forEach(item => {
    let {
      key,
      header,
      required
    } = item;

    let value = _.get(socket, `request.headers['${header}']`);

    if (required && _.isUndefined(value)) {
      errors.push({
        key,
        message: 'required'
      });
      return null;
    }

    socket.userProps[key] = value;
    return null;
  });

  if (errors && errors.length) {
    socket.headersError = errors;
  }

  next();
  return null;
}

async function checkHeadersError(client) {
  if (client.headersError) {
    logger.info('client.headersError: ', client.authErrors);
    client.emit('unauthorized', {
      message: client.headersError
    }, () => {
      client.disconnect();
    });
  }
}

class Ofa2SocketIO {
  constructor({
    server,
    socketHeaderKeys = [],
    autoJoinRoom = true,
    propGet = true
  }) {
    this.server = server;
    this.socketHeaderKeys = socketHeaderKeys;
    this.autoJoinRoom = autoJoinRoom;
    this.propGet = propGet;
    this.io = null;
    this.keys = [];
    this.connectionListeners = [];
  }

  create() {
    this.parseSocketHeaderKeys();

    let extraHeader = _.map(this.keys, 'header');

    this.io = socketIO(this.server, {
      handlePreflightRequest(req, res) {
        extraHeader.unshift(...['content-type', 'authorization']);
        let headers = {
          'Access-Control-Allow-Headers': `${extraHeader.join(',')}`,
          'Access-Control-Allow-Origin': req.headers.origin,
          'Access-Control-Allow-Credentials': true
        };
        res.writeHead(200, headers);
        res.end();
      }

    }); // header 参数解析

    this.io.use((socket, next) => {
      return parseHeaders(this.keys, socket, next);
    });
    this.connectionListeners.push(checkHeadersError.bind(this)); // 加入某个 room

    if (this.autoJoinRoom) {
      this.connectionListeners.push(client => {
        client.join(this.getRoomId(client));
      });
    } // 快捷获取 属性


    if (this.propGet) {
      this.connectionListeners.push(client => {
        client.get = (propPath, defaultValue) => {
          return _.get(client.userProps, propPath, defaultValue);
        };
      });
    } // client error 监听


    this.connectionListeners.push(client => {
      client.on('error', error => {
        logger.warn('socket client error: ', error);
      });
    });
    this.watchConnect();
  }

  get() {
    return this.io;
  }

  getRoomId(obj) {
    let props;

    if (obj.userProps) {
      props = obj.userProps;
    } else {
      props = obj;
    }

    let params = _.map(this.keys, 'key');

    return params.map(key => {
      let value = props[key];

      if (_.isString(value) || _.isNumber(value)) {
        return `${key}:${value}`;
      }

      logger.warn(`${key}.value should be string, but got`, value);
      return undefined;
    }).filter(value => {
      return value !== undefined;
    }).join('|');
  }

  emit(clientPropsOrRoomId, data, event) {
    if (!clientPropsOrRoomId) {
      logger.debug('emit to all with event: ', event, 'data: ', data);
      this.io.emit(event, data);
    }

    let roomId;

    if (_.isString(clientPropsOrRoomId)) {
      roomId = clientPropsOrRoomId;
    } else {
      roomId = this.getRoomId(clientPropsOrRoomId);
    }

    if (!roomId) {
      throw new Error('no roomId found');
    }

    logger.debug('roomId: ', roomId);
    logger.debug('event: ', event);
    logger.debug('data: ', data);
    this.io.to(roomId).emit(event, data);
    this.io.in(roomId).clients((err, clients) => {
      if (err) {
        return null;
      }

      logger.debug(`${roomId} clients length: `, clients.length);
      return null;
    });
  }

  addConnectionListener(fun) {
    this.connectionListeners.push(fun);
  }

  removeConnectionListener(fun) {
    this.connectionListeners.splice(this.connectionListeners.indexOf(fun), 1);
  }

  watchConnect() {
    this.io.on('connection', client => {
      logger.info('socket.io client connect, roomId:', this.getRoomId(client));
      this.connectionListeners.forEach(listener => {
        listener(client);
      });
    });
  }

  parseSocketHeaderKeys() {
    this.keys = _.map(this.socketHeaderKeys, item => {
      if (_.isString(item)) {
        return {
          key: item,
          header: humps.decamelize(item, {
            separator: '-'
          }),
          required: false
        };
      } else if (_.isPlainObject(item)) {
        return {
          key: item.key,
          header: item.header ? item.header : `x-${humps.decamelize(item.key, {
            separator: '-'
          })}`,
          required: !!item.required
        };
      }

      throw new Error(`not support header key: ${JSON.stringify(item)}`);
    });
    this.keys = _.sortBy(this.keys, 'key');
  }

}

async function lift() {
  let {
    headerKeys,
    autoJoinRoom,
    propGet
  } = this.config.socket;
  let ofa2SocketIO = new Ofa2SocketIO(this.server, headerKeys, autoJoinRoom, propGet);
  ofa2SocketIO.create();
  this.io = ofa2SocketIO;
}

async function lower() {
  this.io.close();
}

var index = {
  lift,
  lower
};

export default index;
//# sourceMappingURL=bundle.esm.js.map
