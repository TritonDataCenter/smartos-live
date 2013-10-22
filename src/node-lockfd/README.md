# node-lockfd

A trivial wrapper around `fcntl(F_SETLK)` (or `F_SETLKW`).  Presently allows
a synchronous or asynchronous call to get a whole-file, exclusive, advisory
write lock on a file, or to block until one is possible.

This module has been crafted specifically to work on SmartOS, and may not work
anywhere else.  Please see [fcntl(2)](http://illumos.org/man/2/fcntl) for more
details on the locking semantics.  In general, the lock will be released when
either the file descriptor is closed, or the process exits.  The manual page
contains information on exceptions to this behaviour.

## Usage

### lockfd(fd, callback)

Will attempt to lock the open file descriptor `fd` as described above.  Once
the lock is acquired, or an error condition manifests, `callback(err)` will be
called.

### lockfdSync(fd)

Synchronous version of `lockfd(fd)`.

## Examples

```javascript
var mod_fs = require('fs');
var mod_lockfd = require('lockfd');

var fd = mod_fs.openSync('/tmp/.lockfile', 'r+');
console.error('open fd %d', fd);

console.error('locking file...');
mod_lockfd.lockfdSync(fd);
console.log('locked.');

/*
 * Do work...
 */

mod_fs.closeSync(fd);
process.exit(0);
```

## License

MIT.
