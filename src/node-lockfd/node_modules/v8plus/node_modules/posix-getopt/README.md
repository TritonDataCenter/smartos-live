
node-getopt
==============

Overview
--------

node-getopt is a Node.js module providing an interface to the POSIX-defined
getopt() function, a general-purpose command line parser that follows the POSIX
guidelines for command-line utilities.  Using these guidelines encourages
common conventions among applications, including use of:

    o short option names (e.g., "-r")
    o options with arguments (e.g., "-f filename or -ffilename")
    o chaining short option names when options have no arguments (e.g., "-ra")

This implementation mirrors the Solaris getopt() implementation and supports
long option names (e.g., "--recurse"), potentially with values specified using
"=" (e.g., "--file=/path/to/file").

Unlike other option parsers available for Node.js, the POSIX getopt() interface
supports using the same option multiple times (e.g., "-vvv", commonly used to
indicate level of verbosity).

For further reference on the relevant POSIX standards, see the following:

    http://pubs.opengroup.org/onlinepubs/009695399/functions/getopt.html
    http://pubs.opengroup.org/onlinepubs/009695399/utilities/getopts.html

The Utility Syntax Guidelines are described here:

    http://pubs.opengroup.org/onlinepubs/009695399/basedefs/xbd_chap12.html


Status
------

This module is considered complete except that

    o test coverage is pretty minimal
    o npm install has not been tested
    o the source is not javascriptlint-clean

There are no known bugs, but the module has not been extensively tested.


Platforms
---------

This module should work on all platforms that support node.js.  The module is
tested on MacOS X 10.6.5 and OpenSolaris based on build 111b and Illumos build
147.


Installation
------------

As an npm package, node-getopt is installed in the usual way:

      % npm install posix-getopt


API
---

### `new getopt.BasicParser(optstring, argv)`

Instantiates a new object for parsing the specified arguments using the
specified option string.  This interface is closest to the traditional getopt()
C function.  Callers first instantiate a BasicParser and then invoke the
getopt() method to iterate the options as they would in C.  (This interface
allows the same option to be specified multiple times.)  The first two arguments
in "argv" are ignored, since they generally denote the path to the node
executable and the script being run, so options start with the third element.

The option string consists of an optional leading ":" (see below) followed by a
sequence of option-specifiers.  Each option-specifier consists of a single
character denoting the short option name, optionally followed by a colon if the
option takes an argument and/or a sequence of strings in parentheses
representing long-option aliases for the option name.

Example option strings:
        ':r'            Command takes one option with no args: -r
        ':ra'           Command takes two option with no args: -r and -a
        ':raf:'         Command takes two option with no args: -r and -a
                        and a single option that takes an arg: -f
        ':f:(file)'     Command takes a single option with an argument: -f
                        -f can also be specified as --file

The presence of a leading colon in the option string determines the behavior
when an argument is not specified for an option which takes an argument.  See
getopt() below.  Additionally, if no colon is specified, then error messages are
printed to stderr when invalid options, options with missing arguments, or
options with unexpected arguments are encountered.


### `parser.optind()`

Returns the next argv-argument to be parsed.  When options are specified as
separate "argv" arguments, this value is incremented with each option parsed.
When multiple options are specified in the same argv-argument, the returned
value is unspecified.  This matches the variable "OPTIND" from the POSIX
standard, but is read-only.  (If you want to reset OPTIND, you must create a new
BasicParser instance.)  This is most useful after parsing has finished to
examine the non-option arguments.

This value starts at "2" as described under "Departures from POSIX" below.


### `parser.getopt()`

Returns the next argument specified in "argv" (the object's constructor
argument).  The returned value is either undefined or an object with at least
the following members:

	option		single-character option name

The following members may also be present:

	optarg		argument value, if any

	optopt		option character that caused the error, if any

	error		if true, this object represents an error

