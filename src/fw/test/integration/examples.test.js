/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration test: test that commands and payloads in etc/examples are
 * actually valid
 */

var async = require('async');
var exec = require('child_process').exec;
var fs = require('fs');
var mod_vm = require('../lib/vm');
var path = require('path');
var util = require('util');



// --- Globals



var EX_DIR = '/usr/fw/etc/examples';
var EXAMPLES = {};
var IMAGE_UUID = mod_vm.images.smartos;
var RULES = {};
var RVMS = {};
var TEMP_FILES = [];
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
        t.ifError(err, desc + 'error running: ' + cmd);
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



// --- Setup



exports['setup'] = function (t) {
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

    return t.done();
};



// --- Tests



exports['fwadm examples: add / update'] = function (t) {
    var examples = Object.keys(EXAMPLES.fwadm).sort();
    async.forEachSeries(examples, function _doAdd(ex, cb) {
        // Handle list tests in the next two blocks
        if (ex.indexOf('list') !== -1) {
            return cb();
        }

        exec(EXAMPLES.fwadm[ex], function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + ex);
            t.equal(stderr, '', 'stderr: ' + ex);
            if (ex.indexOf('add') !== -1) {
                addRulesAndRVMs(stdout);
            }

            delete EXAMPLES.fwadm[ex];
            return cb();
        });
    }, function () {
        return t.done();
    });
};


exports['fwadm_list_json'] = function (t) {
    exec(EXAMPLES.fwadm.fwadm_list_json, function (err, stdout, stderr) {
        t.ifError(err, 'error running');
        t.equal(stderr, '', 'stderr');
        if (err) {
            return t.done();
        }

        var rules = Object.keys(RULES);
        var json = [];
        try {
            json = JSON.parse(stdout);
        } catch (parseErr) {
            t.ifError(parseErr, 'JSON parse error');
        }

        json.forEach(function (r) {
            if (RULES.hasOwnProperty(r.uuid)) {
                rules.splice(rules.indexOf(r.uuid), 1);
            }
        });

        t.deepEqual(rules, [], 'All added rules found in list');
        delete EXAMPLES.fwadm.fwadm_list_json;
        return t.done();
    });
};


exports['fwadm_list_parseable'] = function (t) {
    exec(EXAMPLES.fwadm.fwadm_list_parseable, function (err, stdout, stderr) {
        t.ifError(err, 'error running');
        t.equal(stderr, '', 'stderr');
        if (err) {
            return t.done();
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
        return t.done();
    });
};


exports['rvm rules'] = function (t) {
    var examples = Object.keys(EXAMPLES.rvm).filter(function (ex) {
        return (ex.indexOf('rule') !== -1);
    });
    t.ok(examples.length > 0, 'have rules to add');

    async.forEachSeries(examples, function _doRVMruleAdd(ex, cb) {
        var cmd = 'fwadm add -f ' + path.join(EX_DIR, ex);

        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);
            addRulesAndRVMs(stdout);

            delete EXAMPLES.rvm[ex];
            return cb();
        });
    }, function () {
        return t.done();
    });
};


exports['rvm remote VMs'] = function (t) {
    var examples = Object.keys(EXAMPLES.rvm).filter(function (ex) {
        return (ex.indexOf('_rvm') !== -1);
    });
    t.ok(examples.length > 0, 'have remote VMs to add');

    async.forEachSeries(examples, function _doRVMruleAdd(ex, cb) {
        var cmd = 'fwadm add-rvm -f ' + path.join(EX_DIR, ex);

        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);
            addRulesAndRVMs(stdout);

            delete EXAMPLES.rvm[ex];
            return cb();
        });
    }, function () {
        return t.done();
    });
};


