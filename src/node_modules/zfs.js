/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 */

var cp = require('child_process'),
    fs = require('fs');

var execFile = cp.execFile,
    spawn    = cp.spawn;

/*
 * ZFS utilities paths
 */
exports.paths = {
    'zpool': '/sbin/zpool',
    'zfs': '/sbin/zfs'
};

var zpool = exports.zpool = function () { };

// if zfs commands take longer than timeoutDuration it's an error
var timeoutDuration = exports.timeoutDuration = 10 * 60 * 1000;

function zfsErrorStr(error, stderr) {
	if (!error)
		return (null);

	if (error.killed)
		return ('Process killed due to timeout.');

	return (error.message || (stderr ? stderr.toString() : ''));
}

function zfsError(error, stderr) {
	return (new Error(zfsErrorStr(error, stderr)));
}

zpool.listFields_ = [ 'name', 'size', 'allocated', 'free', 'cap',
    'health', 'altroot' ];

zpool.listDisks = function () {
	if (arguments.length !== 1)
		throw Error('Invalid arguments');
	var callback = arguments[0];

	execFile('/usr/bin/diskinfo', [ '-Hp' ], { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(stderr.toString()));

		var disks = [];
		var rows = parseTabSeperatedTable(stdout);

		for (var ii = 0; ii < rows.length; ii++) {
			disks.push({
			    type: rows[ii][0],
			    name: rows[ii][1],
			    vid: rows[ii][2],
			    pid: rows[ii][3],
			    size: rows[ii][4],
			    removable: (rows[ii][5] === 'yes'),
			    solid_state: (rows[ii][6] === 'yes')
			});
		}

		return (callback(null, disks));
	});
};

zpool.list = function () {
	var pool, callback;
	switch (arguments.length) {
		case 1:
			callback = arguments[0];
			break;
		case 2:
			pool     = arguments[0];
			callback = arguments[1];
			break;
		default:
			throw Error('Invalid arguments');
	}
	var args = ['list', '-H', '-o', zpool.listFields_.join(',')];
	if (pool)
		args.push(pool);

	execFile(exports.paths.zpool, args, { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		var rows = parseTabSeperatedTable(stdout);
		return (callback(null, zpool.listFields_, rows));
	});
};

zpool.status = function (pool, callback) {
	if (arguments.length != 2)
		throw Error('Invalid arguments');

	execFile(exports.paths.zpool, [ 'status', pool ],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		stdout = stdout.trim();
		if (error || stdout == 'no pools available\n') {
			callback(null, 'UNKNOWN');
			return;
		}

		var lines = stdout.split('\n');
		for (var i = 0; i < lines.length; i++) {
			if (lines[i].trim().substr(0, 5) === 'state') {
				return (callback(null,
				    lines[i].trim().substr(7)));
			}
		}
		callback(null, 'UNKNOWN');
	});
};

/*
 * zpool.create()
 *
 * This allows fine-grained control and exposes all features of the
 * zpool create command, including log devices, cache devices, and hot spares.
 * The input is an object of the form produced by the disklayout library.
 */
zpool.create = function (pool, config, force, callback) {
	var args;

	if (arguments.length === 3) {
		callback = force;
		force = false;
	} else if (arguments.length !== 4) {
		throw Error('Invalid arguments, 3 or 4 arguments required');
	}

	if (force === true) {
		args = [ 'create', '-f', pool ];
	} else {
		args = [ 'create', pool ];
	}

	config.vdevs.forEach(function (vdev) {
		if (vdev.type)
			args.push(vdev.type);
		if (vdev.devices) {
			vdev.devices.forEach(function (dev) {
				args.push(dev.name);
			});
		} else {
			args.push(vdev.name);
		}
	});

	if (config.spares) {
		args.push('spare');
		config.spares.forEach(function (dev) {
			args.push(dev.name);
		});
	}

	if (config.logs) {
		args.push('log');
		config.logs.forEach(function (dev) {
			args.push(dev.name);
		});
	}

	if (config.cache) {
		args.push('cache');
		config.cache.forEach(function (dev) {
			args.push(dev.name);
		});
	}

	execFile(exports.paths.zpool, args, { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(stderr.toString()));
		return (callback(null));
	});
};

