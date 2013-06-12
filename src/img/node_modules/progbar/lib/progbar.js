/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 */

var mod_readline = require('readline');

var mod_assert = require('assert-plus');
var mod_sprintf = require('sprintf');

var sprintf = mod_sprintf.sprintf;

/*
 * Human-readable Units:
 */
var KILOBYTE = 1024;
var MEGABYTE = KILOBYTE * 1024;
var GIGABYTE = MEGABYTE * 1024;

/*
 * How long should we wait (in ms) before considering our average/rate
 * fit to print?
 */
var WARMUP_DELAY = 2000;

/*
 * ECMA-48 terminal handling support:
 */
var ECMA48 = {
	ESC: '\x1b',
	CSI: '\x1b[',
	CHA: 'G'
};
var ECMA48_TERMINAL = false;
if (process.env.TERM) {
	if (process.env.TERM.match(/^xterm/) ||
	    process.env.TERM.match(/^rxvt/) ||
	    process.env.TERM === 'ansi') {
		ECMA48_TERMINAL = true;
	}
}

/*
 * DEC Private Modes:
 *   (generally VT300 and later, but certainly xterms)
 */
var DEC = {
	RST: 'l',
	SET: 'h',
	TCEM: '?25'
}
var DEC_TERMINAL = false;
if (process.env.TERM) {
	if (process.env.TERM.match(/^xterm/) ||
	    process.env.TERM.match(/^rxvt/)) {
		DEC_TERMINAL = true;
	}
}

/*
 * On UNIX platforms, we can generally just write to the TTY.
 */
var UNIX_PLATFORMS = [ 'sunos', 'solaris', 'darwin', 'linux' ];
var USE_READLINE = (UNIX_PLATFORMS.indexOf(process.platform) === -1);

/*
 * Utility Functions:
 */

function
caplength(str, len)
{
	if (str.length > len) {
		return ('...' + str.slice(str.length - len + 3,
		    str.length));
	} else {
		while (str.length < len)
			str += ' ';
		return (str);
	}
}

function
formattime(seconds)
{
	var hours, minutes;

	hours = Math.floor(seconds / 3600);
	seconds -= hours * 3600;

	minutes = Math.floor(seconds / 60);
	seconds -= minutes * 60;

	if (hours > 99) {
		return (sprintf('%dh', hours));
	} else if (hours > 0) {
		return (sprintf('%2dh%2dm', hours, minutes));
	} else if (minutes > 0) {
		return (sprintf('%2dm%2ds', minutes, seconds));
	} else {
		return (sprintf('%2ds', seconds));
	}
}

function
formatsize(bytes)
{
	if (bytes >= GIGABYTE) {
		return ((bytes / GIGABYTE).toFixed(2) + 'GB');
	} else if (bytes >= MEGABYTE) {
		return ((bytes / MEGABYTE).toFixed(2) + 'MB');
	} else if (bytes >= KILOBYTE) {
		return ((bytes / KILOBYTE).toFixed(2) + 'KB');
	} else {
		return (bytes + 'B');
	}
}

function
init_readline(_tty)
{
	/*
	 * We don't want to connect Readline up to the actual stdin,
	 * lest it consume input and generally mess around.  Instead,
	 * we fake up a barely passable Streams object that acts a bit
	 * like /dev/null ...
	 */
	var rlif;
	var fakeStdin = {
		listeners: function () { return ([]); },
		on: function () {},
		removeListener: function () {},
		resume: function () {},
		pause: function () {}
	};
	rlif = mod_readline.createInterface(fakeStdin, _tty);
	rlif.setPrompt('');
	return (rlif);
}

/*
 * ProgressBar -- the main class.
 */
function
ProgressBar(options)
{
	var self = this;

	mod_assert.object(options, 'options');
	mod_assert.string(options.filename, 'options.filename');
	mod_assert.optionalBool(options.hidecursor, 'options.hidecursor');
	mod_assert.optionalNumber(options.maxdrawfreq, 'options.maxdrawfreq');

	if (options.nosize) {
		mod_assert.bool(options.nosize);
		mod_assert.ok(typeof (options.size) === 'undefined',
		    'nosize and size are mutually exclusive');
	} else {
		mod_assert.number(options.size, 'options.size');
		mod_assert.ok(options.size >= 0, 'options.size 0 or more');
	}

	self.pb_hide_cursor = options.hidecursor ? true : false;

	self.pb_filename = options.filename;
	if (options.nosize) {
		self.pb_nosize = true;
		self.pb_size = 0;
	} else {
		self.pb_nosize = false;
		self.pb_size = options.size;
	}
	self.pb_progress = 0;
	self.pb_done = false;

	self.pb_tty = process.stderr;
	self.pb_rlif = null;
	if (USE_READLINE || !ECMA48_TERMINAL) {
		self.pb_rlif = init_readline(self.pb_tty);
	}

	if (options.maxdrawfreq !== undefined) {
		mod_assert.ok(options.maxdrawfreq > 0,
		    'options.maxdrawfreq > 0');
		self.pb_drawperiod = Math.floor((1 / options.maxdrawfreq)
		    * 1000);
	} else {
		self.pb_drawperiod = 500; /* 2 Hz */
	}
	self.pb_lastdrawtime = 0;
	self.pb_startat = +Date.now();
	self.pb_readings = 0;
}

