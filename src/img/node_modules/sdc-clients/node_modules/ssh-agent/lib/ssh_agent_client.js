// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var assert = require('assert');
var net = require('net');
var util = require('util');

var ctype = require('ctype');



///--- Globals

var PROTOCOL = {
  SSH_AGENTC_REQUEST_RSA_IDENTITIES: 11,
  SSH_AGENT_IDENTITIES_ANSWER: 12,
  SSH2_AGENTC_SIGN_REQUEST: 13,
  SSH2_AGENT_SIGN_RESPONSE: 14,
  SSH_AGENT_FAILURE: 5,
  SSH_AGENT_SUCCESS: 6
};



///--- Specific Errors

function MissingEnvironmentVariableError(variable) {
  this.name = 'MissingEnvironmentVariableError';
  this.message = variable + ' was not found in your environment';
  this.variable = variable;
  Error.captureStackTrace(this, MissingEnvironmentVariableError);
}
util.inherits(MissingEnvironmentVariableError, Error);


function TimeoutError(message) {
  this.name = 'TimeoutError';
  this.message = message;
  Error.captureStackTrace(this, TimeoutError);
}
util.inherits(TimeoutError, Error);


function InvalidProtocolError(message) {
  this.name = 'InvalidProtocolError';
  this.message = message;
  Error.captureStackTrace(this, InvalidProtocolError);
}
util.inherits(InvalidProtocolError, Error);



///---  Internal Helpers

function _newBuffer(buffers, additional) {
  assert.ok(buffers);

  var len = 5; // length + tag
  for (var i = 0; i < buffers.length; i++)
    len += 4 + buffers[i].length;

  if (additional)
    len += additional;

  return new Buffer(len);
}


function _readString(buffer, offset) {
  assert.ok(buffer);
  assert.ok(offset !== undefined);

  var i = 0;

  var len = ctype.ruint32(buffer, 'big', offset);
  offset += 4;

  var str = new Buffer(len);
  buffer.copy(str, 0, offset, offset + len);

  return str;
}


function _writeString(request, buffer, offset) {
  assert.ok(request);
  assert.ok(buffer);
  assert.ok(offset !== undefined);

  ctype.wuint32(buffer.length, 'big', request, offset);
  offset += 4;
  buffer.copy(request, offset);

  return offset + buffer.length;
}


function _readHeader(response, expect) {
  assert.ok(response);

  var len = ctype.ruint32(response, 'big', 0);
  var type = ctype.ruint8(response, 'big', 4);

  return (expect === type ? len : -1);
}


function _writeHeader(request, tag) {
  ctype.wuint32(request.length - 4, 'big', request, 0);
  ctype.wuint8(tag, 'big', request, 4);
  return 5;
}



///--- API

/**
 * Creates a new SSHAgentClient.
 *
 * Note that the environment variable SSH_AUTH_SOCK must be set, else
 * this will throw.
 *
 * @param {Object} options (optional) only supported flag is timeout (in ms).
 * @throws {MissingEnvironmentVariableError} on SSH_AUTH_SOCK not being set.
 * @constructor
 */
function SSHAgentClient(options) {
  if (options) {
    this.timeout = options.timeout || 1000;
  }

  this.sockFile = process.env.SSH_AUTH_SOCK;
  if (!this.sockFile)
    throw new MissingEnvironmentVariableError('SSH_AUTH_SOCK');
}


/**
 * Lists all SSH keys available under this session.
 *
 * This returns an array of objects of the form:
 * {
 *   type: 'ssh-rsa',
 *   ssh_key: '<base64 string>',
 *   comment: '/Users/mark/.ssh/id_rsa'
 * }
 *
 * @param {Function} callback of the form f(err, keys).
 * @throws {TypeError} on invalid arguments.
 */
