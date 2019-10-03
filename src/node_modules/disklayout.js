/*
 * Copyright 2019 Joyent, Inc.
 */

var assert = require('assert');

/*
 * Constants for the minimum and maximum stripe width we want to allow for
 * the various types of raidz, although raidz2 and raidz3 can override to
 * go narrower in some cases.
 */
var Z1_MIN = 3;
var Z1_MAX = 6;
var Z2_MIN = 7;
var Z2_MAX = 12;
var Z3_MIN = 9;
var Z3_MAX = 20;

/*
 * Returns the rounded-off capacity in GB.  The purpose of this is to
 * group devices of the same basic size class; disks and to a lesser extent
 * SSDs are marketed at a very limited number of capacity points although
 * the actual capacities vary quite a bit at each one.  We don't want to
 * get confused by that.
 */
function
round_capacity(bytes)
{
	var mb = bytes / 1000000;	/* thieves, that's what they are */
	var THRESHOLDS = [ 500000, 150000, 80000, 20000, 4500, 1000 ];
	var i;
	var bestfit, bestdiff = 0;

	for (i = 0; i < THRESHOLDS.length; i++) {
		var t = THRESHOLDS[i];
		var roundoff = Math.floor((mb + Math.floor(t / 2)) / t) * t;
		var multiplier = Math.pow(roundoff / t, 4);
		var diff = (mb - roundoff) * (mb - roundoff) * multiplier;

		if (Math.abs(mb - roundoff) / mb > 0.05)
			continue;

		if (diff < bestdiff || bestdiff === 0) {
			bestfit = roundoff;
			bestdiff = (mb - roundoff) * (mb - roundoff) *
			    multiplier;
		}
	}

	if (Math.abs(bestfit - mb) / mb < 0.05)
		return (bestfit / 1000);

	/*
	 * This device's size is not within +/-5% of any number of GB.
	 * That's very unusual and suggests we probably oughtn't use it.
	 * Round off to the nearest 1 GB and call it a day for now.  Most
	 * such devices are probably very small and we will return 0 for them.
	 */
	return (Math.round(mb / 1000));
}

function
merge_types(inv)
{
	Object.keys(inv).forEach(function (t0type) {
		Object.keys(inv).forEach(function (t1type) {
			var t0 = inv[t0type];
			var t1 = inv[t1type];

			if (t0type == t1type || !t0 || !t1)
				return;
			if (t0.solid_state != t1.solid_state)
				return;
			if (Math.abs(t0.size - t1.size) / t1.size > 0.05)
				return;

			if (t0.disks.length > t1.disks.length) {
				t0.disks = t0.disks.concat(t1.disks);
				delete inv[t1type];
			} else {
				t1.disks = t1.disks.concat(t0.disks);
				delete inv[t0type];
			}
		});
	});
}

function
shrink(inv)
{
	Object.keys(inv).forEach(function (typedesc) {
		var smallest = 0;
		var largest = 0;
		var type = inv[typedesc];

		type.disks.forEach(function (disk) {
			if (smallest === 0 || disk.size < smallest)
				smallest = disk.size;
			if (largest === 0 || disk.size > largest)
				largest = disk.size;
		});
		type.smallest = smallest;
		type.largest = largest;
		delete type.size;
	});
}

function
xform_bucket(bucket)
{
	var role = [];

	bucket.disks.forEach(function (disk) {
		role.push({
			name: disk.name,
			vid: disk.vid,
			pid: disk.pid,
			size: disk.size,
			solid_state: disk.solid_state
		});
	});

	return (role.sort(function (a, b) {
		if (a.size !== b.size)
			return (a.size - b.size);
		return (a.name > b.name ? 1 : a.name < b.name ? -1 : 0);
	}));
}