zpool.destroy = function (pool, callback) {
	if (arguments.length != 2)
		throw Error('Invalid arguments');

	execFile(exports.paths.zpool, [ 'destroy', pool ],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(stderr.toString()));
		return (callback(null));
	});
};

zpool.upgrade = function (pool) {
	var version = -1,
	    callback;
	if (arguments.length === 2) {
		callback = arguments[1];
	} else if (arguments.length === 3) {
		version = arguments[1];
		callback = arguments[2];
	} else {
		throw Error('Invalid arguments');
	}

	var args = [ 'upgrade' ];
	if (version !== -1)
		args.push(' -V ' + version);
	args.push(pool);

	execFile(exports.paths.zpool, args, { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(stderr.toString()));
		return (callback(null));
	});
};

function parseTabSeperatedTable(data) {
	var i, numLines, lines = data.trim().split('\n');
	var rows = [];
	for (i = 0, numLines = lines.length; i < numLines; i++) {
		if (lines[i]) {
			rows.push(lines[i].split('\t'));
		}
	}
	return (rows);
}

/*
 * Parse the output of `zfs get ...`, invoked by zfs.get below.  The output has
 * the form:
 *
 *     <dataset name>    <property name>    <property value>
 *
 * and those fields are tab-separated.
 */
function parsePropertyList(data) {
	var lines = data.trim().split('\n');
	var properties = {};
	lines.forEach(function (line) {
		var fields = line.split('\t');
		if (!properties[fields[0]])
			properties[fields[0]] = {};
		properties[fields[0]][fields[1]] = fields[2];
	});

	return (properties);
}

var zfs;
exports.zfs = zfs = function () {};

zfs.create = function (name, callback) {
	if (arguments.length != 2)
		throw Error('Invalid arguments');

	execFile(exports.paths.zfs, [ 'create', name ],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		return (callback());
	});
};

zfs.set = function (name, properties, callback) {
	if (arguments.length != 3)
		throw Error('Invalid arguments');

	var keys = Object.keys(properties);

	// loop over and set all the properties using chained callbacks
	(function () {
		var next = arguments.callee;
		if (!keys.length) {
			callback();
			return;
		}
		var key = keys.pop();

		execFile(exports.paths.zfs,
		    ['set', key + '=' + properties[key], name ],
		    { timeout: timeoutDuration },
		    function (error, stdout, stderr) {
			if (error)
				return (callback(zfsError(error, stderr)));
			return (next()); // loop by calling enclosing function
		});
	})();
};

zfs.get = function (name, propNames, parseable, callback) {
	if (arguments.length != 4)
		throw Error('Invalid arguments');

	var opts = '-H';
	if (parseable)
		opts += 'p';

	var argv = [ 'get', opts, '-o', 'name,property,value',
	    propNames.join(',')];
	if (name)
		argv.push(name);

	execFile(exports.paths.zfs, argv, { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));

		return (callback(null, parsePropertyList(stdout)));
	});
};

zfs.snapshot = function (name, callback) {
	if (arguments.length != 2)
		throw Error('Invalid arguments');

	execFile(exports.paths.zfs, ['snapshot', name],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		return (callback());
	});
};

zfs.clone = function (snapshot, name, callback) {
	if (arguments.length != 3)
		throw Error('Invalid arguments');

	execFile(exports.paths.zfs, ['clone', snapshot, name],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		return (callback());
	});
};

zfs.destroy = function (name, callback) {
	if (arguments.length != 2)
		throw Error('Invalid arguments');

	execFile(exports.paths.zfs, ['destroy', name],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		return (callback());
	});
};

zfs.destroyAll = function (name, callback) {
	if (arguments.length != 2)
		throw Error('Invalid arguments');

	execFile(exports.paths.zfs, ['destroy', '-r',  name],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		return (callback());
	});
};

/*
 * zfs.list fields
 */

zfs.listFields_ = [ 'name', 'used', 'avail', 'refer', 'type', 'mountpoint' ];

