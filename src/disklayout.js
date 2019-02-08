#! /usr/node/bin/node

/*
 * Copyright 2019 Joyent, Inc.
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
	console.log('usage: ' + process.argv[0] +
	    ' [-c] [-f file] [-s spares] [-w width] [<layout>]');
	console.log('supported layouts:\n\t' +
	    disklayout.list_supported().join('\n\t'));
	process.exit(-1);
}

function
dolayout(disks, layout, nspares, enable_cache, width)
{
	var config;
	var mnttab = fs.readFileSync('/etc/mnttab', 'utf8');

	disks = disks.filter(function (disk) {
		if (mnttab.search(disk.name) != -1)
			return (false);
		return (true);
	});

	config = disklayout.compute(disks, layout, nspares, enable_cache,
	    width);
	if (config.error !== undefined) {
		fatal(config.error);
	}
	console.log(JSON.stringify(config, null, '\t'));
}

var g_layout;
var g_enable_cache = true;
var opt_f;
var opt_s;
var opt_w;
var option;
var parser = new getopt.BasicParser('cf:s:w:', process.argv);

while ((option = parser.getopt()) !== undefined && !option.error) {
	switch (option.option) {
	case 'c':
		g_enable_cache = false;
		break;
	case 'f':
		opt_f = option.optarg;
		break;
	case 's':
		opt_s = parseInt(option.optarg, 10);
		/* Number of spares must be a positive number */
		if (opt_s != option.optarg || isNaN(opt_s) ||
		    !isFinite(opt_s) || opt_s < 0) {
			console.log('invalid value for number of spares: ' +
			    option.optarg);
			usage();
		}
		break;
	case 'w':
		opt_w = parseInt(option.optarg, 10);
		/* Width must be a positive number */
		if (opt_w != option.optarg || isNaN(opt_w) ||
		    !isFinite(opt_w) || opt_w < 2) {
			console.log('invalid width: ' + option.optarg);
			usage();
		}
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
		dolayout(disks, g_layout, opt_s, g_enable_cache, opt_w);
	});
} else {
	zfs.zpool.listDisks(function (err, disks) {
		if (err) {
			fatal(err);
		}
		dolayout(disks, g_layout, opt_s, g_enable_cache, opt_w);
	});
}