/*
 * At this point we have detected the likely size bucket for each device, then
 * merged any buckets that required it.  We should have one bucket for each
 * approximate size, segregated by whether the devices are solid-state.  We
 * also know the smallest size of any device in each sub-bucket.  It's time to
 * assign each bucket a role.
 *
 * There are three possible roles: storage, cache, and slog.  If there is
 * only one bucket left, that's easy: it's storage.  Otherwise we're going
 * to make some judgment calls.  All spinning disks are for storage, always,
 * unless there are 2 or more different-sized groups of them, in which case the
 * largest will be for storage and all the rest for cache.
 *
 * If there are 4 or fewer of the smallest SSD type, they're slogs.  Anything
 * else is a cache device, unless there were no spinning disks at all in
 * which case the largest devices will be used as primary storage.
 */
function
assign_roles(inv, enable_cache)
{
	var typedescs = Object.keys(inv);
	var ssddescs;
	var rustdescs;
	var roles = {};
	var largest;

	if (typedescs.length === 0)
		return (roles);

	if (typedescs.length === 1) {
		roles.storage = xform_bucket(inv[typedescs[0]]);
		return (roles);
	}

	ssddescs = typedescs.filter(function (d) {
		return (inv[d].solid_state === true);
	}).sort(function (a, b) {
		return (inv[a].smallest - inv[b].smallest);
	});

	rustdescs = typedescs.filter(function (d) {
		return (!inv[d].solid_state);
	}).sort(function (a, b) {
		return (inv[a].smallest - inv[b].smallest);
	});

	if (rustdescs.length > 0) {
		largest = rustdescs.pop();

		roles.storage = xform_bucket(inv[largest]);
	}

	if (enable_cache) {
		rustdescs.forEach(function (typedesc) {
			var role = xform_bucket(inv[typedesc]);

			if (roles.cache)
				roles.cache = roles.cache.concat(role);
			else
				roles.cache = role;
		});
	}

	if (ssddescs.length === 0)
		return (roles);

	if (!roles.storage) {
		largest = ssddescs.pop();

		roles.storage = xform_bucket(inv[largest]);
	}

	if (ssddescs.length === 0)
		return (roles);

	if (inv[ssddescs[0]].disks.length < 5) {
		roles.slog = xform_bucket(inv[ssddescs[0]]);
		ssddescs.shift();
	}

	if (enable_cache) {
		ssddescs.forEach(function (typedesc) {
			var role = xform_bucket(inv[typedesc]);
			if (roles.cache)
				roles.cache = roles.cache.concat(role);
			else
				roles.cache = role;
		});
	}

	return (roles);
}

function
do_single(disks, nspares, width)
{
	var config = {};

	if (nspares !== undefined && nspares !== 0) {
		config.error = 'spares are not allowed for a single disk pool';
		return (config);
	}

	config.vdevs = [];
	config.vdevs[0] = disks[0];
	config.capacity = disks[0].size;

	return (config);
}

function
do_mirror(disks, nspares, width)
{
	var spares;
	var config = {};
	var capacity;
	var fixedwidth = false;

	if (disks.length < 2) {
		config.error = 'at least 2 disks are required for mirroring';
		return (config);
	}

	if (width === undefined) {
		width = 2;
	} else {
		/* The user specified a fixed width on the command line. */
		var dlen = disks.length;
		if (nspares !== undefined) {
			if (nspares >= disks.length) {
				config.error = nspares + ' is an invalid ' +
				    'number of spares for ' + dlen + ' disks';
				return (config);
			}
			dlen -= nspares;
		}

		if (width < 2 || width > dlen) {
			config.error = width + ' is an invalid width for ' +
			    'mirroring and ' + dlen + ' disks';
			return (config);
		}
		fixedwidth = true;
	}

	if (nspares === undefined) {
		if (fixedwidth) {
			spares = disks.length % width;
		} else {
			if (disks.length === 2 || disks.length === 4) {
				spares = 0;
			} else {
				spares = Math.ceil(disks.length / 16);
				spares += (disks.length - spares) % width;
			}
		}
	} else {
		if (nspares > (disks.length - width)) {
			config.error = nspares + ' is an invalid ' +
			    'number of spares for ' + disks.length + ' disks';
			return (config);
		}
		spares = nspares;
	}

	/*
	 * The largest devices can spare for any others.  Not so for the
	 * smaller ones.
	 */
	if (spares > 0)
		config.spares = disks.splice(disks.length - spares, spares);

	config.vdevs = [];
	capacity = 0;
	while (disks.length) {
		var vdev = {};

		capacity += disks[0].size * 1;
		vdev.type = 'mirror';
		vdev.devices = disks.splice(0, width);
		config.vdevs.push(vdev);

		/*
		 * If a fixed width was provided and there are some disks left
		 * over, leave them alone. We assume the user intentionally
		 * wants the extra disks for something else.
		 */
		if (fixedwidth && disks.length < width)
			break;
	}

	config.capacity = capacity;

	return (config);
}

