#! /usr/node/0.8/bin/node

/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 */

var fs = require('fs');
var zfs = require('/usr/node/node_modules/zfs');

function
fatal(msg)
{
	console.log('fatal error: ' + msg);
	process.exit(-1);
}

function
usage()
{
	console.log('usage: ' + process.argv[0] + ' <pool> <file.json>');
	process.exit(-1);
}

var json;
var config;
var pool;

if (!process.argv[2] || !process.argv[3])
	usage();

pool = process.argv[2];
json = fs.readFileSync(process.argv[3], 'utf8');
config = JSON.parse(json);

zfs.zpool.create(pool, config, function (err) {
	if (err) {
		fatal('pool creation failed: ' + err);
	}
});
