/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * Unit tests for the cloudinit nocloud module.
 */

var child_process = require('child_process');
var fs = require('fs');
var exec = child_process.exec;

var nocloud = require('/usr/vm/node_modules/cloudinit/nocloud');
var lofs = require('/usr/vm/node_modules/cloudinit/lofs-fat16');

/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

// Simple mock logger for createPCFS tests
var mockLog = {
    info: function () {},
    error: function () {},
    debug: function () {},
    warn: function () {},
    trace: function () {}
};

test('_metaDataConfig generates meta-data with hostname', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        hostname: 'test-vm'
    };
    var result = nocloud._metaDataConfig(payload);

    t.ok(result, '_metaDataConfig returns a result');
    t.ok(typeof result === 'string', 'result is a string');
    t.ok(result.indexOf('# cloud-init meta-data') !== -1, 'contains header');
    t.ok(result.indexOf('instance-id: b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c')
        !== -1, 'contains instance-id');
    t.ok(result.indexOf('local-hostname: test-vm') !== -1,
        'contains local-hostname from hostname');
    t.end();
});

test('_metaDataConfig falls back to alias then uuid for hostname', function (t) {
    var payloadAlias = {
        uuid: 'aaaa-bbbb-cccc',
        alias: 'my-alias'
    };
    var payloadUuid = {
        uuid: 'dddd-eeee-ffff'
    };

    var resultAlias = nocloud._metaDataConfig(payloadAlias);
    t.ok(resultAlias.indexOf('local-hostname: my-alias') !== -1,
        'uses alias when hostname not set');

    var resultUuid = nocloud._metaDataConfig(payloadUuid);
    t.ok(resultUuid.indexOf('local-hostname: dddd-eeee-ffff') !== -1,
        'uses uuid when hostname and alias not set');
    t.end();
});

test('_userDataConfig returns default cloud-config when none provided',
    function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c'
    };
    var result = nocloud._userDataConfig(payload);

    t.ok(result, '_userDataConfig returns a result');
    t.equal(result, '#cloud-config\n{}\n', 'returns minimal cloud-config');
    t.end();
});

test('_userDataConfig returns customer-provided user-data', function (t) {
    var customUserData = '#cloud-config\npackages:\n  - nginx\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        customer_metadata: {
            'cloud-init:user-data': customUserData
        }
    };
    var result = nocloud._userDataConfig(payload);

    t.equal(result, customUserData, 'returns customer-provided user-data');
    t.end();
});

test('_userDataConfig prefers set_customer_metadata over customer_metadata',
    function (t) {
    var setData = '#cloud-config\nruncmd:\n  - echo set\n';
    var oldData = '#cloud-config\nruncmd:\n  - echo old\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        set_customer_metadata: {
            'cloud-init:user-data': setData
        },
        customer_metadata: {
            'cloud-init:user-data': oldData
        }
    };
    var result = nocloud._userDataConfig(payload);

    t.equal(result, setData, 'prefers set_customer_metadata');
    t.end();
});

test('_networkConfig generates valid YAML for static NIC', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        hostname: 'test-vm',
        resolvers: ['8.8.8.8', '8.8.4.4'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['192.168.1.100/24'],
                gateways: ['192.168.1.1'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result, '_networkConfig returns a result');
    t.ok(typeof result === 'string', 'result is a string');

    // Check version header
    t.ok(result.indexOf('version: 2') !== -1, 'contains version: 2');
    t.ok(result.indexOf('ethernets:') !== -1, 'contains ethernets section');

    // Check interface configuration
    t.ok(result.indexOf('eth0:') !== -1, 'contains eth0 interface');
    t.ok(result.indexOf('macaddress: "02:08:20:ac:e1:00"') !== -1,
        'contains MAC address (lowercase)');
    t.ok(result.indexOf('set-name: eth0') !== -1, 'contains set-name');

    // Check IP addressing
    t.ok(result.indexOf('addresses:') !== -1, 'contains addresses section');
    t.ok(result.indexOf('- 192.168.1.100/24') !== -1, 'contains static IP');

    // Check gateway
    t.ok(result.indexOf('gateway4: 192.168.1.1') !== -1, 'contains IPv4 gateway');

    // Check nameservers (should be on primary NIC)
    t.ok(result.indexOf('nameservers:') !== -1, 'contains nameservers section');
    t.ok(result.indexOf('- 8.8.8.8') !== -1, 'contains first resolver');
    t.ok(result.indexOf('- 8.8.4.4') !== -1, 'contains second resolver');

    t.end();
});

test('_networkConfig returns undefined when no NICs present', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: []
    };
    var result = nocloud._networkConfig(payload);
    t.equal(result, undefined, 'returns undefined for empty add_nics');

    var payloadNoKey = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c'
    };
    var result2 = nocloud._networkConfig(payloadNoKey);
    t.equal(result2, undefined, 'returns undefined when add_nics missing');
    t.end();
});

