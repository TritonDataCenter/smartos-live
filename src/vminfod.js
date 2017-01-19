#!/usr/node/bin/node
/**
 * command to interface with vminfod daemon
 */

var f = require('util').format;

var vminfod = require('/usr/vm/node_modules/vminfod/client');
var client = new vminfod.VminfodClient('vminfod CLI');

function usage() {
    var _args = Array.prototype.slice.call(arguments);
    var msg = f.apply(null, _args);
    console.log([
        msg,
        '',
        'Usage: vminfod [command] [args]',
        '',
        'Commands',
        '  ping               get vminfod ping     (GET /ping)',
        '  data               get all vminfod data (GET /data)',
        '  status             get vminfod status   (GET /status)',
        '  vms                get all vms          (GET /vms)',
        '  vm <uuid>          get vm info          (GET /vms/:uuid)',
        '  events [-j]        trace vminfod events (GET /events)'
    ].join('\n'));
}

var args = process.argv.slice(2);
var cmd = args.shift();

switch (cmd) {
    case 'ping':
    case 'status':
    case 'vms':
    case 'data':
        client[cmd](function (err, out) {
            if (err)
                throw err;
            console.log(JSON.stringify(out, null, 2));
        });
        break;
    case 'vm':
        var vm = args[0];
        if (!vm) {
            console.error('uuid argument missing');
            process.exit(1);
        }
        client.vm(vm, function (err, out) {
            if (err)
                throw err;
            console.log(JSON.stringify(out, null, 2));
        });
        break;
    case 'events':
        var vs = client.createEventStream();
        vs.on('readable', function () {
            var ev;
            while ((ev = vs.read()) !== null) {
                if (args[0] === '-j' || args[0] === '--json') {
                    console.log(JSON.stringify(ev));
                    return;
                }

                var zn = ev.zonename.split('-')[0];
                var date = ev.ts.toISOString();
                if (args[0] === '-f' || args[0] === '--full') {
                    zn = ev.zonename;
                } else {
                    date = date.split('T')[1];
                }

                var alias = (ev.vm || {}).alias || '-';

                // format the output nicely
                var base = f('[%s] %s %s %s',
                    date, zn, alias, ev.type);

                delete ev.vm;
                if (ev.changes) {
                    ev.changes.forEach(function (change) {
                        console.log('%s: %s %s :: %j -> %j',
                            base,
                            change.prettyPath,
                            change.action,
                            change.from,
                            change.to);
                    });
                } else {
                    console.log(base);
                }
            }
        });
        break;
    case undefined:
        usage('Command be specified as the first argument');
        process.exit(1);
        break;
    default:
        usage('Unknown command: %s', cmd);
        process.exit(1);
        break;
}