function
raidz_common(disks, rtype, minwidth, maxwidth, spares, fixedspares, width)
{
	var config = {};
	var nparity;
	var capacity;
	var fixedwidth = false;

	if (width !== undefined) {
		/*
		 * The user specified a fixed width on the command line.
		 * We allow the user to specify a wider raidz width than our
		 * normal limits.
		 */

		if (width < minwidth || width > disks.length) {
			config.error = width + ' is an invalid width for ' +
			    rtype + ' and ' + disks.length + ' disks ' +
			    '(min: ' + minwidth + ', default max: ' +
			    maxwidth + ')';
			return (config);
		}

		fixedwidth = true;
		if (!fixedspares) {
			spares = disks.length % width;
		} else {
			if (disks.length - spares < width) {
				config.error = width + ' is an invalid width ' +
				    'for ' + rtype + ' and ' + spares +
				    ' spares';
				return (config);
			}
		}

	} else {
		while (disks.length - spares >= minwidth) {
			/*
			 * Optimize raidz for performance, preferring a
			 * narrower stripe width by starting at the minimum.
			 */
			for (width = minwidth; width <= maxwidth; width++) {
				if ((disks.length - spares) % width === 0)
					break;
			}
			if (width <= maxwidth)
				break;

			if (fixedspares) {
				config.error = 'no acceptable ' + rtype +
				    ' layout is possible with ' + disks.length +
				    ' disks and ' + spares +
				    (spares == 1 ? ' spare' : ' spares');
				return (config);
			}

			++spares;
		}
	}

	if (disks.length - spares < minwidth) {
		config.error = 'no acceptable ' + rtype + ' layout is ' +
		    'possible with ' + disks.length + ' disks';
		return (config);
	}

	/*
	 * The largest devices can spare for any others.  Not so for the
	 * smaller ones.
	 */
	if (spares > 0)
		config.spares = disks.splice(disks.length - spares, spares);

	if (rtype === 'raidz') {
		nparity = 1;
	} else if (rtype === 'raidz2') {
		nparity = 2;
	} else if (rtype === 'raidz3') {
		nparity = 3;
	} else {
		config.error = 'invalid raid type: ' + rtype;
		return (config);
	}

	config.vdevs = [];
	capacity = 0;
	while (disks.length) {
		var vdev = {};

		capacity += (width - nparity) * disks[0].size;
		vdev.type = rtype;
		vdev.devices = disks.splice(0, width);
		config.vdevs.push(vdev);

		/*
		 * If a fixed width was provided and there are some disks left
		 * over, leave them alone. We assume the user intentionally
		 * wants the extra disks for something else.
		 */
		if (fixedwidth && disks.length < width)
			break;
	}

	config.capacity = capacity;

	return (config);
}