test('_networkConfig handles DHCP NIC', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['dhcp'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('dhcp4: true') !== -1, 'contains dhcp4: true');
    // DHCP NIC should not have addresses section
    t.equal(result.indexOf('addresses:'), -1,
        'no addresses section for DHCP-only NIC');
    t.end();
});

test('_networkConfig handles addrconf (IPv6 SLAAC)', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['addrconf'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('dhcp6: true') !== -1, 'contains dhcp6: true');
    t.equal(result.indexOf('addresses:'), -1,
        'no addresses section for addrconf-only NIC');
    t.end();
});

test('_networkConfig handles mixed DHCP and static IPs', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['dhcp', 'addrconf', '10.0.0.5/24',
                    'fd00::5/64'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('dhcp4: true') !== -1, 'contains dhcp4');
    t.ok(result.indexOf('dhcp6: true') !== -1, 'contains dhcp6');
    t.ok(result.indexOf('- 10.0.0.5/24') !== -1, 'contains static IPv4');
    t.ok(result.indexOf('- fd00::5/64') !== -1, 'contains static IPv6');
    t.end();
});

test('_networkConfig handles legacy ip and netmask fields', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ip: '192.168.1.50',
                netmask: '255.255.255.0',
                gateway: '192.168.1.1',
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('- 192.168.1.50/24') !== -1,
        'converts ip + netmask to CIDR notation');
    t.end();
});

test('_networkConfig handles IPv6 gateway', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['2001:db8::10/64'],
                gateways: ['2001:db8::1'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('gateway6: 2001:db8::1') !== -1,
        'contains IPv6 gateway');
    // Should not have gateway4
    t.equal(result.indexOf('gateway4:'), -1,
        'no IPv4 gateway for IPv6-only NIC');
    t.end();
});

test('_networkConfig handles mixed IPv4 and IPv6 gateways', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24', '2001:db8::10/64'],
                gateways: ['10.0.0.1', '2001:db8::1'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('gateway4: 10.0.0.1') !== -1,
        'contains IPv4 gateway');
    t.ok(result.indexOf('gateway6: 2001:db8::1') !== -1,
        'contains IPv6 gateway');
    t.end();
});

test('_networkConfig handles legacy single gateway field', function (t) {
    // IPv4 legacy gateway
    var payload4 = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateway: '10.0.0.1',
                primary: true
            }
        ]
    };
    var result4 = nocloud._networkConfig(payload4);
    t.ok(result4.indexOf('gateway4: 10.0.0.1') !== -1,
        'legacy gateway field produces gateway4');

    // IPv6 legacy gateway
    var payload6 = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['2001:db8::10/64'],
                gateway: '2001:db8::1',
                primary: true
            }
        ]
    };
    var result6 = nocloud._networkConfig(payload6);
    t.ok(result6.indexOf('gateway6: 2001:db8::1') !== -1,
        'legacy IPv6 gateway field produces gateway6');
    t.end();
});

test('_networkConfig generates multi-NIC configuration', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth1',
                mac: '02:08:20:AC:E1:01',
                ips: ['172.16.0.10/16']
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    // Both interfaces should appear
    t.ok(result.indexOf('eth0:') !== -1, 'contains eth0');
    t.ok(result.indexOf('eth1:') !== -1, 'contains eth1');

    // Both MACs should appear
    t.ok(result.indexOf('macaddress: "02:08:20:ac:e1:00"') !== -1,
        'contains eth0 MAC');
    t.ok(result.indexOf('macaddress: "02:08:20:ac:e1:01"') !== -1,
        'contains eth1 MAC');

    // Both IPs should appear
    t.ok(result.indexOf('- 10.0.0.10/24') !== -1, 'contains eth0 IP');
    t.ok(result.indexOf('- 172.16.0.10/16') !== -1, 'contains eth1 IP');

    t.end();
});

test('_networkConfig only places gateway on primary NIC', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth1',
                mac: '02:08:20:AC:E1:01',
                ips: ['172.16.0.10/16'],
                gateways: ['172.16.0.1']
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    /*
     * Split the output into per-interface blocks and verify gateway4 only
     * appears in the eth0 block, not the eth1 block. Having gateway4 on
     * multiple interfaces creates conflicting default routes, causing
     * "file exists" errors when the OS tries to add a second default route.
     */
    var eth1Pos = result.indexOf('  eth1:');
    var beforeEth1 = result.substring(0, eth1Pos);
    var afterEth1 = result.substring(eth1Pos);

    t.ok(beforeEth1.indexOf('gateway4: 10.0.0.1') !== -1,
        'gateway4 appears in eth0 (primary) section');
    t.equal(afterEth1.indexOf('gateway4:'), -1,
        'gateway4 does not appear in eth1 (non-primary) section');
    t.end();
});