/*
 * List datasets.
 *
 * @param {String} [name]
 *   Dataset to list. If name is not given, `list` defaults to returning all
 *   datasets.
 *
 * @param {Object} [options]
 *   Options object:
 *     - `type`: restrict dataset type (dataset, volume, snapshot or all)
 *
 * @param {Function} [callback]
 *   Call `callback` when done. Function will be called with an error
 *   parameter, a field names list and a array of arrays comprising the list
 *   information.
 *
 */

zfs.list = function () {
	var dataset, callback,
	    options = {};
	switch (arguments.length) {
		case 1:
			callback = arguments[0];
			break;
		case 2:
			dataset  = arguments[0];
			callback = arguments[1];
			break;
		case 3:
			dataset  = arguments[0];
			options  = arguments[1];
			callback = arguments[2];
			break;
		default:
			throw Error('Invalid arguments');
	}

	options.type      = options.type || 'filesystem';
	options.recursive = options.recursive || false;

	var args = [ 'list', '-H', '-o', zfs.listFields_.join(','),
	    '-t', options.type ];
	if (options.recursive) args.push('-r');
	if (dataset) args.push(dataset);

	execFile(exports.paths.zfs, args, { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		var rows = parseTabSeperatedTable(stdout);
		return (callback(null, zfs.listFields_, rows));
	});
};

zfs.send = function (snapshot, filename, callback) {
	fs.open(filename, 'w', 400, function (error, fd) {
		if (error)
			return (callback(error));
		// set the child to write to STDOUT with `fd`
		var child = spawn(exports.paths.zfs,
		    [ 'send', snapshot ], undefined, [ -1, fd ]);
		child.addListener('exit', function (code) {
			if (code) {
				callback(new Error('Return code was ' + code));
				return;
			}
			fs.close(fd, function () {
				callback();
			});
		});

		return (null);
	});
};

zfs.receive = function (name, filename, callback) {
	fs.open(filename, 'r', 400, function (error, fd) {
		if (error)
			return (callback(error));
		// set the child to read from STDIN with `fd`
		var child = spawn(exports.paths.zfs,
		    [ 'receive', name ], undefined, [ fd ]);
		child.addListener('exit', function (code) {
			if (code) {
				return (callback(new Error(
				    'Return code was ' + code)));
			}
			fs.close(fd, function () {
				return (callback());
			});

			return (null);
		});

		return (null);
	});
};

zfs.list_snapshots = function () {
	var snapshot, callback;
	switch (arguments.length) {
		case 1:
			callback = arguments[0];
			break;
		case 2:
			snapshot = arguments[0];
			callback = arguments[1];
			break;
		default:
			throw Error('Invalid arguments');
	}
	var args = ['list', '-H', '-t', 'snapshot'];
	if (snapshot) args.push(snapshot);

	execFile(exports.paths.zfs, args, { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		var rows = parseTabSeperatedTable(stdout);
		return (callback(error, zfs.listFields_, rows));
	});
};

zfs.rollback = function (name, callback) {
	if (arguments.length != 2)
		throw Error('Invalid arguments');

	execFile(exports.paths.zfs, ['rollback', '-r', name],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		return (callback());
	});
};

zfs.rename = function (name, newname, callback) {
	if (arguments.length != 3)
		throw Error('Invalid arguments');

	execFile(exports.paths.zfs, [ 'rename', name, newname ],
	    { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(zfsError(error, stderr)));
		return (callback());
	});
};

zfs.upgrade = function (name, version, callback) {
	if (arguments.length === 2) {
		callback = arguments[1];
	} else if (arguments.length === 3) {
		version = arguments[1];
		callback = arguments[2];
	} else {
		throw Error('Invalid arguments');
	}

	name = arguments[0];

	var args = [ 'upgrade' ];
	if (version !== -1)
		args.push(' -V ' + version);
	args.push(name);

	execFile(exports.paths.zfs, args, { timeout: timeoutDuration },
	    function (error, stdout, stderr) {
		if (error)
			return (callback(new Error(stderr.toString())));
		return (callback(null));
	});
};
