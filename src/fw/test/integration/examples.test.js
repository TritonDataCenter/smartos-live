/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration test: test that commands and payloads in etc/examples are
 * actually valid
 */

process.env['TAP'] = 1;
var async = require('async');
var exec = require('child_process').exec;
var fs = require('fs');
var path = require('path');
var test = require('tap').test;
var util = require('util');
var vmtest = require('/usr/vm/test/common/vmtest');



// --- Globals



// Set to 'false' to keep VMs around for later inspection
var DELETE_VMS = true;
var EX_DIR = '/usr/fw/etc/examples';
var EXAMPLES = {};
var IMAGE_UUID = vmtest.CURRENT_SMARTOS_UUID;
var RULES = {};
var RVMS = {};
var TEMP_FILES = [];
var TEST_OPTS = { timeout: 240000 };
var VMS = [
    // vmadm_vm1
    '60e90d15-fb48-4bb9-90e6-1e1bb8269d1e'
];



// --- Helpers


/**
 * Add rules to the RULES object and remote VMs to the RVMS object so we can
 * delete them at the end of the test
 */
function addRulesAndRVMs(stdout) {
    if (!stdout || stdout === '') {
        return;
    }

    var populating;
    stdout.split('\n').forEach(function (line) {
        if (line === '') {
            return;
        }

        if (line == 'Added rules:') {
            populating = 'rules';
            return;
        }

        if (line == 'Added remote VMs:') {
            populating = 'rvms';
            return;
        }

        var fields = line.split(/\s+/g);
        if (!populating) {
            // t.ok(false, 'Found unaccounted for line in add output: ' + line);
            return;
        }

        if (populating == 'rules') {
            RULES[fields[0]] = true;
        }

        if (populating == 'rvms') {
            RVMS[fields[0]] = true;
        }

        return;
    });
}


/**
 * Test whether the ipf rules show up in 'fwadm status' for a VM
 */
function fwStatsContain(t, uuid, inLines, inDesc, cb) {
    var cmd = 'fwadm stats ' + uuid;
    var desc = inDesc + ': ';
    // clone the input:
    var lines = inLines.map(function (l) { return l; });

    exec(cmd, function (err, stdout, stderr) {
        t.ifErr(err, desc + 'error running: ' + cmd);
        t.equal(stderr, '', desc + 'stderr: ' + cmd);

        var rules = [];

        stdout.split('\n').forEach(function (line) {
            if (line === '') {
                return;
            }

            var parts = line.split(/\s+/g);
            parts.shift();
            var rule = parts.join(' ');
            var idx = lines.indexOf(rule);
            if (idx !== -1) {
                t.ok(true, desc + 'found rule: ' + rule);
                lines.splice(idx, 1);
            }

            rules.push(rule);
        });

        t.deepEqual(lines, [], desc + 'found all rules');
        if (lines.length !== 0) {
            t.deepEqual(rules, [], desc + 'rules found');
        }

        return cb();
    });
}


/**
 * Delete a VM with vmadm, but do not cause an error if the VM has already
 * been deleted
 */
function vmDelete(t, uuid, inDesc, callback) {
    var cmd = 'vmadm delete ' + uuid;
    var desc = inDesc + ': ';

    if (!DELETE_VMS) {
        t.ok(true, 'DELETE_VMS=false: not deleting VM ' + uuid);
        return callback();
    }

    exec(cmd, function (err, stdout, stderr) {
        if (err) {
            if (err.message.indexOf('No such zone configured') !== -1) {
                t.ok(true, desc + 'VM ' + uuid + ' already deleted');
                return callback();
            }

            t.ifErr(err, desc + 'error running: ' + cmd);
        }

        t.equal(stderr, 'Successfully deleted VM ' + uuid + '\n',
            desc + 'stderr: ' + cmd);
        return callback(err);
    });
}



// --- Tests



test('setup', function (t) {
    var exampleFiles = fs.readdirSync(EX_DIR);
    t.ok(exampleFiles.length > 1, 'example files exist');

    exampleFiles.forEach(function (ex) {
        var prefix = ex.split('_')[0];
        if (!EXAMPLES.hasOwnProperty(prefix)) {
            EXAMPLES[prefix] = {};
        }

        EXAMPLES[prefix][ex] =
            fs.readFileSync(path.join(EX_DIR, ex)).toString();
    });

    vmtest.ensureCurrentImages(t, [ IMAGE_UUID ], function () {
        t.end();
    });
});