test('_networkConfig only places nameservers on primary NIC', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        resolvers: ['8.8.8.8', '8.8.4.4'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth1',
                mac: '02:08:20:AC:E1:01',
                ips: ['172.16.0.10/16']
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    /*
     * Split the output into per-interface blocks and verify nameservers
     * only appear in the eth0 block, not the eth1 block.
     */
    var eth1Pos = result.indexOf('  eth1:');
    var beforeEth1 = result.substring(0, eth1Pos);
    var afterEth1 = result.substring(eth1Pos);

    t.ok(beforeEth1.indexOf('nameservers:') !== -1,
        'nameservers appear in eth0 (primary) section');
    t.equal(afterEth1.indexOf('nameservers:'), -1,
        'nameservers do not appear in eth1 (non-primary) section');
    t.end();
});

test('_networkConfig omits nameservers when resolvers empty', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        resolvers: [],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.equal(result.indexOf('nameservers:'), -1,
        'no nameservers when resolvers list is empty');
    t.end();
});

test('_networkConfig omits nameservers when resolvers absent', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.equal(result.indexOf('nameservers:'), -1,
        'no nameservers section when resolvers key missing');
    t.end();
});

test('_networkConfig uses customer-provided network-config override',
    function (t) {
    var customNetConfig = 'version: 2\nethernets:\n  enp0s3:\n'
        + '    dhcp4: true\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        customer_metadata: {
            'cloud-init:network-config': customNetConfig
        },
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.equal(result, customNetConfig,
        'returns customer-provided network-config verbatim');
    t.end();
});

test('_networkConfig prefers set_customer_metadata for override', function (t) {
    var setConfig = 'version: 2\nethernets:\n  enp0s3:\n    dhcp4: true\n';
    var oldConfig = 'version: 2\nethernets:\n  enp0s3:\n    dhcp6: true\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        set_customer_metadata: {
            'cloud-init:network-config': setConfig
        },
        customer_metadata: {
            'cloud-init:network-config': oldConfig
        },
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.equal(result, setConfig,
        'set_customer_metadata takes precedence for network-config');
    t.end();
});

test('_networkConfig handles NIC without MAC address', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                ips: ['10.0.0.10/24']
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('eth0:') !== -1, 'interface name is present');
    t.equal(result.indexOf('match:'), -1,
        'no match section when no MAC');
    t.equal(result.indexOf('set-name:'), -1,
        'no set-name when no MAC');
    t.end();
});

test('_networkConfig handles NIC with multiple static IPs', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24', '10.0.0.11/24',
                    '2001:db8::10/64'],
                primary: true
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('- 10.0.0.10/24') !== -1, 'first IPv4 address');
    t.ok(result.indexOf('- 10.0.0.11/24') !== -1, 'second IPv4 address');
    t.ok(result.indexOf('- 2001:db8::10/64') !== -1, 'IPv6 address');
    t.end();
});

test('_networkConfig defaults interface name to eth0', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24']
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('  eth0:') !== -1,
        'defaults to eth0 when interface not specified');
    t.ok(result.indexOf('set-name: eth0') !== -1,
        'set-name defaults to eth0');
    t.end();
});

test('_networkConfig output ends with a newline', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24']
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.charAt(result.length - 1) === '\n',
        'output ends with newline');
    t.end();
});

test('_vendorDataConfig returns customer-provided vendor-data', function (t) {
    var customVendor = '#cloud-config\nruncmd:\n  - echo hello\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        internal_metadata: {
            'cloud-init:vendor-data': customVendor
        }
    };
    var result = nocloud._vendorDataConfig(payload);

    t.equal(result, customVendor, 'returns customer-provided vendor-data');
    t.end();
});

test('_vendorDataConfig returns undefined when none provided', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c'
    };
    var result = nocloud._vendorDataConfig(payload);

    t.equal(result, undefined,
        'returns undefined when no vendor-data in metadata');
    t.end();
});

test('_vendorDataConfig ignores customer_metadata vendor-data', function (t) {
    var customVendor = '#cloud-config\nruncmd:\n  - echo hello\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        customer_metadata: {
            'cloud-init:vendor-data': customVendor
        }
    };
    var result = nocloud._vendorDataConfig(payload);

    t.equal(result, undefined,
        'vendor-data in customer_metadata is not used');
    t.end();
});

test('_vendorDataConfig prefers set_internal_metadata', function (t) {
    var setVendor = '#cloud-config\nruncmd:\n  - echo set\n';
    var oldVendor = '#cloud-config\nruncmd:\n  - echo old\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        set_internal_metadata: {
            'cloud-init:vendor-data': setVendor
        },
        internal_metadata: {
            'cloud-init:vendor-data': oldVendor
        }
    };
    var result = nocloud._vendorDataConfig(payload);

    t.equal(result, setVendor,
        'prefers set_internal_metadata for vendor-data');
    t.end();
});

