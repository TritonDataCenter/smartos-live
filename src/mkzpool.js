#! /usr/node/bin/node

/*
 * Copyright 2019 Joyent, Inc.  All rights reserved.
 */

var fs = require('fs');
var zfs = require('/usr/node/node_modules/zfs');
var getopt = require('/usr/node/node_modules/getopt');

function
fatal(msg)
{
	console.log('fatal error: ' + msg);
	process.exit(-1);
}

function
usage()
{
	console.log('usage: ' + process.argv[0] + '[-f] <pool> <file.json>');
	process.exit(-1);
}

var json;
var config;
var pool;

var option;
var opt_e = false;
var opt_f = false;
var parser = new getopt.BasicParser('ef', process.argv);

while ((option = parser.getopt()) !== undefined && !option.error) {
    switch (option.option) {
	case 'e':
		opt_e = true;
		break;
	case 'f':
		opt_f = true;
		break;
	default:
		usage();
		break;
	}
}

if (option && option.error)
	usage();

if (!process.argv[parser.optind()] || !process.argv[parser.optind() + 1])
	usage();

pool = process.argv[parser.optind()];
json = fs.readFileSync(process.argv[parser.optind() + 1], 'utf8');
config = JSON.parse(json);

zfs.zpool.create(pool, config, opt_f, opt_e, function (err) {
	if (err) {
		fatal('pool creation failed: ' + err);
	}
});