ProgressBar.prototype._cleanup = function
_cleanup()
{
	var self = this;
	var rlif = self.pb_rlif;

	if (rlif !== null)
		rlif.close();
}

ProgressBar.prototype._write = function
_write(data, clear_first)
{
	var self = this;
	var rlif = self.pb_rlif;
	var tty = self.pb_tty;

	if (rlif !== null) {
		if (clear_first && ECMA48_TERMINAL) {
			/*
			 * On an ECMA-48 compliant terminal, we can use:
			 *
			 *   8.3.9 CHA - CURSOR CHARACTER ABSOLUTE
			 *      CSI Pn 04/07
			 *
			 * to return the cursor to column 1.  We then
			 * overwrite the previous progress bar with a new
			 * one, resulting in less flicker than erasing
			 * the entire line before printing again.
			 */
			rlif.write(ECMA48.CSI + '1' + ECMA48.CHA);
		} else if (clear_first) {
			/*
			 * Otherwise, assume readline knows how to clear
			 * the line before we repaint it.
			 */
			rlif.write(null, { ctrl: true, name: 'u' });
		}
		if (data)
			rlif.write(data);
	} else {
		mod_assert.ok(ECMA48_TERMINAL, 'ECMA48_TERMINAL');

		if (clear_first)
			tty.write(ECMA48.CSI + '1' + ECMA48.CHA);
		if (data)
			tty.write(data);
	}
}

ProgressBar.prototype.end = function
end()
{
	var self = this;

	/*
	 * Re-enable the cursor if we turned it off:
	 */
	if (self.pb_hide_cursor && DEC_TERMINAL)
		self._write(ECMA48.CSI + DEC.TCEM + DEC.SET, false);

	if (self.pb_done)
		return;

	if (!self.pb_nosize)
		self.pb_progress = self.pb_size;

	self.draw();
	self._write('\n', false);
	self._cleanup();
	self.pb_done = true;
};

ProgressBar.prototype.advance = function
advance(progress)
{
	var self = this;

	if (self.pb_done)
		return;

	self.pb_readings++;
	self.pb_progress += progress;

	if (!self.pb_nosize && self.pb_progress >= self.pb_size) {
		/*
		 * We're finished.
		 */
		self.end();
		return;
	}

	var now = +Date.now();
	if (now - self.pb_lastdrawtime > self.pb_drawperiod)
		self.draw();
};

ProgressBar.prototype.draw = function
draw()
{
	var self = this;

	if (self.pb_done)
		return;

	/*
	 * If this is our first drawing run, and we believe we have
	 * support for hiding the cursor, then do so:
	 */
	if (self.pb_hide_cursor && DEC_TERMINAL && self.pb_lastdrawtime === 0)
		self._write(ECMA48.CSI + DEC.TCEM + DEC.RST);

	var ratestr = '';
	var etastr = '';
	var now = +Date.now();
	if ((self.pb_nosize || self.pb_size > 0) && self.pb_readings > 5 &&
	    (now - self.pb_startat) > WARMUP_DELAY) {
		var period = (now - self.pb_startat) / 1000;
		var rate = Math.floor(self.pb_progress / period);
		ratestr = formatsize(rate) + '/s';
		if (!self.pb_nosize && self.pb_progress < self.pb_size) {
			var remaining = Math.floor((self.pb_size -
			    self.pb_progress) / rate);
			etastr = formattime(remaining);
		} else {
			etastr = formattime(period);
		}
	}

	var bar = '';
	var filestr;
	var infostr;
	var filewidth;
	if (self.pb_nosize) {
		infostr = sprintf(' %8s %10s %6s',
		    formatsize(self.pb_progress), ratestr, etastr);

		filewidth = self.pb_tty.columns - infostr.length - 2;
		filestr = caplength(self.pb_filename, filewidth) + ' ';
	} else {
		var percent = self.pb_size === 0 ? 100 :
		    Math.floor((self.pb_progress / self.pb_size) * 100);
		infostr = sprintf(' %3d%% %8s %10s %6s', percent,
		    formatsize(self.pb_progress), ratestr, etastr);

		filewidth = Math.floor(self.pb_tty.columns / 4);
		filestr = caplength(self.pb_filename, filewidth) + ' ';

		var barwidth = self.pb_tty.columns - filestr.length -
		    infostr.length - 3;
		var donlen = self.pb_size === 0 ? barwidth :
		    Math.floor(barwidth * (self.pb_progress / self.pb_size));
		while (bar.length < donlen - 1)
			bar += '=';
		while (bar.length < donlen)
			bar += '>';
		while (bar.length < barwidth)
			bar += ' ';
		bar = '[' + bar + ']';
	}


	self._write(filestr + bar + infostr, true);
	self.pb_lastdrawtime = +Date.now();
};

module.exports = {
	ProgressBar: ProgressBar
};

/* vim: set noet sw=8 sts=8 ts=8: */