test('delete VMs from previous test runs', TEST_OPTS, function (t) {
    async.forEachSeries(VMS, function _doVMdelete(uuid, cb) {
        vmDelete(t, uuid, 'cleanup leftover VMs', cb);
    }, function () {
        t.end();
    });
});


test('fwadm examples: add / update', function (t) {
    var examples = Object.keys(EXAMPLES.fwadm).sort();
    async.forEachSeries(examples, function _doAdd(ex, cb) {
        // Handle list tests in the next two blocks
        if (ex.indexOf('list') !== -1) {
            return cb();
        }

        exec(EXAMPLES.fwadm[ex], function (err, stdout, stderr) {
            t.ifErr(err, 'error running: ' + ex);
            t.equal(stderr, '', 'stderr: ' + ex);
            if (ex.indexOf('add') !== -1) {
                addRulesAndRVMs(stdout);
            }

            delete EXAMPLES.fwadm[ex];
            return cb();
        });
    }, function () {
        t.end();
    });
});


test('fwadm_list_json', function (t) {
    exec(EXAMPLES.fwadm.fwadm_list_json, function (err, stdout, stderr) {
        t.ifErr(err, 'error running');
        t.equal(stderr, '', 'stderr');
        if (err) {
            return t.end();
        }

        var rules = Object.keys(RULES);
        var json = [];
        try {
            json = JSON.parse(stdout);
        } catch (parseErr) {
            t.ifErr(parseErr, 'JSON parse error');
        }

        json.forEach(function (r) {
            if (RULES.hasOwnProperty(r.uuid)) {
                rules.splice(rules.indexOf(r.uuid), 1);
            }
        });

        t.deepEqual(rules, [], 'All added rules found in list');
        delete EXAMPLES.fwadm.fwadm_list_json;
        return t.end();
    });
});


test('fwadm_list_parseable', function (t) {
    exec(EXAMPLES.fwadm.fwadm_list_parseable, function (err, stdout, stderr) {
        t.ifErr(err, 'error running');
        t.equal(stderr, '', 'stderr');
        if (err) {
            return t.end();
        }

        var rules = Object.keys(RULES);
        stdout.split('\n').forEach(function (r) {
            if (r === '') {
                return;
            }

            var fields = r.split('|');
            t.equal(fields.length, 3, '3 fields per line');

            if (RULES.hasOwnProperty(fields[0])) {
                rules.splice(rules.indexOf(fields[0]), 1);
            }
        });

        t.deepEqual(rules, [], 'All added rules found in list');
        delete EXAMPLES.fwadm.fwadm_list_parseable;
        return t.end();
    });
});


test('rvm rules', function (t) {
    var examples = Object.keys(EXAMPLES.rvm).filter(function (ex) {
        return (ex.indexOf('rule') !== -1);
    });
    t.ok(examples.length > 0, 'have rules to add');

    async.forEachSeries(examples, function _doRVMruleAdd(ex, cb) {
        var cmd = 'fwadm add -f ' + path.join(EX_DIR, ex);

        exec(cmd, function (err, stdout, stderr) {
            t.ifErr(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);
            addRulesAndRVMs(stdout);

            delete EXAMPLES.rvm[ex];
            return cb();
        });
    }, function () {
        t.end();
    });
});


test('rvm remote VMs', function (t) {
    var examples = Object.keys(EXAMPLES.rvm).filter(function (ex) {
        return (ex.indexOf('_rvm') !== -1);
    });
    t.ok(examples.length > 0, 'have remote VMs to add');

    async.forEachSeries(examples, function _doRVMruleAdd(ex, cb) {
        var cmd = 'fwadm add-rvm -f ' + path.join(EX_DIR, ex);

        exec(cmd, function (err, stdout, stderr) {
            t.ifErr(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);
            addRulesAndRVMs(stdout);

            delete EXAMPLES.rvm[ex];
            return cb();
        });
    }, function () {
        t.end();
    });
});


