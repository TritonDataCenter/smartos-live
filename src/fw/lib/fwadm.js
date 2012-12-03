/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 *
 * fwadm: CLI logic
 */

var assert = require('assert-plus');
var cli = require('./cli');
var clone = require('clone');
var fw = require('../lib/fw');
var nopt = require('/usr/vm/node_modules/nopt');
var path = require('path');
var pipeline = require('./pipeline').pipeline;
var util = require('util');
var vasync = require('vasync');
var VM = require('/usr/vm/node_modules/VM');



// --- Globals



var LONG_OPTS = {
  'dryrun': Boolean,
  'file': path,
  'json': Boolean,
  'stdout': Boolean,
  'verbose': Boolean
};
var SHORT_OPTS = {
  'f': '--file',
  'j': '--json',
  'v': '--verbose'
};



// --- Utilities



/**
 * Program usage
 */
function usage() {
  var text = [
    'Usage: ' + path.basename(process.argv[1]) + ' <command> [options]',
    '',
    'Commands:',
    '',
    'list',
    'get <rule uuid>',
    'add -f <filename>',
    'update -f <filename>',
    'enable <rule uuid> [uuid 2 ...]',
    'disable <rule uuid> [uuid 2 ...]',
    'delete <rule uuid> [uuid 2 ...]',
    'start <VM uuid>',
    'stop <VM uuid>',
    'stats <VM uuid>',
    'status <VM uuid>',
    'rules <VM uuid>'
  ];
  console.log(text.join('\n'));
}


/**
 * Translates the payload into the format expected by fw.js
 */
function preparePayload(opts, payload) {
  var newOpts = {};
  if (payload) {
    newOpts = clone(payload);

    if (newOpts.hasOwnProperty('rule')) {
      // This is a single rule, not a list
      newOpts.rules = [ newOpts.rule ];
      delete newOpts.rule;
    }
  }

  newOpts.dryrun = opts.dryrun || false;
  if (opts.stdout) {
    newOpts.filecontents = true;
  }

  return newOpts;
}


/**
 * Displays the results of a command that adds or updates rules
 */
function ruleOutput(err, res, opts, action) {
  if (err) {
    return cli.outputError(err, opts);
  }

  if (opts.json) {
    return console.log(cli.json(res));
  }

  if (opts.stdout && res.hasOwnProperty('files')) {
    for (var f in res.files) {
      console.log('=== %s', f);
      console.log(res.files[f]);
      console.log('');
    }
  }

  var out = [util.format('%s rules:', action)];
  res.rules.forEach(function (r) {
    out.push(cli.ruleLine(r));
  });

  if (opts.verbose) {
    out.push('');
    out.push('VMs affected:');
    out = out.concat(res.vms);
  }
  console.log(out.join('\n'));
}


/**
 * Performs an update
 */
function doUpdate(opts, action) {
  try {
    assert.object(opts, 'opts');
    assert.string(action, 'action');
  } catch (err) {
    return cli.outputError(err);
  }

  pipeline({
    funcs: [
      function vms(_, cb) { VM.lookup({}, { 'full': true }, cb); },
      function updateRules(state, cb) {
        opts.vms = state.vms;
        return fw.update(opts, cb);
      }
    ]}, function _afterUpdate(err, res) {
      return ruleOutput(err, res.state.updateRules, opts, action);
    });
}


/**
 * Starts or stops the firewall for a VM
 */
function startStop(opts, enabled) {
  var uuid = cli.validateUUID(opts.argv.remain[1]);

  VM.update(uuid, { firewall_enabled: enabled }, function _afterUpdate(err) {
    if (err) {
      return cli.outputError(err, opts);
    }

    if (opts.json) {
      return console.log(cli.json({ result: 'success' }));
    }

    return console.log('Firewall %s for VM',
      enabled ? 'started' : 'stopped', uuid);
  });
}



// --- Command handlers



/**
 * Adds firewall rules
 */
function add(opts) {
  pipeline({
    funcs: [
      function payload(_, cb) { cli.getPayload(opts, cb); },
      function vms(_, cb) { VM.lookup({}, { 'full': true }, cb); },
      function addRules(state, cb) {
        var addOpts = preparePayload(opts, state.payload);
        addOpts.vms = state.vms;
        return fw.add(addOpts, cb);
      }
    ]}, function _afterAdd(err, results) {
      return ruleOutput(err, results.state.addRules, opts, 'Added');
    });
}


/**
 * Deletes a firewall rule
 */