/*
 * updatePayloadDisks tests
 */

test('updatePayloadDisks pushes correct disk entry', function (t) {
    var payload = {
        add_disks: [],
        quota: 10
    };
    nocloud.updatePayloadDisks(mockLog, payload);

    t.equal(payload.add_disks.length, 1, 'one disk added');
    var disk = payload.add_disks[0];
    t.equal(disk.size, lofs.DISK_SIZE_MIB, 'size matches DISK_SIZE_MIB');
    t.equal(disk.model, 'virtio', 'model is virtio');
    t.equal(disk.boot, false, 'boot is false');
    t.equal(disk.media, 'disk', 'media is disk');
    t.equal(disk.block_size, lofs.BLOCK_SIZE, 'block_size matches');
    t.equal(disk.cloudinit_datasource, 'nocloud',
        'cloudinit_datasource is nocloud');
    t.end();
});

test('updatePayloadDisks adjusts flexible_disk_size when present',
    function (t) {
    var payload = {
        add_disks: [],
        flexible_disk_size: 100
    };
    nocloud.updatePayloadDisks(mockLog, payload);

    t.equal(payload.flexible_disk_size, 100 + lofs.DISK_SIZE_MIB,
        'flexible_disk_size increased by DISK_SIZE_MIB');
    t.end();
});

test('updatePayloadDisks adjusts quota when flexible_disk_size absent '
    + 'and quota insufficient', function (t) {
    var payload = {
        add_disks: [],
        quota: 0
    };
    nocloud.updatePayloadDisks(mockLog, payload);

    var expectedGiB = Math.ceil(lofs.DISK_SIZE_MIB / 1024);
    t.equal(payload.quota, expectedGiB,
        'quota increased by ceil(DISK_SIZE_MIB/1024)');
    t.end();
});

test('updatePayloadDisks leaves quota alone when already sufficient',
    function (t) {
    var payload = {
        add_disks: [],
        quota: 100
    };
    nocloud.updatePayloadDisks(mockLog, payload);

    t.equal(payload.quota, 100, 'quota unchanged');
    t.end();
});

test('updatePayloadDisks prefers flexible_disk_size over quota', function (t) {
    var payload = {
        add_disks: [],
        flexible_disk_size: 50,
        quota: 0
    };
    nocloud.updatePayloadDisks(mockLog, payload);

    t.equal(payload.flexible_disk_size, 50 + lofs.DISK_SIZE_MIB,
        'flexible_disk_size adjusted');
    t.equal(payload.quota, 0, 'quota not touched when flexible_disk_size set');
    t.end();
});

/*
 * validateNoCloudDisk tests
 */

test('validateNoCloudDisk returns true for matching disk', function (t) {
    var disks = [{
        path: '/dev/zvol/rdsk/zones/abc-def/disk1',
        size: lofs.DISK_SIZE_MIB,
        block_size: lofs.BLOCK_SIZE,
        boot: false
    }];
    t.equal(nocloud.validateNoCloudDisk(disks,
        '/dev/zvol/rdsk/zones/abc-def/disk1'), true,
        'returns true for matching disk');
    t.end();
});

test('validateNoCloudDisk returns false for wrong path', function (t) {
    var disks = [{
        path: '/dev/zvol/rdsk/zones/abc-def/disk1',
        size: lofs.DISK_SIZE_MIB,
        block_size: lofs.BLOCK_SIZE,
        boot: false
    }];
    t.equal(nocloud.validateNoCloudDisk(disks,
        '/dev/zvol/rdsk/zones/abc-def/disk2'), false,
        'returns false for wrong path');
    t.end();
});

test('validateNoCloudDisk returns false for wrong size', function (t) {
    var disks = [{
        path: '/dev/zvol/rdsk/zones/abc-def/disk1',
        size: 999,
        block_size: lofs.BLOCK_SIZE,
        boot: false
    }];
    t.equal(nocloud.validateNoCloudDisk(disks,
        '/dev/zvol/rdsk/zones/abc-def/disk1'), false,
        'returns false for wrong size');
    t.end();
});

test('validateNoCloudDisk returns false for wrong block_size', function (t) {
    var disks = [{
        path: '/dev/zvol/rdsk/zones/abc-def/disk1',
        size: lofs.DISK_SIZE_MIB,
        block_size: 4096,
        boot: false
    }];
    t.equal(nocloud.validateNoCloudDisk(disks,
        '/dev/zvol/rdsk/zones/abc-def/disk1'), false,
        'returns false for wrong block_size');
    t.end();
});

test('validateNoCloudDisk returns false when boot is true', function (t) {
    var disks = [{
        path: '/dev/zvol/rdsk/zones/abc-def/disk1',
        size: lofs.DISK_SIZE_MIB,
        block_size: lofs.BLOCK_SIZE,
        boot: true
    }];
    t.equal(nocloud.validateNoCloudDisk(disks,
        '/dev/zvol/rdsk/zones/abc-def/disk1'), false,
        'returns false when boot is true');
    t.end();
});