test('vmadm', TEST_OPTS, function (t) {
    async.series([
        function (cb) {
            var cmd = 'fwadm add -f ' + path.join(EX_DIR, 'vmadm_rule1');

            exec(cmd, function (err, stdout, stderr) {
                t.ifErr(err, 'error running: ' + cmd);
                t.equal(stderr, '', 'stderr: ' + cmd);
                addRulesAndRVMs(stdout);

                delete EXAMPLES.vmadm.vmadm_rule1;
                return cb();
            });

        }, function (cb) {
            var cmd = 'vmadm create -f ' + path.join(EX_DIR, 'vmadm_vm1');

            exec(cmd, function (err, stdout, stderr) {
                t.ifErr(err, 'error running: ' + cmd);
                t.equal(stderr, 'Successfully created VM ' + VMS[0] + '\n',
                    'stderr: ' + cmd);

                delete EXAMPLES.vmadm.vmadm_vm1;
                return cb();
            });

        }, function (cb) {
            fwStatsContain(t, VMS[0], [
                'block out quick proto tcp from any to any port = smtp'
            ], 'smtp block rule applied', cb);

        }, function (cb) {
            var cmd = 'fwadm add -f ' + path.join(EX_DIR, 'vmadm_rule2');

            exec(cmd, function (err, stdout, stderr) {
                t.ifErr(err, 'error running: ' + cmd);
                t.equal(stderr, '', 'stderr: ' + cmd);
                addRulesAndRVMs(stdout);

                delete EXAMPLES.vmadm.vmadm_rule2;
                return cb();
            });

        }, function (cb) {
            var cmd = EXAMPLES.vmadm.vmadm_cmd1;
            exec(cmd, function (err, stdout, stderr) {
                t.ifErr(err, 'error running: ' + cmd);
                t.equal(stderr, 'Successfully updated VM ' + VMS[0] + '\n',
                    'stderr: ' + cmd);

                delete EXAMPLES.vmadm.vmadm_cmd1;
                return cb();
            });

        }, function (cb) {
            fwStatsContain(t, VMS[0], [
                'block out quick proto tcp from any to any port = smtp',
                'pass in quick proto tcp from any to any port = www',
                'pass in quick proto tcp from any to any port = https'
            ], 'smtp block rule applied', cb);
        }

    ], function () {
        t.end();
    });
});


test('delete rules', function (t) {
    var rules = Object.keys(RULES);
    t.ok(rules.length > 0, 'rules were added');
    if (rules.length === 0) {
        return t.end();
    }

    async.forEachSeries(rules, function _delRule(rule, cb) {
        var cmd = 'fwadm delete ' + rule;
        exec(cmd, function (err, stdout, stderr) {
            t.ifErr(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);

            if (!err) {
                delete RULES[rule];
            }

            return cb();
        });
    }, function () {
        t.end();
    });
});


test('delete remote VMs', function (t) {
    var rvms = Object.keys(RVMS);
    t.ok(rvms.length > 0, 'remote VMs were added');
    if (rvms.length === 0) {
        return t.end();
    }

    async.forEachSeries(rvms, function _delRVM(rvm, cb) {
        var cmd = 'fwadm delete-rvm ' + rvm;
        exec(cmd, function (err, stdout, stderr) {
            t.ifErr(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);

            if (!err) {
                delete RVMS[rvm];
            }

            return cb();
        });
    }, function () {
        t.end();
    });
});


test('cleanup created VMs', TEST_OPTS, function (t) {
    async.forEachSeries(VMS, function _doVMdelete(uuid, cb) {
        vmDelete(t, uuid, 'cleanup', cb);
    }, function () {
        t.end();
    });
});


/*
 * Test that we've tried all of the examples
 */
test('all examples tested', function (t) {
    for (var pfx in EXAMPLES) {
        t.deepEqual(Object.keys(EXAMPLES[pfx]), [],
            'No ' + pfx + ' examples left unused');
    }

    t.deepEqual(Object.keys(RULES), [], 'All rules deleted');
    t.deepEqual(Object.keys(RVMS), [], 'All remote VMs deleted');

    t.end();
});
