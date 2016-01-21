node-zonename
=============

Native bindings to the `getzonebyid(3C)` library

Usage
-----

``` js
var zone = require('zonename');
```

### `zone.getzoneid()`

Get the current zone id - direct wrapper of `getzoneid(3C)`

### `zone.getzonenamebyid(id)`

Get the zone name for a given zone id - direct wrapper of `getzonenamebyid(3C)`

### `zone.getzoneidbyname(name)`

Get the zone id for a given zone name - direct wrapper of `getzoneidbyname(3C)`

### `zone.getzonename()`

Get the current zone name - convenience wrapper for `getzonenamebyid(getzoneid())`

Example
-------

``` js
var zone = require('zonename');

zone.getzonename();
// => "global"

zone.getzoneid();
// => 0

zone.getzonenamebyid(1);
// => "39f07647-6f8a-4671-898c-104f64501ac9"

zone.getzoneidbyname("39f07647-6f8a-4671-898c-104f64501ac9");
// => 1
```

If a zone id or zonename is invalid or not found on the system an error
will be thrown.

Benchmark
---------

Simple benchmark to show this native module vs fork+exec of `zonename(1)`

```
$ ./benchmark/benchmark.js
zonename()        0.000098533 seconds
execFile zonename 0.032777991 seconds
```

License
-------

MIT License
