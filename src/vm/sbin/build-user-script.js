#!/usr/bin/node
/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * This tool takes a filename as the only parameter and generates an update
 * payload for use with vmadm that turns the specified file into the
 * user-script for the VM.
 *
 * For example:
 *
 *   build-user-script /path/to/script.sh | vmadm update <UUID>
 *
 */

var fs=require('fs');

function usage ()
{
    console.log('Usage: ' + process.argv[1] + ' <filename>');
    process.exit(1);
}

if (!process.argv[2]) {
    usage();
} else {
    fs.readFile(process.argv[2], function (error, data) {
        var payload = {};
        if (error) {
            console.error(error.message);
            process.exit(1);
        }
        payload.set_customer_metadata = {'user-script': data.toString()};
        console.log(JSON.stringify(payload, null, 2));
    });
}