function
do_raidz1(disks, nspares, width)
{
	var minwidth = Z1_MIN;
	var maxwidth = Z1_MAX;
	var spares;
	var fixedspares;

	if (nspares === undefined) {
		spares = Math.min(2, Math.floor(disks.length / 7));
		fixedspares = false;
	} else {
		assert.ok(nspares < disks.length);
		spares = nspares;
		fixedspares = true;
	}

	return (raidz_common(disks, 'raidz', minwidth, maxwidth, spares,
	    fixedspares, width));
}

function
do_raidz2(disks, nspares, width)
{
	var minwidth = Z2_MIN;
	var maxwidth = Z2_MAX;
	var spares;
	var fixedspares;

	/*
	 * Special case.  This configuration is supported but strongly
	 * discouraged.  The lack of spares is relatively unimportant since
	 * there are 2 parity devices, but this will perform very poorly on
	 * non-SSD disks.
	 */
	if (disks.length === 5 || disks.length === 6)
		minwidth = maxwidth = disks.length;

	if (nspares === undefined) {
		spares = Math.min(2, Math.floor(disks.length / Z2_MAX));
		fixedspares = false;
	} else {
		assert.ok(nspares < disks.length);
		spares = nspares;
		fixedspares = true;
	}

	return (raidz_common(disks, 'raidz2', minwidth, maxwidth, spares,
	    fixedspares, width));
}

function
do_raidz3(disks, nspares, width)
{
	var minwidth = Z3_MIN;
	var maxwidth = Z3_MAX;
	var spares;
	var fixedspares;

	/*
	 * Special case.  This configuration is supported but strongly
	 * discouraged.  The lack of spares is relatively unimportant since
	 * there are 3 parity devices, but this will perform very poorly on
	 * non-SSD disks.
	 */
	if (disks.length === 7 || disks.length === 8)
		minwidth = maxwidth = disks.length;

	if (nspares === undefined) {
		spares = Math.min(2, Math.floor(disks.length / 15));
		fixedspares = false;
	} else {
		assert.ok(nspares < disks.length);
		spares = nspares;
		fixedspares = true;
	}

	return (raidz_common(disks, 'raidz3', minwidth, maxwidth, spares,
	    fixedspares, width));
}

var LAYOUTS = {
	single: do_single,
	mirror: do_mirror,
	raidz1: do_raidz1,
	raidz2: do_raidz2,
	raidz3: do_raidz3
};

function
register_layout(name, f)
{
	if (typeof (name) !== 'string' || typeof (f) !== 'function')
		throw new TypeError('string and function arguments required');
	LAYOUTS[name] = f;
}

function
list_supported()
{
	return (Object.keys(LAYOUTS));
}

/*
 * This function does some basic validation and can be extended to catch more
 * issues with invalid input parameter combinations.
 */
function
is_valid(config, disks, nspares)
{
	var i;
	var ndisks;
	var PRIMES = [ 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67 ];

	if (nspares !== undefined) {
		ndisks = disks.length - nspares;
		if (nspares > 0 && ndisks < 2) {
			config.error = 'too many spares (' +
			    nspares + ') for this disk configuration';
			return (false);
		}

		/*
		 * When we have a fixed number of spares and a prime number of
		 * disks that is greater than the maxwidth of a raidz3 then we
		 * cannot construct a valid configuration.
		 */
		for (i = 0; i < PRIMES.length; i++) {
			if (ndisks == PRIMES[i]) {
				config.error = 'invalid number of spares (' +
				    nspares + ') for this disk configuration';
				return (false);
			}
		}
	}

	return (true);
}

/*
 * Encode our heuristics that automatically select a layout for a non-trivial
 * number of disks not handled by the simple switch in compute_layout.
 */