test('validateNoCloudDisk returns false for empty disks array', function (t) {
    t.equal(nocloud.validateNoCloudDisk([],
        '/dev/zvol/rdsk/zones/abc-def/disk1'), false,
        'returns false for empty array');
    t.end();
});

test('validateNoCloudDisk finds correct disk among multiple disks',
    function (t) {
    var disks = [
        {
            path: '/dev/zvol/rdsk/zones/abc-def/disk0',
            size: 10240,
            block_size: 8192,
            boot: true
        },
        {
            path: '/dev/zvol/rdsk/zones/abc-def/disk1',
            size: lofs.DISK_SIZE_MIB,
            block_size: lofs.BLOCK_SIZE,
            boot: false
        },
        {
            path: '/dev/zvol/rdsk/zones/abc-def/disk2',
            size: 51200,
            block_size: 8192,
            boot: false
        }
    ];
    t.equal(nocloud.validateNoCloudDisk(disks,
        '/dev/zvol/rdsk/zones/abc-def/disk1'), true,
        'finds matching disk among multiple disks');
    t.end();
});

test('_networkConfig NIC without ips or ip fields produces no addresses',
    function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00'
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('eth0:') !== -1, 'interface is present');
    t.equal(result.indexOf('addresses:'), -1, 'no addresses section');
    t.equal(result.indexOf('dhcp4:'), -1, 'no dhcp4');
    t.equal(result.indexOf('dhcp6:'), -1, 'no dhcp6');
    t.end();
});

test('_networkConfig handles NIC with empty ips array', function (t) {
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: []
            }
        ]
    };
    var result = nocloud._networkConfig(payload);

    t.ok(result.indexOf('eth0:') !== -1, 'interface is present');
    t.equal(result.indexOf('addresses:'), -1,
        'no addresses section for empty ips');
    t.end();
});

test('_userDataConfig handles non-cloud-config user-data', function (t) {
    var script = '#!/bin/bash\necho "hello world"\n';
    var payload = {
        uuid: 'b4c7e1a2-3d5f-4e8a-9b0c-1d2e3f4a5b6c',
        customer_metadata: {
            'cloud-init:user-data': script
        }
    };
    var result = nocloud._userDataConfig(payload);

    t.equal(result, script,
        'passes through non-cloud-config user-data verbatim');
    t.end();
});

/*
 * CIDATA regeneration tests.
 *
 * These tests verify that rebuilding a synthetic payload from the VM's
 * current state (as would happen at boot time) produces the correct
 * cloud-init configuration.  The synthetic payload maps vmobj.nics to
 * add_nics and vmobj.customer_metadata to customer_metadata, which is
 * the format that _networkConfig(), _metaDataConfig(), _userDataConfig(),
 * and createPCFS() expect.
 */

test('regeneration: synthetic payload with multiple NICs', function (t) {
    var vmobj = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        alias: 'regen-alias',
        nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth1',
                mac: '02:08:20:AC:E1:01',
                ips: ['172.16.0.10/16']
            }
        ],
        resolvers: ['8.8.8.8', '1.1.1.1'],
        customer_metadata: {}
    };

    var cidataPayload = {
        uuid: vmobj.uuid,
        hostname: vmobj.hostname,
        alias: vmobj.alias,
        add_nics: vmobj.nics,
        resolvers: vmobj.resolvers,
        customer_metadata: vmobj.customer_metadata
    };

    var result = nocloud._networkConfig(cidataPayload);
    t.ok(result.indexOf('eth0:') !== -1, 'contains eth0');
    t.ok(result.indexOf('eth1:') !== -1, 'contains eth1');
    t.ok(result.indexOf('- 10.0.0.10/24') !== -1, 'eth0 IP present');
    t.ok(result.indexOf('- 172.16.0.10/16') !== -1, 'eth1 IP present');
    t.ok(result.indexOf('gateway4: 10.0.0.1') !== -1, 'gateway on primary');
    t.ok(result.indexOf('- 8.8.8.8') !== -1, 'first resolver');
    t.ok(result.indexOf('- 1.1.1.1') !== -1, 'second resolver');
    t.end();
});

