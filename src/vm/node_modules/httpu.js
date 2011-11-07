// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var http = require('http');
var net = require('net');
var inherits = require('util').inherits;

// HTTPU agents.
var agents = {};

function Agent(options) {
  // Overload, since this gets invoked by node internals
  options.host = options.socketPath;
  http.Agent.call(this, options);
}
inherits(Agent, http.Agent);

Agent.prototype.defaultPort = -1; // Make sure this becomes meaningless...

Agent.prototype._getConnection = function(host, port, cb) {
  // Overloading host to be socketPath here...
  var c = net.createConnection(host);
  c.on('connect', cb);
  return c;
};

function getAgent(options) {
  if (!options.socketPath) throw new TypeError('options.socketPath required');

  var id = options.socketPath;
  var agent = agents[id];

  if (!agent) {
    agent = agents[id] = new Agent(options);
  }

  return agent;
}
exports.getAgent = getAgent;
exports.Agent = Agent;

exports.request = function(options, cb) {
  if (options.agent === undefined) {
    options.agent = getAgent(options);
  } else if (options.agent === false) {
    options.agent = new Agent(options);
  }
  return http._requestFromAgent(options, cb);
};


exports.get = function(options, cb) {
  options.method = 'GET';
  var req = exports.request(options, cb);
  req.end();
  return req;
};
