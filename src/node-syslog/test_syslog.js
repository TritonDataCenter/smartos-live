#!/usr/local/bin/node

var sys = require('sys');
var sl = require('./build/default/syslog');

sys.debug("sl.version === " + sl.version());
sys.debug("sl.LOG_EMERG === " + sl.LOG_EMERG);
sys.debug("sl.openlog('foo', sl.LOG_PID, sl.LOG_DAEMON) === " + sl.openlog('foo', sl.LOG_PID, sl.LOG_DAEMON));
sys.debug("sl.syslog(sl.LOG_EMERG, 'pickle') === " + sl.syslog(sl.LOG_EMERG, 'bar'));
