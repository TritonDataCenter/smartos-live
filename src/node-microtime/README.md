[![Build Status](https://travis-ci.org/wadey/node-microtime.png)](https://travis-ci.org/wadey/node-microtime)

# node-microtime

Date.now() will only give you accuracy in milliseconds. This module calls
`gettimeofday(2)` to get the time in microseconds and provides it in a few
different formats. The same warning from that function applies:
_The resolution of the system clock is hardware dependent, and the time may
be updated continuously or in ``ticks.''_

# Installation

    npm install microtime

* Requires npm >= 1.1.5 (which bundles node-gyp). See https://github.com/wadey/node-microtime/issues/9

# Usage

### microtime.now()

Get the current time in microseconds as an integer. Since JavaScript can only
represent integer values accurately up to `Math.pow(2, 53)`, this value will
be accurate up to _Tue, 05 Jun 2255 23:47:34 GMT_.

### microtime.nowDouble()

Get the current time in seconds as a floating point number with microsecond
accuracy (similar to `time.time()` in Python and `Time.now.to_f` in Ruby).

### microtime.nowStruct()

Get the current time and return as a list with seconds and microseconds (matching the return value of `gettimeofday(2)`).

# Example

    > var microtime = require('microtime')
    > microtime.now()
    1297448895297028
    > microtime.nowDouble()
    1297448897.600976
    > microtime.nowStruct()
    [ 1297448902, 753875 ]

## Estimating clock resolution

Starting with version 0.1.3, there is a test script that tries to guess the clock resolution. You can run it with `npm test microtime`. Example output:

    microtime.now() = 1298960083489806
    microtime.nowDouble() = 1298960083.511521
    microtime.nowStruct() = [ 1298960083, 511587 ]

    Guessing clock resolution...
    Clock resolution observed: 1us

## Tested on

    Node.js 0.2.6
      - OS X 10.6.6
      - Ubuntu 10.04

    Node.js 0.4.1
      - OS X 10.6.6
      - Windows 7 64bit (Cygwin) *

    Node.js 0.8.11
      - OS X 10.7.4
      - Travis (linux): https://travis-ci.org/wadey/node-microtime

## Warning for Cygwin users

It appears that Cygwin only implements `gettimeofday(2)` with [millisecond accuracy](http://old.nabble.com/gettimeofday---millisecond-accuracy-p21085475.html).