function
complex_layout(diskroles, navail, nspares, width)
{
	var i;

	if (width !== undefined) {
		/*
		 * 'width' is an optional argument that was provided, but
		 * since a layout was not provided, pick a layout based on the
		 * given width. Invalid width is detected later.
		 */
		if (width <= 2)
			return ('mirror');
		if (width <= Z1_MAX)
			return ('raidz1');
		if (width <= Z2_MAX)
			return ('raidz2');
		return ('raidz3');
	}

	if (navail > 16 ||
	    navail > Z2_MIN && diskroles.storage[0].size > 1500 * 1000000000) {
		if (nspares === undefined)
			return ('raidz2');

		/*
		 * We can't vary the number of spares. See if a raidz2 will
		 * work.
		 */
		for (i = Z2_MIN; i <= Z2_MAX; i++) {
 			if ((navail % i) === 0)
				return ('raidz2');
		}

		/*
		 * A special case to handle the navail > Z2_MIN with a fixed
		 * number of spares that can't work on raidz1.
		 */
		if (navail == 13)
			return ('raidz3');

		return ('raidz1');
	}

	if (navail < Z2_MAX && diskroles.storage[0].solid_state) {
		if (navail > Z1_MAX)
			return ('raidz2');
		return ('raidz1');
	}

	/* An odd number of disks, < 16 */
	if ((navail % 2) != 0) {
		/* For an odd number of disks we want mirrors and spares */
		if (nspares === undefined)
			return ('mirror');

		if (navail < 6)
			return ('raidz1');

		/*
		 * When we have 15 disks and can't vary spares then make a set
		 * of narrow raidz1 vdevs.
		 */
		if (navail == 15 && nspares !== undefined)
			return ('raidz1');

		/*
		 * When we have 13 disks and can't vary spares then this
		 * exceeds the maxwidth of a single raidz2.
		 */
		if (navail == 13 && nspares !== undefined)
			return ('raidz3');

		/* We're in the acceptable range for raidz2 */
		return ('raidz2');
	}

	/* We have an even number of disks <= 16 */
	return ('mirror');
}

function
compute_layout(disks, layout, nspares, enable_cache, width)
{
	var disktypes = {};
	var diskroles;
	var config = {};

	assert.ok(typeof (nspares) === 'number' || nspares === undefined);
	assert.ok(typeof (enable_cache) === 'boolean');
	assert.ok(typeof (width) === 'number' || width === undefined);

	config.input = disks;
	config.layout = layout;

	disks.forEach(function (disk) {
		var gb;
		var typespec;

		if (disk.removable)
			return;

		if ((gb = round_capacity(disk.size)) === 0)
			return;

		typespec = disk.type + ',' + gb + ',' + disk.solid_state;
		disk.rounded_size = gb;
		if (!disktypes[typespec]) {
			disktypes[typespec] = {
				type: disk.type,
				size: gb,
				solid_state: disk.solid_state,
				disks: []
			};
		}
		disktypes[typespec].disks.push(disk);
	});

	merge_types(disktypes);
	shrink(disktypes);
	diskroles = assign_roles(disktypes, enable_cache);

	if (!diskroles.storage) {
		config.error = 'no primary storage disks available';
		return (config);
	}

	if (!is_valid(config, diskroles.storage, nspares)) {
		return (config);
	}

	if (!layout) {
		var navail;

		if (nspares === undefined) {
			navail = diskroles.storage.length;
		} else {
			navail = diskroles.storage.length - nspares;
		}

		switch (navail) {
		case 1:
			layout = 'single';
			break;
		case 2:
			layout = 'mirror';
			break;
		case 3:
		case 4:
			layout = 'raidz1';
			break;
		case 5:
		case 6:
			if (diskroles.storage[0].solid_state ||
			    nspares !== undefined)
				layout = 'raidz1';
			else
				layout = 'raidz2';
			break;
		default:
			layout = complex_layout(diskroles, navail, nspares,
			    width);
			break;
		}
	}

	if (!LAYOUTS[layout]) {
		config.error = 'unknown layout ' + layout;
		return (config);
	}

	config = LAYOUTS[layout](diskroles.storage, nspares, width);
	config.logs = diskroles.slog;
	config.cache = diskroles.cache;

	return (config);
}

module.exports = {
	register: register_layout,
	list_supported: list_supported,
	compute: compute_layout
};
