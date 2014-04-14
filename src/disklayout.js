#! /usr/node/bin/node

/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 */

var fs = require('fs');
var zfs = require('/usr/node/node_modules/zfs');
var getopt = require('/usr/node/node_modules/getopt');
var disklayout = require('/usr/node/node_modules/disklayout');

function
fatal(msg)
{
	console.log('fatal error: ' + msg);
	process.exit(-1);
}

function
usage()
{
	console.log('usage: ' + process.argv[0] + ' [-f file] <layout>');
	console.log('supported layouts:\n\t' +
	    disklayout.list_supported().join('\n\t'));
	process.exit(-1);
}

function
dolayout(disks, layout)
{
	var config;
	var mnttab = fs.readFileSync('/etc/mnttab', 'utf8');

	disks = disks.filter(function (disk) {
		if (mnttab.search(disk.name) != -1)
			return (false);
		return (true);
	});

	config = disklayout.compute(disks, layout);
	console.log(JSON.stringify(config, null, '\t'));
}

var g_layout;
var opt_f;
var option;
var parser = new getopt.BasicParser('f:', process.argv);

while ((option = parser.getopt()) !== undefined && !option.error) {
	switch (option.option) {
	case 'f':
		opt_f = option.optarg;
		break;
	default:
		usage();
		break;
	}
}

if (option && option.error)
	usage();

g_layout = process.argv[parser.optind()];

if (opt_f) {
	fs.readFile(opt_f, 'utf8', function (err, data) {
		var lines;
		var disks = [];

		if (err)
			fatal('unable to read ' + opt_f + ': ' + err);

		lines = data.trim().split('\n');
		lines.forEach(function (line) {
			if (line) {
				var row = line.split('\t');
				disks.push({
					type: row[0],
					name: row[1],
					vid: row[2],
					pid: row[3],
					size: row[4],
					removable: (row[5] === 'yes'),
					solid_state: (row[6] === 'yes')
				});
			}
		});
		dolayout(disks, g_layout);
	});
} else {
	zfs.zpool.listDisks(function (err, disks) {
		if (err) {
			fatal(err);
		}
		dolayout(disks, g_layout);
	});
}
