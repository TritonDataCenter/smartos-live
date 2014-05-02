// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that create works with specific options set.
//

var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

// This tests both that the txtimer + txburst can be set, but also a payload
// typical of one that might be used for installing a new OS. Two cdrom devices
// and a blank zvol. We don't boot it because the ISOs don't exist.
// With the passed-in UUID we also test for smartos-live#112
var payload = {
    autoboot: false,
    brand: 'kvm',
    uuid: '3f5592c4-edb1-11e1-a15f-e72adbb11c67',
    do_not_inventory: true,
    virtio_txtimer: 123000,
    virtio_txburst: 123,
    boot: 'order=cd,once=d',
    disks: [
        {
            size: 2048,
            model: 'virtio'
        },
        {
            media: 'cdrom',
            path: '/foo.iso',
            model: 'ide'
        },
        {
            media: 'cdrom',
            path: '/bar.iso',
            model: 'ide'
        }
    ]
};

var payload_with_tags = {
    autoboot: false,
    brand: 'kvm',
    alias: 'autotest-' + process.pid,
    do_not_inventory: true,
    tags: {
       hello: 'world'
    },
    disks: [
        {
            size: 2048,
            model: 'virtio'
        },
    ],
    nics: [
        {
            nic_tag: 'admin',
            ip: 'dhcp',
            model: 'virtio'
        }
    ]
};

var payload_with_too_many_resolvers = {
    autoboot: true,
    brand: 'kvm',
    alias: 'autotest-' + process.pid,
    do_not_inventory: true,
    resolvers: [
        '0.0.0.1',
        '0.0.0.2',
        '0.0.0.3',
        '0.0.0.4',
        '0.0.0.5'
    ],
    disks: [
        {
            size: 2048,
            model: 'virtio'
        },
    ],
    nics: [
        {
            gateway: '10.254.10.1',
            ip: '10.254.10.2',
            netmask: '255.255.255.0',
            nic_tag: 'admin',
            model: 'virtio'
        }
    ]
};

test('test create with bad image_size', function(t) {

    p = {
        brand: 'kvm',
        vcpus: 1,
        ram: 256,
        alias: 'autotest-' + process.pid,
        do_not_inventory: true,
        autoboot: false,
        disks: [
          {
            boot: true,
            model: 'virtio',
            image_uuid: vmtest.CURRENT_UBUNTU_UUID,
            image_size: 31337
          }
        ]
    };
    state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, null, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create with missing image_size', function(t) {

    p = {
        brand: 'kvm',
        vcpus: 1,
        ram: 256,
        alias: 'autotest-' + process.pid,
        do_not_inventory: true,
        autoboot: false,
        disks: [
          {
            boot: true,
            model: 'virtio',
            image_uuid: vmtest.CURRENT_UBUNTU_UUID
          }
        ]
    };
    state = {brand: p.brand};

    vmtest.on_new_vm(t, null, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create with virtio_tx*', function(t) {
    state = {brand: 'kvm'};
    vmtest.on_new_vm(t, null, payload, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var disks;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(obj.virtio_txtimer === payload.virtio_txtimer,
                    'set correct virtio_txtimer');
                t.ok(obj.virtio_txburst === payload.virtio_txburst,
                    'set correct virtio_txburst');
                disks = obj.disks;
                t.ok(disks.length === 3, 'VM has 3 disks');
                t.ok(disks[0].media === 'disk', 'first disk has media type \'disk\'');
                t.ok(disks[1].media === 'cdrom', 'second disk has media type \'cdrom\'');
                t.ok(disks[1].path === '/foo.iso', 'second disk has correct path ['
                    + disks[1].path + ',' + '/foo.iso]');
                t.ok(disks[2].media === 'cdrom', 'third disk has media type \'cdrom\'');
                t.ok(disks[2].path === '/bar.iso', 'third disk has correct path ['
                    + disks[2].path + ',' + '/bar.iso]');
                state.vmobj = obj;
                cb();
            });
        }
    ]);
});

test('test normalish refreservation', function(t) {
    p = {
        brand: 'kvm',
        vcpus: 1,
        ram: 256,
        alias: 'autotest-' + process.pid,
        do_not_inventory: true,
        autoboot: false,
        disk_driver: 'virtio',
        disks: [
          {
            boot: true,
            image_uuid: vmtest.CURRENT_UBUNTU_UUID,
            image_size: vmtest.CURRENT_UBUNTU_SIZE,
            refreservation: vmtest.CURRENT_UBUNTU_SIZE
          }, {
            size: 1024,
            refreservation: 10
          }
        ]
    };
    state = {brand: p.brand};
    vmtest.on_new_vm(t, null, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var disks;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                disks = obj.disks;
                t.ok(disks.length === 2, 'VM has 2 disks');
                t.ok(disks[0].refreservation === disks[0].image_size, 'disk 0 has correct refreservation: ' + disks[0].refreservation + '/' + disks[0].image_size);
                t.ok(disks[1].refreservation === 10, 'disk 1 has correct refreservation: ' + disks[1].refreservation + '/10');
                state.vmobj = obj;
                cb();
            });
        }
    ]);
});

