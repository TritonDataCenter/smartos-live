<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2019 Joyent, Inc.
-->

# node-qlocker: Ordered file locks

This repository is part of the Joyent Triton project. See the [contribution
guidelines](https://github.com/joyent/triton/blob/master/CONTRIBUTING.md).
Github pull requests are welcome.

This module allows synchronization within a single node program and across
programs.  Interprocess synchronization is accomplished using POSIX style
exclusive write file locks.  Intraprocess synchronization is accomplished by
allowing only one caller at time to attempt to hold the exclusive lock on the
specified file.  Within a process, callers will obtain the lock in the order in
which they called `lock()`.  Interprocess ordering and fairness are not
guaranteed.


## Usage

### lock(path, callback)

Will attempt to lock `path`, calling `callback(err, unlock_fn)` upon success or
failure.  If `path` exists, it must be writable.  If `path` does not exist, the
directory in which path will live must exist and must allow file creation.

So long as `fcntl` fails with `EAGAIN`, `ENOLCK`, or `EDEADLK`, `lock` will
retry several times per second.  If `fcntl` fails, the `callback` will be called
wih a `err` as a non-null value.  Upon success, `callback` will be called with
an unlock function that the caller must call to release the lock.


## Example

```
var qlocker = require('qlocker');
var path = 'a_file';

qlocker.lock(path, function lock_cb(err, unlocker) {
    if (err) {
        throw(err);
    }

    // Critical section here (lock is held)
    console.log('%s is locked', path);

    unlocker(function unlock_cb(){
        consle.log('%s is unlocked', path);
    });
}
```

## Development

### Build and sanity check with make

Any commits to this repo must comply with Joyent's style and lint requirements
as well as have all unit tests passing.  The easiest way to test all of these is
with:

```
$ make
```

### Build with npm

```
$ npm install
```

### Test with npm

```
$ npm test
```

## License

node-qlocker is licensed under the
[Mozilla Public License version 2.0](http://mozilla.org/MPL/2.0/).
See the file LICENSE.
