/* vim: set syntax=javascript ts=8 sts=8 sw=8 noet: */

/*
 * Copyright 2016, Joyent, Inc.
 */

var BINDING = require('./lockfd_binding');

function
check_arg(pos, name, value, type)
{
	if (typeof (value) !== type) {
		throw (new Error('argument #' + pos + ' (' + name +
		    ') must be of type ' + type));
	}
}

function
lockfd(fd, callback)
{
	check_arg(1, 'fd', fd, 'number');
	check_arg(2, 'callback', callback, 'function');

	BINDING.lock_fd(fd, 'write', false, function (ret, errmsg, errno) {
		if (ret === -1) {
			var err = new Error('File Locking Error: ' + errmsg);
			err.code = errno;

			callback(err);
			return;
		}

		callback(null);
	});
}

function
lockfdSync(fd)
{
	var cb_fired = false;
	var err;

	check_arg(1, 'fd', fd, 'number');

	BINDING.lock_fd(fd, 'write', true, function (ret, errno, errmsg) {
		cb_fired = true;

		if (ret === -1) {
			err = new Error('File Locking Error: ' + errmsg);
			err.__errno = errno;
			return;
		}
	});

	if (!cb_fired) {
		throw (new Error('lockfdSync: CALLBACK NOT FIRED'));
	} else if (err) {
		throw (err);
	}

	return (null);
}

function
flock(fd, op, callback)
{
	check_arg(1, 'fd', fd, 'number');
	check_arg(2, 'op', op, 'number');
	check_arg(3, 'callback', callback, 'function');

	BINDING.flock(fd, op, false, function (ret, errmsg, errno) {
		if (ret === -1) {
			var err = new Error('File Locking Error: ' + errmsg);
			err.code = errno;

			callback(err);
			return;
		}

		callback(null);
	});
}

function
flockSync(fd, op)
{
	var cb_fired = false;
	var err;

	check_arg(1, 'fd', fd, 'number');
	check_arg(2, 'op', op, 'number');

	BINDING.flock(fd, op, true, function (ret, errmsg, errno) {
		cb_fired = true;

		if (ret === -1) {
			err = new Error('File Locking Error: ' + errmsg);
			err.code = errno;
			return;
		}
	});

	if (!cb_fired) {
		throw (new Error('flockSync: CALLBACK NOT FIRED'));
	} else if (err) {
		throw (err);
	}

	return (null);
}

module.exports = {
	LOCK_SH: 1,
	LOCK_EX: 2,
	LOCK_NB: 4,
	LOCK_UN: 8,
	flock: flock,
	flockSync: flockSync,
	lockfd: lockfd,
	lockfdSync: lockfdSync
};