SSHAgentClient.prototype.requestIdentities = function(callback) {
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) is required');

  function requestIdentities() {
    var request = new Buffer(4 + 1);
    _writeHeader(request, PROTOCOL.SSH_AGENTC_REQUEST_RSA_IDENTITIES);
    return request;
  }

  function identitiesAnswer(response) {
    assert.ok(response);

    var numKeys = ctype.ruint32(response, 'big', 0);

    var offset = 4;
    var keys = [];
    for (var i = 0; i < numKeys; i++) {
      var key = _readString(response, offset);
      offset += 4 + key.length;
      var comment = _readString(response, offset);
      offset += 4 + comment.length;
      var type = _readString(key, 0);

      keys.push({
        type: type.toString('ascii'),
        ssh_key: key.toString('base64'),
        comment: comment.toString('utf8'),
        _raw: key
      });
    }

    return callback(null, keys);
  }

  return this._request(requestIdentities,
                       identitiesAnswer,
                       PROTOCOL.SSH_AGENT_IDENTITIES_ANSWER,
                       callback);
};


/**
 * Asks the SSH Agent to sign some data given a key.
 *
 * The key object MUST be the object retrieved from
 * requestIdentities.  Data is a Buffer.  The response
 * you get back is an object of the form:
 *
 * {
 *   type: 'ssh-rsa',
 *   signature: 'base64 string'
 * }
 *
 * @param {Object} key a key from requestIdentities.
 * @param {Object} data a Buffer.
 * @param {Function} callback of the form f(err, signature).
 * @throws {TypeError} on invalid arguments.
 */
SSHAgentClient.prototype.sign = function(key, data, callback) {
  if (!key || typeof(key) !== 'object')
    throw new TypeError('key (object) required');
  if (!data || typeof(data) !== 'object')
    throw new TypeError('key (buffer) required');
  if (!callback || typeof(callback) !== 'function')
    throw new TypeError('callback (function) is required');

  function signRequest() {
    // Length + tag + 2 length prefixed strings + trailing flags(NULL)
    var request = new Buffer(4 + 1 + 4 + key._raw.length + 4 + data.length + 4);
    var offset = _writeHeader(request, PROTOCOL.SSH2_AGENTC_SIGN_REQUEST);
    offset = _writeString(request, key._raw, offset);
    offset = _writeString(request, data, offset);
    ctype.wuint32(0, 'big', request, offset);
    return request;
  }

  function signatureResponse(response) {
    assert.ok(response);

    var blob = _readString(response, 0);
    var type = _readString(blob, 0);
    var signature = _readString(blob, type.length + 4);

    return callback(null, {
      type: type,
      signature: signature.toString('base64'),
      _raw: signature
    });
  }

  return this._request(signRequest,
                       signatureResponse,
                       PROTOCOL.SSH2_AGENT_SIGN_RESPONSE,
                       callback);
};



///--- Private Methods

SSHAgentClient.prototype._request = function(getRequest,
                                       parseResponse,
                                       messageType,
                                       callback) {
  assert.ok(getRequest && typeof(getRequest) === 'function');
  assert.ok(parseResponse && typeof(parseResponse) === 'function');
  assert.ok(messageType && typeof(messageType) === 'number');
  assert.ok(callback && typeof(callback) === 'function');

  var self = this;
  var socket = net.createConnection(this.sockFile);

  socket.on('data', function(data) {
    var len = ctype.ruint32(data, 'big', 0);
    if (len !== data.length - 4) {
      return callback(new InvalidProtocolError('Expected length: ' +
                                               len + ' but got: ' +
                                               data.length));
    }

    var type = ctype.ruint8(data, 'big', 4);
    if (type !== messageType) {
      return callback(new InvalidProtocolError('Expected message type: ' +
                                               messageType +
                                               ' but got: ' + type));
    }

    socket.end();
    return parseResponse(data.slice(5));
  });

  socket.on('connect', function() {
    socket.write(getRequest());
  });

  socket.on('error', function(err) {
    return callback(err);
  });

  socket.setTimeout(this.timeout, function() {
    socket.end();
    var e = new TimeoutError('request timed out after: ' + self.timeout);
    return callback(e);
  });

  return socket;
};



module.exports = SSHAgentClient;

