#!/usr/node/bin/node
/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * This tool takes a filename as the only parameter and optionally a payload on
 * stdin and outputs a payload with the appropriate user-script settings. The
 * the filename specified will be the user-script. To force a 'create' payload
 * include either the 'brand' or 'customer_metadata' keys in your input payload.
 * The default is to create an update payload.
 *
 * For example:
 *
 *   (add-userscript /path/to/script.sh < update.json) | vmadm update <UUID>
 *   (add-userscript /path/to/script.sh < payload.json) | vmadm create
 *
 */

var fs = require('fs');
var tty = require('tty');
var util = require('util');

function usage()
{
    console.log('Usage: ' + process.argv[1] + ' <filename>');
    process.exit(1);
}

if (!process.argv[2]) {
    usage();
} else {
    fs.readFile(tty.isatty(0) ? '/dev/null' : '/dev/stdin',
        function (in_error, in_data) {

        var action;
        var payload = {};
        if (!in_error) {
            try {
                payload = JSON.parse(in_data.toString());
            } catch (e) {
                if (e.message !==  'Unexpected end of input') {
                    console.error('Warning(JSON.parse): ' + e.message);
                }
            }
        } else {
            console.error(in_error.message);
        }

        if (payload.hasOwnProperty('brand')
            || payload.hasOwnProperty('customer_metadata')) {
            // assume create if we have a brand
            action = 'create';
        } else {
            action = 'update';
        }

        fs.readFile(process.argv[2], function (error, data) {
            if (error) {
                console.error(error.message);
                process.exit(1);
            }
            if (action === 'create') {
                if (!payload.hasOwnProperty('customer_metadata')) {
                    payload.customer_metadata = {};
                }
                payload.customer_metadata['user-script'] = data.toString();
            } else {
                if (!payload.hasOwnProperty('set_customer_metadata')) {
                    payload.set_customer_metadata = {};
                }
                payload.set_customer_metadata['user-script'] = data.toString();
            }
            console.log(JSON.stringify(payload, null, 2));
        });
    });
}
