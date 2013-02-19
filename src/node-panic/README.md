```
________                    __    __________               .__        
\______ \   ____   ____ | _/  |_  \______   \_____    ____ |__| ____  
 |    |  \ /  _ \ /    \  \   __\  |     ___/\__  \  /    \|  |/ ___\ 
 |    `   (  <_> )   |  \  |  |    |    |     / __ \|   |  \  \  \___ 
/_______  /\____/|___|  /  |__|    |____|    (____  /___|  /__|\___  >
        \/            \/                          \/     \/        \/ 
```

node-panic
===============

This module provides a primitive postmortem debugging facility for Node.js.
Postmortem debugging is critical for root-causing issues that occur in
production from the artifacts of a single failure.  Without such a facility,
tracking down problems in production becomes a tedious process of adding
logging, trying to reproduce the problem, and repeating until enough information
is gathered to root-cause the issue.  For reproducible problems, this process is
merely painful for developers, administrators, and customers alike.  For
unreproducible problems, this is untenable.

The basic idea of this implementation is to maintain a global object that
references all of the internal state we would want for postmortem debugging.
Then when our application crashes, we dump this state to a file, and then exit.


The basics
----------

There are only a few functions you need to know about.  The first time this
module is loaded, it creates a global object called `panicDbg` to manage program
debug state.

* `panicDbg.set(key, value)`: registers the object `value` to be dumped under
  the key `key` when the program panics.  This function replaces the value from
  any previous call with the same key.
* `panicDbg.add(keybase, value)`: like panicDbg.set, but generates a unique key
  based on `keybase`.
* `mod_panic.panic(msg, err)`: dumps the given error message an optional
  exception as well as all registered debug state to a file called
  "ncore.<pid>" and then exits the program.
* `mod_panic.enablePanicOnCrash()`: sets up the program to automatically invoke
  `mod_panic.panic` when an uncaught exception bubbles to the event loop

When the program panics (crashes), it saves all debug state to a file called
"ncore.<pid>".  This file is pure JSON and is best read using the "json" tool at:

    https://github.com/trentm/json

In the example above, the program first invokes `enablePanicOnCrash` to set up
automatic panicking when the program crashes.  As each function is invoked, it
adds its argument to the global debug state.  After the program crashes, you
can see the saved state as "func1.arg" and "func2.arg" in the dump.


Example
--------

First, a simple program:

    $ cat examples/example-auto.js 
    /*
     * example-auto.js: simple example of automatically panicking on crash
     */
    
    var mod_panic = require('panic');
    
    function func1(arg1)
    {
    	/* include func1 arg in debug state */
    	panicDbg.set('func1.arg', arg1);
    	func2(arg1 + 10);
    }
    
    function func2(arg2)
    {
    	/* include func2 arg in debug state */
    	panicDbg.set('func2.arg', arg2);
    	/* crash */
    	(undefined).nonexistentMethod();
    }
    
    /*
     * Trigger a panic on crash.
     */
    mod_panic.enablePanicOnCrash();
    
    /*
     * The following line of code will cause this Node program to exit after dumping
     * debug state to ncore.<pid> (including func1's and func2's arguments).
     */
    func1(10);
    console.error('cannot get here');


Run the program:

    $ node examples/example-auto.js 
    [2011-09-12 22:37:36.410 UTC] CRIT   PANIC: panic due to uncaught exception: EXCEPTION: TypeError: TypeError: Cannot call method 'nonexistentMethod' of undefined
        at func2 (/home/dap/node-postmortem/examples/example-auto.js:19:14)
        at func1 (/home/dap/node-postmortem/examples/example-auto.js:11:2)
        at Object.<anonymous> (/home/dap/node-postmortem/examples/example-auto.js:31:1)
        at Module._compile (module.js:402:26)
        at Object..js (module.js:408:10)
        at Module.load (module.js:334:31)
        at Function._load (module.js:293:12)
        at Array.<anonymous> (module.js:421:10)
        at EventEmitter._tickCallback (node.js:126:26)
    [2011-09-12 22:37:36.411 UTC] CRIT   writing core dump to /home/dap/node-postmortem/ncore.22984
    [2011-09-12 22:37:36.413 UTC] CRIT   finished writing core dump


View the "core dump":

    $ json < /home/dap/node-postmortem/ncore.22984
    {
      "dbg.format-version": "0.1",
      "init.process.argv": [
        "node",
        "/home/dap/node-panic/examples/example-auto.js"
      ],
      "init.process.pid": 22984,
      "init.process.cwd": "/home/dap/node-panic",
      "init.process.env": {
        "HOST": "devel",
        "TERM": "xterm-color",
        "SHELL": "/bin/bash",
        "USER": "dap",
        "PWD": "/home/dap/node-panic",
        "MACHINE_THAT_GOES_PING": "1",
        "SHLVL": "1",
        "HOME": "/home/dap",
        "_": "/usr/bin/node"
      },
      "init.process.version": "v0.4.9",
      "init.process.platform": "sunos",
      "init.time": "2011-09-12T22:37:36.408Z",
      "init.time-ms": 1315867056408,
      "func1.arg": 10,
      "func2.arg": 20,
      "panic.error": "EXCEPTION: TypeError: TypeError: Cannot call method 'nonexistentMethod' of undefined\n    at func2 (/home/dap/node-postmortem/examples/example-auto.js:19:14)\n    at func1 (/home/dap/node-postmortem/examples/example-auto.js:11:2)\n    at Object.<anonymous> (/home/dap/node-postmortem/examples/example-auto.js:31:1)\n    at Module._compile (module.js:402:26)\n    at Object..js (module.js:408:10)\n    at Module.load (module.js:334:31)\n    at Function._load (module.js:293:12)\n    at Array.<anonymous> (module.js:421:10)\n    at EventEmitter._tickCallback (node.js:126:26)",
      "panic.time": "2011-09-12T22:37:36.408Z",
      "panic.time-ms": 1315867056408,
      "panic.memusage": {
        "rss": 13000704,
        "vsize": 73252864,
        "heapTotal": 3196160,
        "heapUsed": 1926592
      }
    }


What's in the dump
------------------

The dump itself is just a JSON object.  This module automatically fills in the following keys:

* dbg.format-version: file format version
* init.process.argv: value of process.argv (process arguments)
* init.process.pid: value of process.pid (process identifier)
* init.process.cwd: value of process.cwd (process working directory)
* init.process.env: value of process.env (process environment)
* init.process.version: value of process.version (Node.js version)
* init.process.platform: value of process.platform (operating system)
* init.time: time at which node-panic was loaded
* init.time-ms: time in milliseconds at which node-panic was loaded
* panic.error: string description of the actual error that caused the panic (includes stack trace)
* panic.time: time at which the panic occurred
* panic.time: time in milliseconds at which the panic occurred
* panic.memusage: memory used when the panic occurred

*plus* any information added with `panicDbg.set` or `panicDbg.add`.


Generating dumps from outside the program
-----------------------------------------

node-panic includes a tool called "ncore" for causing a node program that's
already loaded node-panic to dump core on demand *without* any other cooperation
from the program itself.  That is, even if the program is stuck inside an
infinite loop, "ncore" can interrupt it to take a core dump.

Caveat: this tool can be very dangerous!  Since it uses SIGUSR1, invoking it on
non-node processes can result in all kinds of failure.  (On Illumos systems,
"ncore" will automatically detect this case and bail out.)  Additionally, if
another program on the same system is using the node debugger, ncore will fail.
"ncore" tries to avoid hijacking another debugger session, but this check is
inherently racy.  Because of these risks, this tool should be viewed as a last
resort, but it can be extremely valuable when needed.

Let's take a look at how it works:

    $ cat examples/example-loop.js 
    /*
     * example-loop.js: example of using "ncore" tool to generate a node core
     */
    
    var mod_panic = require('panic');
    
    function func()
    {
    	for (var ii = 0; ; ii++)
    		panicDbg.set('func-iter', ii);
    }
    
    console.log('starting infinite loop; use "ncore" tool to generate core');
    func();

Now run the program:

    $ node examples/example-loop.js
    starting infinite loop; use "ncore" tool to generate core

In another shell, run "ncore" on the given program:

    $ ncore 1369
    attempting to attach to process 1369 ... . ok.

And back in the first shell we see:

    Hit SIGUSR1 - starting debugger agent.
    debugger listening on port 5858[2011-09-13 19:20:38.265 UTC] CRIT   PANIC:
    explicit panic: EXCEPTION: Error: Error: core dump initiated at user request
        at caPanic (/Users/dap/work/node-panic/lib/panic.js:55:9)
        at eval at func (/Users/dap/work/node-panic/examples/example-loop.js:9:23)
        at ExecutionState.evaluateGlobal (native)
        at DebugCommandProcessor.evaluateRequest_ (native)
        at DebugCommandProcessor.processDebugJSONRequest (native)
        at DebugCommandProcessor.processDebugRequest (native)
        at func (/Users/dap/work/node-panic/examples/example-loop.js:9:23)
        at Object.<anonymous>
    (/Users/dap/work/node-panic/examples/example-loop.js:14:1)
        at Module._compile (module.js:402:26)
        at Object..js (module.js:408:10)
    [2011-09-13 19:20:38.265 UTC] CRIT   writing core dump to
    /Users/dap/work/node-panic/ncore.1369
    [2011-09-13 19:20:38.294 UTC] CRIT   finished writing core dump

And we now have a core dump from the process somewhere in the middle of the
loop:

    $ json < ncore.1369 
    {
      "dbg.format-version": "0.1",
      "init.process.argv": [
        "node",
        "/Users/dap/work/node-panic/examples/example-loop.js"
      ],
      "init.process.pid": 1369,
      "init.process.cwd": "/Users/dap/work/node-panic",
      ...
      "func-iter": 604762552,
      "panic.error": "EXCEPTION: Error: Error: core dump initiated at user request\n
    at caPanic (/Users/dap/work/node-panic/lib/panic.js:55:9)\n    at eval at func
    (/Users/dap/work/node-panic/examples/example-loop.js:9:23)\n    at
    ExecutionState.evaluateGlobal (native)\n    at
    DebugCommandProcessor.evaluateRequest_ (native)\n    at
    DebugCommandProcessor.processDebugJSONRequest (native)\n    at
    DebugCommandProcessor.processDebugRequest (native)\n    at func
    (/Users/dap/work/node-panic/examples/example-loop.js:9:23)\n    at
    Object.<anonymous> (/Users/dap/work/node-panic/examples/example-loop.js:14:1)\n
    at Module._compile (module.js:402:26)\n    at Object..js (module.js:408:10)",
    }


Notes
-----

This facility was initially developed for Joyent's Cloud Analytics service.
For more information on Cloud Analytics, see http://dtrace.org/blogs/dap/files/2011/07/ca-oscon-data.pdf

Pull requests accepted, but code must pass style and lint checks using:

* style: https://github.com/davepacheco/jsstyle
* lint: https://github.com/davepacheco/javascriptlint

This facility has been tested on MacOSX and Illumos with Node.js v0.4.  It has
few dependencies on either the underlying platform or the Node version and so
should work on other platforms.