test('regeneration: NIC added (2 NICs -> 3 NICs)', function (t) {
    // Initial: 2 NICs
    var initialPayload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth1',
                mac: '02:08:20:AC:E1:01',
                ips: ['172.16.0.10/16']
            }
        ]
    };

    var initialResult = nocloud._networkConfig(initialPayload);
    t.equal(initialResult.indexOf('eth2:'), -1, 'initial has no eth2');

    // After adding a 3rd NIC
    var updatedPayload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth1',
                mac: '02:08:20:AC:E1:01',
                ips: ['172.16.0.10/16']
            },
            {
                interface: 'eth2',
                mac: '02:08:20:AC:E1:02',
                ips: ['192.168.1.10/24']
            }
        ]
    };

    var updatedResult = nocloud._networkConfig(updatedPayload);
    t.ok(updatedResult.indexOf('eth0:') !== -1, 'still has eth0');
    t.ok(updatedResult.indexOf('eth1:') !== -1, 'still has eth1');
    t.ok(updatedResult.indexOf('eth2:') !== -1, 'new eth2 present');
    t.ok(updatedResult.indexOf('- 192.168.1.10/24') !== -1,
        'eth2 IP present');
    t.end();
});

test('regeneration: NIC removed (3 NICs -> 2 NICs)', function (t) {
    var payload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth2',
                mac: '02:08:20:AC:E1:02',
                ips: ['192.168.1.10/24']
            }
        ]
    };

    var result = nocloud._networkConfig(payload);
    t.ok(result.indexOf('eth0:') !== -1, 'eth0 still present');
    t.ok(result.indexOf('eth2:') !== -1, 'eth2 still present');
    t.equal(result.indexOf('eth1:'), -1, 'removed eth1 is gone');
    t.equal(result.indexOf('172.16.0.10'), -1,
        'removed NIC IP is gone');
    t.end();
});

test('regeneration: NIC IP changed', function (t) {
    var payload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            }
        ]
    };

    var initialResult = nocloud._networkConfig(payload);
    t.ok(initialResult.indexOf('- 10.0.0.10/24') !== -1,
        'initial IP present');

    // Simulate IP change
    payload.add_nics[0].ips = ['10.0.0.50/24'];
    var updatedResult = nocloud._networkConfig(payload);
    t.ok(updatedResult.indexOf('- 10.0.0.50/24') !== -1,
        'updated IP present');
    t.equal(updatedResult.indexOf('10.0.0.10'), -1,
        'old IP is gone');
    t.end();
});

test('regeneration: primary NIC changed', function (t) {
    // NIC B becomes primary instead of NIC A
    var payload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1']
            },
            {
                interface: 'eth1',
                mac: '02:08:20:AC:E1:01',
                ips: ['172.16.0.10/16'],
                gateways: ['172.16.0.1'],
                primary: true
            }
        ]
    };

    var result = nocloud._networkConfig(payload);

    // Split at eth1 to check per-interface sections
    var eth1Pos = result.indexOf('  eth1:');
    var beforeEth1 = result.substring(0, eth1Pos);
    var afterEth1 = result.substring(eth1Pos);

    t.equal(beforeEth1.indexOf('gateway4:'), -1,
        'no gateway on eth0 (non-primary)');
    t.equal(beforeEth1.indexOf('nameservers:'), -1,
        'no nameservers on eth0 (non-primary)');
    t.ok(afterEth1.indexOf('gateway4: 172.16.0.1') !== -1,
        'gateway on eth1 (new primary)');
    t.ok(afterEth1.indexOf('nameservers:') !== -1,
        'nameservers on eth1 (new primary)');
    t.end();
});

test('regeneration: resolvers changed', function (t) {
    var payload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        resolvers: ['1.1.1.1', '9.9.9.9'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            }
        ]
    };

    var result = nocloud._networkConfig(payload);
    t.ok(result.indexOf('- 1.1.1.1') !== -1, 'new resolver 1');
    t.ok(result.indexOf('- 9.9.9.9') !== -1, 'new resolver 2');
    t.equal(result.indexOf('8.8.8.8'), -1, 'old resolver gone');
    t.end();
});

test('regeneration: hostname/alias change updates meta-data', function (t) {
    var payload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'new-hostname',
        alias: 'new-alias'
    };

    var result = nocloud._metaDataConfig(payload);
    t.ok(result.indexOf('local-hostname: new-hostname') !== -1,
        'meta-data uses updated hostname');
    t.ok(result.indexOf('instance-id: aaaa-bbbb-cccc-dddd') !== -1,
        'instance-id remains stable (VM UUID)');

    // When hostname is absent, alias is used
    var payloadAliasOnly = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        alias: 'updated-alias'
    };
    var resultAlias = nocloud._metaDataConfig(payloadAliasOnly);
    t.ok(resultAlias.indexOf('local-hostname: updated-alias') !== -1,
        'meta-data falls back to updated alias');
    t.end();
});

