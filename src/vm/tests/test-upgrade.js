// Copyright 2015 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var aborted = false;
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var kvm_image_uuid = vmtest.CURRENT_UBUNTU_UUID;
var vmobj;

var smartos_payload =
{
    alias: 'test-upgrade-' + process.pid,
    do_not_inventory: true,
    image_uuid: image_uuid,
    max_physical_memory: 256,
    nics: [
        {
            ip: '10.254.254.254',
            netmask: '255.255.255.0',
            nic_tag: 'external',
            interface: 'net0',
            vlan_id: 0,
            gateway: '10.254.254.1',
            mac: '00:02:03:04:05:06'
        }
    ]
};

var kvm_payload =
{
    alias: 'test-upgrade-' + process.pid,
    brand: 'kvm',
    do_not_inventory: true,
    max_physical_memory: 256,
    disk_driver: 'virtio',
    nic_driver: 'virtio',
    disks: [
        { image_uuid: kvm_image_uuid },
        { size: 1024 }
    ],
    nics: [
        {
            ip: '10.254.254.254',
            netmask: '255.255.255.0',
            nic_tag: 'external',
            interface: 'net0',
            vlan_id: 0,
            gateway: '10.254.254.1',
            mac: '06:05:04:03:02:01'
        }
    ]
};


// trim functions also copied from VM.js
function ltrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('^[' + chars + ']+', 'g'), '');
}

function rtrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
}

function trim(str, chars)
{
    return ltrim(rtrim(str, chars), chars);
}

function zonecfg(args, callback)
{
    var cmd = '/usr/sbin/zonecfg';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

function zfs(args, callback)
{
    var cmd = '/usr/sbin/zfs';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

test('create smartos VM', function(t) {
    VM.create(smartos_payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            aborted = true;
            t.end();
        } else {
            VM.load(obj.uuid, {}, function (err, o) {
                t.ok(!err, 'loaded VM after create');
                if (!err) {
                    vmobj = o;
                } else {
                    aborted = true;
                }
                t.end();
            });
        }
    });
});