test('test 0 refreservation', function(t) {
    p = {
        brand: 'kvm',
        vcpus: 1,
        ram: 256,
        alias: 'autotest-' + process.pid,
        do_not_inventory: true,
        autoboot: false,
        disk_driver: 'virtio',
        disks: [
          {
            boot: true,
            image_uuid: vmtest.CURRENT_UBUNTU_UUID,
            image_size: vmtest.CURRENT_UBUNTU_SIZE,
            refreservation: 0
          }, {
            size: 1024,
            refreservation: 0
          }
        ]
    };
    state = {brand: p.brand};
    vmtest.on_new_vm(t, null, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var disks;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                disks = obj.disks;
                t.ok(disks.length === 2, 'VM has 2 disks');
                t.ok(disks[0].refreservation === 0, 'disk 0 has correct refreservation: ' + disks[0].refreservation + '/0');
                t.ok(disks[1].refreservation === 0, 'disk 1 has correct refreservation: ' + disks[1].refreservation + '/0');
                state.vmobj = obj;
                cb();
            });
        }
    ]);
});

test('test default refreservation', function(t) {
    p = {
        brand: 'kvm',
        vcpus: 1,
        ram: 256,
        alias: 'autotest-' + process.pid,
        do_not_inventory: true,
        autoboot: false,
        disk_driver: 'virtio',
        disks: [
          {
            boot: true,
            image_uuid: vmtest.CURRENT_UBUNTU_UUID,
            image_size: vmtest.CURRENT_UBUNTU_SIZE
          }, {
            size: 1024
          }
        ]
    };
    state = {brand: p.brand};
    vmtest.on_new_vm(t, null, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var disks;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                disks = obj.disks;
                t.ok(disks.length === 2, 'VM has 2 disks');
                t.ok(disks[0].refreservation === disks[0].size, 'disk 0 has correct refreservation: ' + disks[0].refreservation + '/' + disks[0].size);
                t.ok(disks[1].refreservation === disks[1].size, 'disk 1 has correct refreservation: ' + disks[1].refreservation + '/' + disks[1].size);
                state.vmobj = obj;
                cb();
            });
        }
    ]);
});


test('test create with tags', function(t) {

    var p = JSON.parse(JSON.stringify(payload_with_tags));
    var state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
            function (cb) {
                VM.load(state.uuid, {fields: ['tags']}, function (err, obj) {
                    t.ok(!err, 'reloaded VM after create: ' + (err ? err.message : 'no error'));
                    if (err) {
                        cb(err);
                        return;
                    }
                    t.ok((obj.tags.hello === 'world'), 'tags: ' + JSON.stringify(obj.tags));
                    cb();
                });
            }
        ], function (err) {
            t.end();
        }
    );
});

test('test create with too many resolvers', function(t) {

    var p = JSON.parse(JSON.stringify(payload_with_too_many_resolvers));
    var state = {brand: p.brand};
    var startvm = '';

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
            function (cb) {
                VM.stop(state.uuid, {force: true}, function (err, obj) {
                    t.ok(!err, 'stopped VM after create: ' + (err ? err.message : 'no error'));
                    cb();
                });
            }, function (cb) {
                var filename = '/zones/' + state.uuid + '/root/startvm';
                fs.readFile(filename, 'utf8', function (err, data) {
                    if (!err) {
                        t.ok(true, 'got startvm data: ' + data.toString().length
                            + ' bytes');
                        startvm = data.toString();
                    } else {
                        t.ok(false, 'failed to get startvm data: ' + err.message);
                    }
                    cb(err);
                });
            }, function (cb) {
                var match = startvm.match(/vnic,name=net0,.*(dns_ip0=[^"]*)\"/);
                t.ok(match, 'found dns entries: ' + !!match);
                if (match) {
                    t.equal(match[1], 'dns_ip0=0.0.0.1,dns_ip1=0.0.0.2,dns_ip2=0.0.0.3,dns_ip3=0.0.0.4', 'match is as expected: ' + match[1]);
                }
                cb();
            }
        ], function (err) {
            t.end();
        }
    );
});

