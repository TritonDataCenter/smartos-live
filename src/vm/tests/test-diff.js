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
 * Copyright (c) 2018, Joyent, Inc.
 *
 */

var util = require('util');

var diff = require('/usr/vm/node_modules/diff');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

function copy(o) {
    return JSON.parse(JSON.stringify(o));
}

[
    undefined,
    null,
    new Date(),
    function func() {},
    '',
    'a',
    5,
    [],
    ['foo'],
    [['foo']],
    [{name: 'foo'}],
    {},
    [function arrayFunc() {}],
    {func: function objFunc() {}},
    {name: 'foo'},
    {names: ['foo','bar']},
    {things: [{name: 'foo'}]}
].forEach(function (o) {
    test('test diff objects that are the same: '
        + util.inspect(o), function (t) {

        var changes = diff(o, o);
        t.ok(Array.isArray(changes), 'changes is an array');
        t.equal(changes.length, 0, 'changes is an empty array');
        t.end();
    });
});

test('test diff simple objects', function (t) {
    var changes;
    var change;

    var o1 = {
        id: 1,
        name: 'foo'
    };
    var o2 = {
        id: 1,
        name: 'bar'
    };

    // compare objects
    changes = diff(o1, o2);
    t.equal(changes.length, 1, 'one change');

    // assert return
    change = changes[0];
    t.equal(change.path[0], ['name'], 'path changed');
    t.equal(change.prettyPath, 'name', 'path changed (pretty)');
    t.equal(change.action, 'changed', 'action changed');
    t.equal(change.oldValue, 'foo', 'path changed from foo');
    t.equal(change.newValue, 'bar', 'path changed to bar');

    // modify object and compare again
    o2.id = 2;
    changes = diff(o1, o2);
    t.equal(changes.length, 2, 'two changes');

    // assert return
    t.equal(changes[0].path[0], 'id', 'id changed');
    t.equal(changes[0].prettyPath, 'id', 'id changed (pretty)');
    t.equal(changes[0].action, 'changed', 'action changed');
    t.equal(changes[0].oldValue, o1.id, 'id changed from');
    t.equal(changes[0].newValue, o2.id, 'id changed to');

    t.equal(changes[1].path[0], 'name', 'name changed');
    t.equal(changes[1].prettyPath, 'name', 'name changed (pretty)');
    t.equal(changes[1].action, 'changed', 'action changed');
    t.equal(changes[1].oldValue, o1.name, 'name changed from');
    t.equal(changes[1].newValue, o2.name, 'name changed to');

    // make them the same
    o2.id = o1.id;
    o2.name = o1.name;
    changes = diff(o1, o2);
    t.equal(changes.length, 0, 'no changes');

    t.end();
});

test('test diff nested objects', function (t) {
    var changes;
    var change;

    var o1 = {
        foo: {
            bar: {
                baz: 'hello'
            }
        }
    };
    var o2 = {
        foo: {
            bar: {
                baz: 'goodbye'
            }
        }
    };

    changes = diff(o1, o2);
    t.equal(changes.length, 1, 'one change');
    change = changes[0];

    t.deepEqual(change.path, ['foo', 'bar', 'baz'], 'path is correct');
    t.equal(change.prettyPath, 'foo.bar.baz', 'path is correct (pretty)');
    t.equal(change.action, 'changed', 'action changed');
    t.equal(change.oldValue, 'hello', 'changed from');
    t.equal(change.newValue, 'goodbye', 'changed to');

    // make them the same
    o2.foo.bar.baz = 'hello';

    // add a new element
    o2.foo.bar.bat = 'new';
    changes = diff(o1, o2);
    t.equal(changes.length, 1, 'one change');
    change = changes[0];

    t.deepEqual(change.path, ['foo', 'bar', 'bat'], 'path is correct');
    t.equal(change.prettyPath, 'foo.bar.bat', 'path is correct (pretty)');
    t.equal(change.action, 'added', 'action added');
    t.equal(change.newValue, 'new', 'changed to');

    // remove o2.foo completely
    delete o2.foo;
    changes = diff(o1, o2);
    t.equal(changes.length, 1, 'one change');
    change = changes[0];

    t.deepEqual(change.path, ['foo'], 'path is correct');
    t.equal(change.prettyPath, 'foo', 'path is correct (pretty)');
    t.equal(change.action, 'removed', 'action removed');
    t.deepEqual(change.oldValue, o1.foo, 'changed from');

    t.end();
});


test('test diff vmadm payload objects', function (t) {
    var changes;
    var change;

    var base_payload = {
        id: 1,
        alias: 'fake-vm',
        disks: [
            {
                path: '/',
                name: 'slash'
            }
        ]
    };
    var payload1 = copy(base_payload);
    var payload2 = copy(base_payload);

    // add a disk to payload2
    var new_disk = {
        path: '/data',
        name: 'data'
    };
    payload2.disks.push(new_disk);

    // compare objects
    changes = diff(payload1, payload2);
    t.equal(changes.length, 1, 'one change');

    // assert return
    change = changes[0];
    t.deepEqual(change.path, ['disks', null], 'path changed');
    t.equal(change.prettyPath, 'disks.*', 'path changed (pretty)');
    t.equal(change.action, 'added', 'action changed');
    t.equal(change.newValue, new_disk, 'disk added');

    // reset disks
    payload1.disks = [
        {
            path: '/',
            name: 'old'
        }
    ];
    payload2.disks = [
        {
            path: '/',
            name: 'new'
        }
    ];

    // without a map, this will be reported as 2 changes, 'old' being deleted
    // and 'new' being added
    // compare objects
    changes = diff(payload1, payload2);
    t.equal(changes.length, 2, 'two changes');

    t.deepEqual(changes[0].path, ['disks', null], 'disks changed');
    t.equal(changes[0].prettyPath, 'disks.*', 'disks changed (pretty)');
    t.equal(changes[0].action, 'removed', 'action');
    t.equal(changes[0].oldValue, payload1.disks[0], 'disks changed from');

    t.deepEqual(changes[1].path, ['disks', null], 'disks changed');
    t.equal(changes[1].prettyPath, 'disks.*', 'disks changed (pretty)');
    t.equal(changes[1].action, 'added', 'action');
    t.equal(changes[1].newValue, payload2.disks[0], 'disks changed to');

    // with a map, this will be reported as 1 change, 'disks.*.name' changing
    // from 'old' to 'new'
    changes = diff(payload1, payload2, {
        map: {
            disks: 'path'
        }
    });
    t.equal(changes.length, 1, 'one change');
    change = changes[0];

    t.deepEqual(change.path, ['disks', null, 'name'], 'disks changed');
    t.equal(change.prettyPath, 'disks.*.name', 'disks changed (pretty)');
    t.equal(change.action, 'changed', 'action');
    t.equal(change.oldValue, payload1.disks[0].name, 'disks changed from');
    t.equal(change.newValue, payload2.disks[0].name, 'disks changed to');
    t.equal(change.ident, payload1.disks[0].path, 'disks changed ident');

    // assert return
    t.end();
});