test('regeneration: customer_metadata cloud-init overrides', function (t) {
    var customUserData = '#cloud-config\npackages:\n  - nginx\n';
    var customNetConfig = 'version: 2\nethernets:\n  enp0s3:\n'
        + '    dhcp4: true\n';

    var payload = {
        uuid: 'aaaa-bbbb-cccc-dddd',
        hostname: 'regen-test',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:08:20:AC:E1:00',
                ips: ['10.0.0.10/24'],
                primary: true
            }
        ],
        customer_metadata: {
            'cloud-init:user-data': customUserData,
            'cloud-init:network-config': customNetConfig
        }
    };

    var userData = nocloud._userDataConfig(payload);
    t.equal(userData, customUserData,
        'user-data matches customer override');

    var netConfig = nocloud._networkConfig(payload);
    t.equal(netConfig, customNetConfig,
        'network-config matches customer override');
    t.end();
});

/*
 * Integration test for CIDATA regeneration via createPCFS.
 *
 * This test creates a CIDATA image with an initial NIC config, then
 * regenerates the same image file with a different NIC config and
 * verifies the FAT16 contents reflect the updated configuration.
 *
 * This test requires SmartOS with lofiadm, mkfs, and mount privileges.
 */
test('regeneration: full FAT16 image updated with new NIC config (integration)',
    function (t) {
    var testFile = '/tmp/test-cloudinit-regen-' + process.pid + '.img';
    var mountPoint = '/tmp/test-cloudinit-regen-mnt-' + process.pid;
    var lofiDevice = null;

    var initialPayload = {
        uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        hostname: 'initial-host',
        resolvers: ['8.8.8.8'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:00:00:00:00:01',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            }
        ],
        customer_metadata: {}
    };

    var updatedPayload = {
        uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        hostname: 'updated-host',
        resolvers: ['1.1.1.1', '9.9.9.9'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:00:00:00:00:01',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            },
            {
                interface: 'eth1',
                mac: '02:00:00:00:00:02',
                ips: ['172.16.0.5/16']
            }
        ],
        customer_metadata: {}
    };

    function cleanup(cb) {
        exec('umount ' + mountPoint + ' 2>/dev/null; '
            + (lofiDevice ? 'lofiadm -d ' + lofiDevice + ' 2>/dev/null; ' : '')
            + 'rmdir ' + mountPoint + ' 2>/dev/null; '
            + 'rm -f ' + testFile,
            function () {
            cb();
        });
    }

    // Step 1: Create empty file
    exec('dd if=/dev/zero of=' + testFile + ' bs=1M count=16 2>/dev/null',
        function (ddErr) {
        if (ddErr) {
            t.ok(false, 'dd failed: ' + ddErr.message);
            t.end();
            return;
        }

        // Step 2: Create initial CIDATA
        nocloud.createPCFS(mockLog, initialPayload, testFile,
            function (createErr) {
            if (createErr) {
                t.ok(false, 'initial createPCFS failed: '
                    + createErr.message);
                cleanup(function () { t.end(); });
                return;
            }
            t.ok(true, 'initial CIDATA created');

            // Step 3: Regenerate with updated payload (same file path)
            nocloud.createPCFS(mockLog, updatedPayload, testFile,
                function (regenErr) {
                if (regenErr) {
                    t.ok(false, 'regenerate createPCFS failed: '
                        + regenErr.message);
                    cleanup(function () { t.end(); });
                    return;
                }
                t.ok(true, 'CIDATA regenerated');

                // Step 4: Mount and verify updated contents
                exec('lofiadm -a ' + testFile, function (lofiErr, lofiOut) {
                    if (lofiErr) {
                        t.ok(false, 'lofiadm failed: ' + lofiErr.message);
                        cleanup(function () { t.end(); });
                        return;
                    }
                    lofiDevice = lofiOut.trim();

                    exec('mkdir -p ' + mountPoint, function (mkdirErr) {
                        if (mkdirErr) {
                            t.ok(false, 'mkdir failed: ' + mkdirErr.message);
                            cleanup(function () { t.end(); });
                            return;
                        }

                        exec('mount -F pcfs ' + lofiDevice + ' ' + mountPoint,
                            function (mountErr) {
                            if (mountErr) {
                                t.ok(false, 'mount failed: '
                                    + mountErr.message);
                                cleanup(function () { t.end(); });
                                return;
                            }

                            // Verify meta-data has updated hostname
                            var metaData = fs.readFileSync(
                                mountPoint + '/meta-data', 'utf8');
                            t.ok(metaData.indexOf(
                                'local-hostname: updated-host') !== -1,
                                'meta-data has updated hostname');
                            t.ok(metaData.indexOf('instance-id: '
                                + 'a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                                !== -1,
                                'instance-id unchanged');

                            // Verify network-config has both NICs
                            var networkConfig = fs.readFileSync(
                                mountPoint + '/network-config', 'utf8');
                            t.ok(networkConfig.indexOf('eth0:') !== -1,
                                'network-config has eth0');
                            t.ok(networkConfig.indexOf('eth1:') !== -1,
                                'network-config has new eth1');
                            t.ok(networkConfig.indexOf('172.16.0.5/16')
                                !== -1,
                                'network-config has eth1 IP');
                            t.ok(networkConfig.indexOf('- 1.1.1.1') !== -1,
                                'network-config has updated resolver');

                            cleanup(function () {
                                t.ok(true, 'cleanup completed');
                                t.end();
                            });
                        });
                    });
                });
            });
        });
    });
});

/*
 * Integration test for createPCFS.
 *
 * This test requires SmartOS with lofiadm, mkfs, and mount privileges.
 * It creates a 16MiB file, calls createPCFS to write cloud-init data,
 * then mounts the resulting FAT16 image to verify its contents.
 */
test('createPCFS creates valid CIDATA image (integration)', function (t) {
    var testFile = '/tmp/test-cloudinit-' + process.pid + '.img';
    var mountPoint = '/tmp/test-cloudinit-mnt-' + process.pid;
    var lofiDevice = null;

    var payload = {
        uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        hostname: 'integration-test-vm',
        resolvers: ['1.1.1.1', '9.9.9.9'],
        add_nics: [
            {
                interface: 'eth0',
                mac: '02:00:00:00:00:01',
                ips: ['10.0.0.10/24'],
                gateways: ['10.0.0.1'],
                primary: true
            }
        ],
        customer_metadata: {
            'cloud-init:user-data': '#cloud-config\npackage_upgrade: true\n'
        }
    };

    // Helper to run cleanup and end test
    function cleanup(cb) {
        exec('umount ' + mountPoint + ' 2>/dev/null; '
            + (lofiDevice ? 'lofiadm -d ' + lofiDevice + ' 2>/dev/null; ' : '')
            + 'rmdir ' + mountPoint + ' 2>/dev/null; '
            + 'rm -f ' + testFile,
            function () {
            cb();
        });
    }

    // Step 1: Create 16MiB empty file
    exec('dd if=/dev/zero of=' + testFile + ' bs=1M count=16 2>/dev/null',
        function (ddErr) {
        if (ddErr) {
            t.ok(false, 'dd failed to create test file: ' + ddErr.message);
            t.end();
            return;
        }
        t.ok(true, 'created 16MiB test file');

        // Step 2: Call createPCFS
        nocloud.createPCFS(mockLog, payload, testFile, function (createErr) {
            if (createErr) {
                t.ok(false, 'createPCFS failed: ' + createErr.message);
                cleanup(function () { t.end(); });
                return;
            }
            t.ok(true, 'createPCFS completed successfully');

            // Step 3: Mount and inspect
            exec('lofiadm -a ' + testFile, function (lofiErr, lofiOut) {
                if (lofiErr) {
                    t.ok(false, 'lofiadm -a failed: ' + lofiErr.message);
                    cleanup(function () { t.end(); });
                    return;
                }
                lofiDevice = lofiOut.trim();
                t.ok(true, 'attached lofi device: ' + lofiDevice);

                exec('mkdir -p ' + mountPoint, function (mkdirErr) {
                    if (mkdirErr) {
                        t.ok(false, 'mkdir failed: ' + mkdirErr.message);
                        cleanup(function () { t.end(); });
                        return;
                    }

                    exec('mount -F pcfs ' + lofiDevice + ' ' + mountPoint,
                        function (mountErr) {
                        if (mountErr) {
                            t.ok(false, 'mount failed: ' + mountErr.message);
                            cleanup(function () { t.end(); });
                            return;
                        }
                        t.ok(true, 'mounted CIDATA image');

                        // Step 4: Verify files exist and have correct content
                        var metaData = fs.readFileSync(
                            mountPoint + '/meta-data', 'utf8');
                        t.ok(metaData.indexOf('instance-id: '
                            + 'a1b2c3d4-e5f6-7890-abcd-ef1234567890') !== -1,
                            'meta-data contains correct instance-id');
                        t.ok(metaData.indexOf(
                            'local-hostname: integration-test-vm') !== -1,
                            'meta-data contains correct hostname');

                        var networkConfig = fs.readFileSync(
                            mountPoint + '/network-config', 'utf8');
                        t.ok(networkConfig.indexOf('version: 2') !== -1,
                            'network-config contains version: 2');
                        t.ok(networkConfig.indexOf('10.0.0.10/24') !== -1,
                            'network-config contains IP address');
                        t.ok(networkConfig.indexOf('gateway4: 10.0.0.1') !== -1,
                            'network-config contains gateway');

                        var userData = fs.readFileSync(
                            mountPoint + '/user-data', 'utf8');
                        t.ok(userData.indexOf('#cloud-config') !== -1,
                            'user-data contains #cloud-config');
                        t.ok(userData.indexOf('package_upgrade: true') !== -1,
                            'user-data contains custom content');

                        // Step 5: Cleanup
                        cleanup(function () {
                            t.ok(true, 'cleanup completed');
                            t.end();
                        });
                    });
                });
            });
        });
    });
});
