#!/usr/node/bin/node
/* vim: syn=javascript ts=8 sts=8 sw=8 noet: */

var mod_path = require('path');
var mod_fs = require('fs');
var mod_net = require('net');
var mod_util = require('util');

var mod_getopt = require('/usr/node/node_modules/getopt');

function
parse_options()
{
	var parser = new mod_getopt.BasicParser('a:f:s:to', process.argv);

	var out = {
		allow_list: [],
		server_list: [],
		trusted: false
	};

	var add_server = function (s) {
		var re = new RegExp('[,\\s]');
		var servers = s.split(re);
		for (var i = 0; i < servers.length; i++) {
			var ss = servers[i].trim();
			if (!ss)
				continue;

			if (out.server_list.indexOf(ss) === -1)
				out.server_list.push(ss);
		}
	};

	var add_allow = function (a) {
		out.allow_list.push(a);
	};

	var option;
	while ((option = parser.getopt()) !== undefined) {
		switch (option.option) {
		case 'a':
			add_allow(option.optarg);
			break;
		case 'f':
			out.filename = option.optarg;
			break;
		case 's':
			add_server(option.optarg);
			break;
		case 't':
			out.trusted = true;
			break;
		case 'o':
			out.orphan = true;
			break;
		default:
			process.exit(1);
			break;
		}
	}

	if (out.server_list.length < 1) {
		console.error('ERROR: must specify at least one server (-s)');
		process.exit(1);
	}

	return (out);
}

function
hexdigit(num)
{
	var s = Number(num).toString(16);
	return (s.length === 1 ? '0' + s : s);
}

function
to_netmask(x, type)
{
	/*
	 * Parse the input as a number, in case it is a CIDR subnet suffix,
	 * e.g. /24
	 */
	var n = Number(x);
	if (isNaN(n) || n < 0)
		n = false;

	/*
	 * Determine if the input is an address-format subnet mask, or
	 * a valid CIDR subnet suffix.
	 */
	switch (type) {
	case 4:
		if (mod_net.isIPv4(x))
			return (x);
		if (n === false || n > 32)
			return (false);
		break;
	case 6:
		if (mod_net.isIPv6(x))
			return (x);
		if (n === false || n > 128)
			return (false);
		break;
	default:
		return (false);
	}

	/*
	 * It's a CIDR subnet suffix.  Construct the address-format subnet
	 * mask:
	 */
	var out = '';
	var grp = 0;
	for (var byt = 0; byt < (type === 4 ? 4 : 16); byt++) {
		var mask = 0 >>> 0;
		/*
		 * Construct this byte of the netmask:
		 */
		for (var bit = 0; bit < 8; bit++) {
			if ((byt * 8 + bit) < n) {
				mask |= 0x80 >>> bit;
			}
		}
		/*
		 * Emit the byte, formatted for the mask type we are generating:
		 */
		switch (type) {
		case 4:
			out += String(mask);
			if (byt < 3)
				out += '.';
			break;
		case 6:
			out += hexdigit(mask);
			if (++grp % 2 === 0 && byt < 15)
				out += (':');
			break;
		default:
			process.abort();
			break;
		}
	}
	return (out);
}

function
generate_file(servers, allowed_subnets, trusted, orphan)
{
	var i;
	var out = [
		'driftfile /var/ntp/ntp.drift',
		'logfile /var/log/ntp.log',
		'',
		'# Ignore all network traffic by default',
		'restrict default ignore',
		'restrict -6 default ignore',
		'',
		'# Allow localhost to manage ntpd',
		'restrict 127.0.0.1',
		'restrict -6 ::1',
		'',
		'# Allow servers to reply to our queries',
		'restrict source nomodify noquery notrap'
	];

	if (trusted) {
		out.push('');
		out.push('# Accept large time differences from servers');
		out.push('tinker panic 0');
	}

	if (orphan) {
		out.push('');
		out.push('# Operate in Oprhan mode when we cannot reach');
		out.push('# any upstream time servers for 90 seconds');
		out.push('tos orphan 10 orphanwait 90');
	}

	if (allowed_subnets.length > 0) {
		out.push('');
		out.push('# Allow local subnets to query this server');
		for (i = 0; i < allowed_subnets.length; i++) {
			var re = new RegExp('\\/');
			var as = allowed_subnets[i].split(re);
			if (as.length !== 2) {
				console.error('invalid local subnet: %s',
				    allowed_subnets[i]);
				process.exit(1);
			}

			var fam = mod_net.isIPv4(as[0]) ? 4 :
			    mod_net.isIPv6(as[0]) ? 6 : -1;
			var mask = to_netmask(as[1], fam);
			if (mask === false || fam === -1) {
				console.error('invalid local subnet: %s',
				    allowed_subnets[i]);
				process.exit(1);
			}

			out.push(mod_util.format('%s %s mask %s',
			    fam === 4 ? 'restrict' : 'restrict -6', as[0],
			    mask));
		}
	}

	if (servers.length > 0) {
		out.push('');
		out.push('# Time Servers');
		for (i = 0; i < servers.length; i++) {
			var s = servers[i];

			/*
			 * IP addresses are configured using the "server"
			 * directive. Assume everything else is a hostname and
			 * use the "pool" directive.
			 */
			var directive = mod_net.isIP(s) ? 'server' : 'pool';

			out.push(mod_util.format('%s %s burst iburst minpoll 4',
			    directive, s));
		}
	}

	return (out.join('\n') + '\n');
}

function
maybe_unlink(path)
{
	try {
		mod_fs.unlinkSync(path);
	} catch (ex) {
	}
}

function
write_file(path, data)
{
	var tmpfile = mod_path.join(mod_path.dirname(path), '.' +
	    mod_path.basename(path) + '.' + process.pid);
	try {
		mod_fs.writeFileSync(tmpfile, data, {
			encoding: 'utf8',
			mode: parseInt('0644', 8),
			flag: 'w'
		});
	} catch (ex) {
		console.error('ERROR: writing file "%s": %s', tmpfile,
		    ex.stack);
		process.exit(1);
	}
	try {
		mod_fs.renameSync(tmpfile, path);
	} catch (ex) {
		console.error('ERROR: renaming file "%s" to "%s": %s', tmpfile,
		    path, ex.stack);
		maybe_unlink(tmpfile);
		process.exit(1);
	}
}

(function
main()
{
	var options = parse_options();

	var data = generate_file(options.server_list, options.allow_list,
	    options.trusted, options.orphan);

	if (options.filename) {
		write_file(options.filename, data);
	} else {
		process.stdout.write(data);
	}
})();