This function scans "argv" starting at the current value of "optind" and returns
an object describing the next argument based on the following cases:

    o If the end of command line arguments is reached, an undefined value is
      returned.  The end of arguments is signified by a single '-' argument, a
      single '--' argument, an argument that's neither an option nor a previous
      option's argument, the end of argv, or an error.

    o If an unrecognized command line option is found (i.e. an option character
      not defined in "optstring"), the returned object's "option" member
      is just "?".  "optopt" is set to the unrecognized option letter.  "error"
      is set to a true value.

    o If a known command line option is found and the option takes no arguments
      then the returned object's "option" member is the option's short name
      (i.e.  the single character specifier in "optstring").
      
    o If a known command line option is found and that option takes an argument
      and the argument is also found, then the returned object's "option"
      member is the option's short name and the "optarg" member contains the
      argument's value.

    o If a known command line option is found and that option takes an argument
      but the argument is not found, then the returned object's "option" member
      is "?" unless the first character of "optstring" was a colon, in which
      case the "option" member is set to ":".  Either way, the "optopt" member
      is set to the option character that caused the error and "error" is set to
      a true value.


Departures from POSIX
--------

    o Global state in the C implementation (e.g., optind, optarg, and optopt) is
      encapsulated in the BasicParser object.  optind is available as a method
      call on the parser object.  optarg and optopt are returned directly by
      getopt().

    o Rather than returning an integer or character, getopt() returns an object
      with the "option" field corresponding to the processed option character
      and possibly the additional "optarg" and "optopt" fields.  If an error
      occurs on a particular option, "error" is also set.  If an error occurs on
      no particular option or if the end of input is encountered, undefined is
      returned.

    o Long option forms are supported as described above.  This introduces an
      additional error case which is where an argument of the form
      --option=value is encountered, where "option" does not take a value.

    o POSIX starts "optind" at 1, since argv[0] is generally the name of the
      command and options start at argv[1].  This implementation starts "optind"
      at 2, since argv[0] is generally the path to the node binary and argv[1]
      is the path to the script, so options start with argv[2].


Examples
--------

### Example 1: simple short options

	var mod_getopt = require('getopt')
	var parser, option;
	
	parser = new mod_getopt.BasicParser('la',
	    ['node', 'script', '-l', '-a', 'stuff']);
	while ((option = parser.getopt()) !== undefined && !option.error)
		console.error(option);

### Example 2: invalid option specified

	var mod_getopt = require('getopt')
	var parser, option;
	
	parser = new mod_getopt.BasicParser('la',
	    ['node', 'script', '-l', '-b', 'stuff']);
	while ((option = parser.getopt()) !== undefined && !option.error)
		console.error(option);
	console.error(option);

### Example 3: long options

	var mod_getopt = require('getopt')
	var parser, option;
	
	parser = new mod_getopt.BasicParser('lar(recurse)',
	    ['node', 'script', '-l', '--recurse', 'stuff']);
	while ((option = parser.getopt()) !== undefined && !option.error)
		console.error(option);

### Example 4: options with arguments

	var mod_getopt = require('getopt')
	var parser, option;
	
	parser = new mod_getopt.BasicParser('f:lad:',
	    ['node', 'script', '-l', '-f', 'filename', '-dtype', 'stuff']);
	while ((option = parser.getopt()) !== undefined && !option.error)
		console.error(option);

### Example 5: options with missing arguments

	var mod_getopt = require('getopt')
	var parser, option;
	
	parser = new mod_getopt.BasicParser('f:la',
	    ['node', 'script', '-l', '-a', '-f']);
	while ((option = parser.getopt()) !== undefined && !option.error)
		console.error(option);
	console.error(option);

### Example 6: options specified multiple times

	var mod_getopt = require('getopt')
	var parser, option;
	
	parser = new mod_getopt.BasicParser('la',
	    ['node', 'script', '-l', '-a', '-l']);
	while ((option = parser.getopt()) !== undefined && !option.error)
		console.error(option);
