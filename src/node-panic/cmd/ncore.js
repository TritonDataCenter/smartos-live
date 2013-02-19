#!/usr/bin/env node

/*
 * cacore.js: generate a core file from a running node program.  See usage.
 */

var mod_child = require('child_process');
var mod_debug = require('_debugger');
var mod_net = require('net');
var mod_subr = require('../lib/subr');

var cacPid;
var cacClient;
var cacStages = [];
var cacTries = 30;
var cacSignaled = false;
var cacUsage = mod_subr.caSprintf([
    'usage: %s %s PID',
    '',
    'Cause the specified process to dump core and exit.  The target process ',
    'MUST be a node process and MUST contain the symbol "caPanic".  ',
    'Additionally, no other node process on the system may be running under ',
    'the debugger.  That is, the node debug port (5858) must be available.  ',
    'This tool will attempt to verify these conditions, but such checks are ',
    'necessarily subject to races and so should not be relied upon.'
].join('\n'), process.argv[0], process.argv[1]);

cacStages.push(cacCheckArgs);
cacStages.push(cacCheckTarget);
cacStages.push(cacCheckPort);
cacStages.push(cacDebugEnable);
cacStages.push(cacDebugConnect);
cacStages.push(cacCheckPid);
cacStages.push(cacSendPanic);

function die()
{
	var msg = mod_subr.caSprintf.apply(null, arguments);

	console.error('%s', msg);

	if (cacSignaled)
		console.error('WARNING: SIGUSR1 sent to pid %s, but ' +
		    'debug attach failed.', cacPid);

	process.exit(1);
}

function cacCheckArgs(unused, next)
{
	if (process.argv.length < 3)
		die(cacUsage);

	cacPid = process.argv[2];
	next();
}

function cacCheckTarget(unused, next)
{
	var cmd = mod_subr.caSprintf('pargs %s | grep "argv\\[0\\]"', cacPid);

	mod_child.exec(cmd, function (error, stdout, stderr) {
		if (error) {
			if (!/pargs: command not found/.test(stderr))
				die('pargs code %s: %s', error.code, stderr);

			console.error('WARNING: no "pargs" present; cannot ' +
			    'confirm process %s is "node"', cacPid);
		} else if (!/^argv\[0\]: (.*\/)?node\n$/.test(stdout))
			die('target process is not node: %s', stdout);

		next();
	});
}

function cacCheckPort(unused, next)
{
	var server = mod_net.createServer(function () {});

	server.on('error', function (err) {
		die('debug port already in use (error %s)\n' +
		    'won\'t try to attach to target', err.code);
	});

	server.listen(mod_debug.port, 'localhost', function () {
		server.on('close', next);
		server.close();
	});
}

function cacDebugEnable(unused, next)
{
	process.kill(cacPid, 'SIGUSR1');
	cacSignaled = true;
	next();
}

function cacDebugConnect(unused, next)
{
	process.stderr.write(mod_subr.caSprintf(
	    'attempting to attach to process %s ... ', cacPid));

	cacClient = new mod_debug.Client();

	cacClient.on('error', function (err) {
		if (--cacTries === 0)
			die('FAILED\nexceeded retry limit with error %s ',
			    err.code);

		process.stderr.write('.');
		setTimeout(function () {
			cacClient.connect(mod_debug.port);
		}, 1000);
	});

	cacClient.on('ready', function () {
		process.stderr.write(' ok.\n');
		next();
	});

	cacClient.connect(mod_debug.port);
}

function cacCheckPid(unused, next)
{
	cacClient.reqEval('process.pid', function (res) {
		if (!res.success || res.body.type != 'number')
			die('failed to get target pid: %j', res);

		if (res.body.value != cacPid)
			die('connected to wrong pid: %j', res.body.value);

		next();
	});
}

function cacSendPanic(unused, next)
{
	cacClient.reqEval('caPanic("core dump initiated at user request")',
	    function (res) {
		if (!res.success)
			die('core dump FAILED: %j', res);
		die('core dumped');
	});
}

function main()
{
	mod_subr.caRunStages(cacStages, null, function (err) {
		if (err) {
			die('fatal error: %r', err);
			process.exit(1);
		}

		process.exit(0);
	});
}

main();