function del(opts) {
  var uuids = opts.argv.remain.slice(1);
  if (uuids.length === 0) {
    return console.error('Must specify rules to delete!');
  }

  uuids.forEach(function (uuid) {
    cli.validateUUID(uuid);
  });

  pipeline({
    funcs: [
      function vms(_, cb) { VM.lookup({}, { 'full': true }, cb); },
      function delRules(state, cb) {
        var delOpts = preparePayload(opts);
        delOpts.vms = state.vms;
        delOpts.uuids = uuids;
        return fw.del(delOpts, cb);
      }
    ]}, function _afterDel(err, results) {
      if (err) {
        return cli.outputError(err);
      }
      var res = results.state.delRules;

      if (opts.json) {
        return cli.json(res);
      }

      var out = ['Deleted rules:'].concat(res.rules);

      if (opts.verbose) {
        out.push('');
        out.push('VMs affected:');
        out = out.concat(res.vms);
      }
      console.log(out.join('\n'));
    });
}


/**
 * Enables or disables firewall rules
 */
function enable(opts, val) {
  var uuids = opts.argv.remain.slice(1);
  if (uuids.length === 0) {
    return console.error('Must specify rules to enable!');
  }

  var rules = uuids.map(function (uuid) {
    return { uuid: cli.validateUUID(uuid), enabled: val };
  });
  var updateOpts = preparePayload(opts, rules);
  return doUpdate(updateOpts, val ? 'Enabled' : 'Disabled');
}


/**
 * Gets a firewall rule
 */
function get(opts) {
  var uuid = cli.validateUUID(opts.argv.remain[1]);
  return fw.get({ uuid: uuid }, function (err, rule) {
    if (err) {
      return cli.outputError(err, opts);
    }

    if (opts.json) {
      return console.log(cli.json(rule));
    }

    return console.log(cli.ruleLine(rule));
  });
}


/**
 * Lists firewall rules
 */
function list(opts) {
  // XXX: support filtering, sorting
  return fw.list({}, function (err, res) {
    return cli.displayRules(err, res, opts);
  });
}


/**
 * Gets the rules that apply to a zone
 */
function zoneRules(opts) {
  var uuid = cli.validateUUID(opts.argv.remain[1]);
  return VM.lookup({}, { 'full': true }, function (err, vms) {
    if (err) {
      return cli.outputError(err, opts);
    }

    return fw.rules({ vm: uuid, vms: vms }, function (err2, res) {
      return cli.displayRules(err2, res, opts);
    });
  });
}


/**
 * Starts the firewall for a VM
 */
function start(opts) {
  return startStop(opts, true);
}


/**
 * Gets the status of a VM's firewall (and extra information from ipf if
 * the verbose flag is set)
 */
function status(opts) {
  var uuid = cli.validateUUID(opts.argv.remain[1]);
  fw.status({ uuid: uuid }, function (err, res) {
    if (err) {
      return cli.outputError(err, opts);
    }

    if (opts.json) {
      return console.log(cli.json(res));
    }

    if (opts.verbose) {
      for (var key in res) {
        console.log('%s: %s', key, res[key]);
      }
      return;
    }

    return console.log(res.running ? 'running' : 'stopped');
  });
}


/**
 * Gets rule statistics for a VM's firewall
 */
function stats(opts) {
  var uuid = cli.validateUUID(opts.argv.remain[1]);
  fw.stats({ uuid: uuid }, function (err, res) {
    if (err) {
      return cli.outputError(err, opts);
    }

    if (opts.json) {
      return console.log(cli.json(res.rules));
    }

    res.rules.forEach(function (r) {
      console.log('%s %s', r.hits, r.rule);
    });

    return;
  });
}


/**
 * Stops the firewall for a VM
 */
function stop(opts) {
  return startStop(opts, false);
}


/**
 * Updates a rule
 */
function update(opts) {
  return cli.getPayload(opts, function (err, payload) {
    if (err) {
      return cli.outputError(err, opts);
    }

    var updateOpts = preparePayload(opts, payload);
    return doUpdate(updateOpts, 'Updated');
  });
}


// --- Exports



/**
 * Main entry point
 */
function main() {
  var parsedOpts = nopt(LONG_OPTS, SHORT_OPTS, process.argv, 2);
  var command = parsedOpts.argv.remain[0];

  switch (command) {
  case 'add':
    add(parsedOpts);
    break;
  case 'delete':
    del(parsedOpts, false);
    break;
  case 'disable':
    enable(parsedOpts, false);
    break;
  case 'enable':
    enable(parsedOpts, true);
    break;
  case 'get':
    get(parsedOpts, true);
    break;
  case 'list':
    list(parsedOpts);
    break;
  case 'rules':
    zoneRules(parsedOpts);
    break;
  case 'start':
    start(parsedOpts);
    break;
  case 'stats':
    stats(parsedOpts);
    break;
  case 'status':
    status(parsedOpts);
    break;
  case 'stop':
    stop(parsedOpts);
    break;
  case 'update':
    update(parsedOpts);
    break;
  default:
    usage();
    break;
  }
}


module.exports = {
  main: main
};