test('time machine for smartos VM', function(t) {

    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }

    async.series([
        function (cb) {
            // remove vm-version to simulate old zone
            zonecfg(['-z', vmobj.zonename, 'remove attr name=vm-version;'], function (err, fds) {
                t.ok(!err, 'removed vm-version: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // set max_swap to a too-low value, upgrade should bump to 256 (MIN_SWAP)
            zonecfg(['-z', vmobj.zonename, 'select capped-memory; set swap=128m; end'], function (err, fds) {
                t.ok(!err, 'set swap to 128m: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // name cores dataset the old way so upgrade can move it back
            zfs(['rename', '-f', 'zones/cores/' + vmobj.zonename, 'zones/' + vmobj.zonename + '/cores'], function (err, fds) {
                t.ok(!err, 'renamed cores to zones/' + vmobj.zonename + '/cores: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // set cores quota to 10G so upgrade can bump it to at least 100G
            zfs(['set', 'quota=10G', 'zones/' + vmobj.zonename + '/cores'], function (err, fds) {
                t.ok(!err, 'set 10G quota on zones/' + vmobj.zonename + '/cores: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // remove dataset-uuid property at top level, upgrade should add back
            zonecfg(['-z', vmobj.zonename, 'remove attr name=dataset-uuid'], function (err, fds) {
                t.ok(!err, 'removed dataset-uuid: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // remove create-timestamp property at top level, upgrade should add back
            // using the value from the dataset creation time.
            zonecfg(['-z', vmobj.zonename, 'remove attr name=create-timestamp'], function (err, fds) {
                t.ok(!err, 'removed create-timestamp: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // remove primary property from nic, upgrade should add back
            zonecfg(['-z', vmobj.zonename, 'select net physical=net0; remove property (name=primary,value="true"); end'], function (err, fds) {
                t.ok(!err, 'removed net0.primary: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            var default_gateway = vmobj.nics[0].gateway;

            t.ok(default_gateway, 'default_gateway is: ' + default_gateway);

            // set default_gateway at top level so upgrade can remove it
            zonecfg(['-z', vmobj.zonename, 'add attr; set name=default-gateway; set type=string; set value="' + default_gateway + '"; end'], function (err, fds) {
                t.ok(!err, 'set default_gateway: ' + JSON.stringify(fds));
                cb();
            });
        }
    ], function (err) {

        if (err) {
            t.ok(false, 'failed, leaving ' + vmobj.uuid + ' for investigation');
            aborted = true;
            t.end();
            return;
        }

        t.end();
    });
});

function upgrade_zone(t) {
    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }
    execFile('/usr/sbin/svcadm', ['restart', 'vmadmd'], function (error, stdout, stderr) {
        t.ok(!error, 'restarted vmadmd');
        if (!error) {
            // wait 20s just to give it lots of time to run through upgrade.
            setTimeout(function () {
                t.ok(true, 'waited 20s for vmadmd');
                t.end();
            }, 20000);
        } else {
            aborted = true;
            t.end();
        }
    });
}

test('upgrade smartos VM', upgrade_zone);

test ('check smartos VM properties after upgrade', function(t) {
    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }

    VM.load(vmobj.uuid, {}, function (err, newobj) {
        t.ok(!err, 'reloaded VM after upgrade: ' + JSON.stringify(newobj));

        if (err) {
            t.end();
            return;
        }

        console.log(vmobj.zfs_filesystem);
        zfs(['get', '-pHo', 'value', 'creation', vmobj.zfs_filesystem], function (err, fds) {
            var create_timestamp;
            var expected_create_timestamp;

            if (err) {
                t.ok(false, 'zfs checking datasets error: ' + err.message);
                t.end();
                return;
            }
            create_timestamp = trim(fds.stdout);
            expected_create_timestamp = (new Date(create_timestamp * 1000)).toISOString();

            t.ok(newobj.create_timestamp === expected_create_timestamp, 'create_timestamp expected: ' + expected_create_timestamp + ', actual: ' + newobj.create_timestamp);
            t.ok(newobj.max_swap === 256, 'max_swap expected: 256, actual: ' + newobj.max_swap);
            t.ok(newobj.image_uuid === image_uuid, 'image_uuid expected: ' + image_uuid + ', actual: ' + newobj.image_uuid);
            t.ok(newobj.v === 1, 'v expected: 1, actual: ' + newobj.v);
            t.ok(newobj.nics[0].primary === true, 'nics[0].primary expected: true, actual: ' + newobj.nics[0].primary);
            t.ok(!newobj.hasOwnProperty('default_gateway'), 'default_gateway expected: undefined, actual: ' + newobj.default_gateway);

            t.end();
        });
    });
});

test ('check cores on smartos VM after upgrade', function(t) {
    var args;
    var datasets = [];
    var new_cores;
    var old_cores;

    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }

    old_cores = vmobj.zfs_filesystem + '/cores';
    new_cores = vmobj.zpool + '/cores/' + vmobj.zonename;

    // determine which cores dataset(s) we have
    args = [
        'list', '-H',
        '-t', 'filesystem',
        '-o', 'name',
        old_cores,
        new_cores
    ];
    datasets = [];

    zfs(args, function (err, fds) {
        if (err && ! err.message.match(/ dataset does not exist/)) {
            t.ok(false, 'zfs checking datasets error: ' + err.message);
            return;
        }
        datasets = trim(fds.stdout).split(/\n/);
        t.ok(true, 'found datasets: ' + JSON.stringify(datasets));

        t.ok((datasets.indexOf(old_cores) === -1), 'old cores dataset does not exist');
        t.ok((datasets.indexOf(new_cores) !== -1), 'new cores dataset exists');

        if (datasets.indexOf(new_cores) !== -1) {
            zfs(['get', '-Hpo', 'value', 'quota', new_cores], function (err, fds) {
                if (err) {
                    t.ok(false, 'error getting cores quota: ' + err.message);
                    t.end();
                    return;
                }

                t.ok(Number(trim(fds.stdout)) === (100 * 1024 * 1024 * 1024),
                   'cores quota [100G,' + Number(trim(fds.stdout)) / (1024 * 1024 * 1024) + 'G]');
                t.end();
            });
        } else {
            t.end();
        }
    });
});

test('time machine for smartos VM part 2', function(t) {

    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }

    async.series([
        function (cb) {
            // remove vm-version to simulate old zone
            zonecfg(['-z', vmobj.zonename, 'remove attr name=vm-version;'], function (err, fds) {
                t.ok(!err, 'removed vm-version: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            zonecfg(['-z', vmobj.zonename, 'select net physical=net0; remove property (name=primary,value="true"); end'], function (err, fds) {
                t.ok(!err, 'removed net0.primary: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // set primary to '1', upgrade should change to true
            zonecfg(['-z', vmobj.zonename, 'select net physical=net0; add property (name=primary,value="1"); end'], function (err, fds) {
                t.ok(!err, 'removed net0.primary: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            VM.update(vmobj.uuid, {set_customer_metadata: {root_pw: 'rootPassword', admin_pw: 'adminPassword'}}, function (err) {
                t.ok(!err, 'added root_pw and admin_pw to customer_metadata');
                cb(err);
            });
        }
    ], function (err) {
        if (err) {
            t.ok(false, 'failed, leaving ' + vmobj.uuid + ' for investigation');
            aborted = true;
            t.end();
            return;
        }

        t.end();
    });
});

test('upgrade smartos VM again', upgrade_zone);

test('check the smartos VM again after upgrade #2', function (t) {

    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }

    async.series([
        function (cb) {
            VM.load(vmobj.uuid, {}, function (err, o) {
                t.ok(!err, 'reloaded VM after upgrade: ' + JSON.stringify(o));
                if (!err) {
                    t.ok(Object.keys(o.customer_metadata).length === 0, 'no customer_metadata keys');
                    t.ok(Object.keys(o.internal_metadata).length === 2, 'internal_metadata has 2 keys');
                    t.ok((o.internal_metadata['root_pw'] === 'rootPassword'), 'root_pw: ' + o.internal_metadata['root_pw']);
                    t.ok((o.internal_metadata['admin_pw'] === 'adminPassword'), 'admin_pw: ' + o.internal_metadata['admin_pw']);
                }
                cb(err);
            });
        }, function (cb) {
            zonecfg(['-z', vmobj.zonename, 'info net physical=net0'], function (err, fds) {
                var matches;

                t.ok(!err, 'loaded info for net0');
                if (!err) {
                    matches = fds.stdout.match(/property: \(name=primary,value=\"(.*)\"/);
                    t.ok(matches, 'found primary');
                    if (matches) {
                        t.ok(matches[1] === 'true', 'primary flag was: ' + matches[1] + ' expected: true');
                    }
                }
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});

test('delete smartos VM', function(t) {
    if (aborted) {
        t.ok(false, 'Test run is aborted, leaving zone for investigation');
        t.end();
        return;
    }

    if (vmobj.uuid) {
        VM.delete(vmobj.uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
            } else {
                t.ok(true, 'deleted VM: ' + vmobj.uuid);
            }
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

test('create kvm VM', function(t) {
    VM.create(kvm_payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            aborted = true;
            t.end();
        } else {
            aborted = false;
            VM.load(obj.uuid, {}, function (err, o) {
                t.ok(!err, 'loaded VM after create');
                if (!err) {
                    vmobj = o;
                } else {
                    aborted = true;
                }
                t.end();
            });
        }
    });
});

test('kvm VM time machine', function(t) {

    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }

    async.series([
        function (cb) {
            // remove vm-version to simulate old zone
            zonecfg(['-z', vmobj.zonename, 'remove attr name=vm-version;'], function (err, fds) {
                t.ok(!err, 'removed vm-version: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            // remove create-timestamp to simulate old zone
            zonecfg(['-z', vmobj.zonename, 'remove attr name=create-timestamp;'], function (err, fds) {
                t.ok(!err, 'removed create-timestamp: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            zfs(['set', 'refreservation=none', vmobj.disks[0].zfs_filesystem], function (err, fds) {
                t.ok(!err, 'removed refreservation on disks[0]: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            zfs(['set', 'refreservation=none', vmobj.disks[1].zfs_filesystem], function (err, fds) {
                t.ok(!err, 'removed refreservation on disks[1]: ' + JSON.stringify(fds));
                cb();
            });
        }, function (cb) {
            zfs(['set', 'quota=100G', vmobj.zfs_filesystem], function (err, fds) {
                t.ok(!err, 'set 100G quota on zoneroot: ' + JSON.stringify(fds));
                cb();
            });
        }
    ], function (err) {
        if (err) {
            t.ok(false, 'failed, leaving ' + vmobj.uuid + ' for investigation');
            aborted = true;
            t.end();
            return;
        }

        t.end();
    });
});

test('upgrade kvm VM', upgrade_zone);

test ('check kvm VM properties after upgrade', function(t) {
    if (aborted) {
        t.ok(false, 'Test run is aborted');
        t.end();
        return;
    }

    VM.load(vmobj.uuid, {}, function (err, newobj) {
        var disk_idx;

        t.ok(!err, 'reloaded VM after upgrade: ' + JSON.stringify(newobj));

        if (err) {
            t.end();
            return;
        }

        console.log(vmobj.zfs_filesystem);
        zfs(['get', '-pHo', 'value', 'creation', vmobj.zfs_filesystem], function (err, fds) {
            var create_timestamp;
            var expected_create_timestamp;

            if (err && ! err.message.match(/ dataset does not exist/)) {
                t.ok(false, 'zfs checking datasets error: ' + err.message);
                return;
            }
            create_timestamp = trim(fds.stdout);
            expected_create_timestamp = (new Date(create_timestamp * 1000)).toISOString();

            t.ok(newobj.create_timestamp === expected_create_timestamp, 'create_timestamp expected: ' + expected_create_timestamp + ', actual: ' + newobj.create_timestamp);
            t.ok(newobj.quota === 10, 'quota expected: 10, actual: ' + newobj.quota);
            t.ok(newobj.v === 1, 'v expected: 1, actual: ' + newobj.v);
            t.ok(Array.isArray(vmobj.disks), 'vmobj.disks is array');
            t.ok(vmobj.disks.length === 2, 'vmobj has 2 disks: ' + vmobj.disks.length);

            // check that refreservation is set to size for first disk.
            disk_idx = 0;
            async.eachSeries(vmobj.disks, function (d, cb) {
                var refreserv;

                zfs(['get', '-Hpo', 'value', 'refreservation', d.zfs_filesystem], function (err, fds) {
                    t.ok(!err, 'got refreservation for ' + d.zfs_filesystem);
                    if (!err) {
                        refreserv = Number(trim(fds.stdout)) / (1024 * 1024);
                        if (disk_idx === 0) {
                            t.ok(refreserv === d.size, 'refreserv is: ' + refreserv + ' expected: ' + d.size);
                        } else {
                            t.ok(refreserv === 0, 'refreserv is: ' + refreserv + ' expected: 0');
                        }
                    }
                    disk_idx++;
                    cb();
                });
            }, function (err) {
                t.end();
            });
        });
    });

});

test('delete kvm VM', function(t) {
    if (aborted) {
        t.ok(false, 'Test run is aborted, leaving zone for investigation');
        t.end();
        return;
    }

    if (vmobj.uuid) {
        VM.delete(vmobj.uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
            } else {
                t.ok(true, 'deleted VM: ' + vmobj.uuid);
            }
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});