exports['vmadm'] = {
    'vmadm_rule1': function (t) {
        var cmd = 'fwadm add -f ' + path.join(EX_DIR, 'vmadm_rule1');

        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);
            addRulesAndRVMs(stdout);

            delete EXAMPLES.vmadm.vmadm_rule1;
            return t.done();
        });
    },

    'vmadm_vm1': function (t) {
        mod_vm.create(t, {
            file: path.join(EX_DIR, 'vmadm_vm1')
        }, function (err) {
            if (!err) {
                delete EXAMPLES.vmadm.vmadm_vm1;
            }

            return t.done();
        });
    },

    'stats after vmadm_vm1': function (t) {
        fwStatsContain(t, VMS[0], [
            'block out quick proto tcp from any to any port = smtp'
        ], 'smtp block rule applied', function () {
            return t.done();
        });
    },

    'vmadm_rule2': function (t) {
        var cmd = 'fwadm add -f ' + path.join(EX_DIR, 'vmadm_rule2');

        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);
            addRulesAndRVMs(stdout);

            delete EXAMPLES.vmadm.vmadm_rule2;
            return t.done();
        });
    },

    'vmadm_cmd1': function (t) {
        var cmd = EXAMPLES.vmadm.vmadm_cmd1;
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stderr, 'Successfully updated VM ' + VMS[0] + '\n',
                'stderr: ' + cmd);

            delete EXAMPLES.vmadm.vmadm_cmd1;
            return t.done();
        });
    },

    'stats after vmadm_cmd1': function (t) {
        fwStatsContain(t, VMS[0], [
            'block out quick proto tcp from any to any port = smtp',
            'pass in quick proto tcp from any to any port = www',
            'pass in quick proto tcp from any to any port = https'
        ], 'smtp block rule applied', function () {
            return t.done();
        });
    },

    'fwadm stop': function (t) {
        // In the man page but not in the examples dir: disable the VM
        // and make sure there are no rules
        var cmd = 'fwadm stop ' + VMS[0];
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stdout, 'Firewall stopped for VM ' + VMS[0] + '\n',
                'stdout: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);

            return t.done();
        });
    },

    'fwadm stats after stop': function (t) {
        var cmd = 'fwadm stats ' + VMS[0];
        exec(cmd, function (err, stdout, stderr) {
            t.ok(err, 'expected error running: ' + cmd);
            t.equal(stderr, 'Firewall is not running for VM "'
                + VMS[0] + '"\n',
                'stderr: ' + cmd);

            return t.done();
        });
    },

    'fwadm start': function (t) {
        // Now re-enable and make sure it has the same rules
        var cmd = 'fwadm start ' + VMS[0];
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stdout, 'Firewall started for VM ' + VMS[0] + '\n',
                'stdout: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);

            return t.done();
        });
    },

    'stats after start': function (t) {
        fwStatsContain(t, VMS[0], [
            'block out quick proto tcp from any to any port = smtp',
            'pass in quick proto tcp from any to any port = www',
            'pass in quick proto tcp from any to any port = https'
        ], 'smtp block rule applied', function () {
            return t.done();
        });
    }
};


exports['delete rules'] = function (t) {
    var rules = Object.keys(RULES);
    t.ok(rules.length > 0, 'rules were added');
    if (rules.length === 0) {
        return t.done();
    }

    async.forEachSeries(rules, function _delRule(rule, cb) {
        var cmd = 'fwadm delete ' + rule;
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);

            if (!err) {
                delete RULES[rule];
            }

            return cb();
        });
    }, function () {
        return t.done();
    });
};


exports['delete remote VMs'] = function (t) {
    var rvms = Object.keys(RVMS);
    t.ok(rvms.length > 0, 'remote VMs were added');
    if (rvms.length === 0) {
        return t.done();
    }

    async.forEachSeries(rvms, function _delRVM(rvm, cb) {
        var cmd = 'fwadm delete-rvm ' + rvm;
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, 'error running: ' + cmd);
            t.equal(stderr, '', 'stderr: ' + cmd);

            if (!err) {
                delete RVMS[rvm];
            }

            return cb();
        });
    }, function () {
        return t.done();
    });
};


/*
 * Test that we've tried all of the examples
 */
exports['all examples tested'] = function (t) {
    for (var pfx in EXAMPLES) {
        t.deepEqual(Object.keys(EXAMPLES[pfx]), [],
            'No ' + pfx + ' examples left unused');
    }

    t.deepEqual(Object.keys(RULES), [], 'All rules deleted');
    t.deepEqual(Object.keys(RVMS), [], 'All remote VMs deleted');

    return t.done();
};



// --- Teardown



exports['teardown'] = function (t) {
    mod_vm.delAllCreated(t, {});
};
