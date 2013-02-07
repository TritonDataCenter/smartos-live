/*
 * test/validate.js: test JSON validation
 */

var assert = require('assert');
var sprintf = require('extsprintf').sprintf;
var jsprim = require('../lib/jsprim');

/* BEGIN JSSTYLED */
var schema = {
    "type": "object",
    "properties": {
        "gid": {
            "type": "string",
            "required": true,
            "minLength": 1
        },
        "uid": {
            "type": "string",
            "required": true,
            "minLength": 1
        },
        "ord": {
            "type": "integer",
            "required": true,
            "minimum": 0
        },
        "state": {
            "type": "string",
            "required": true,
            "enum": [ "dispatched", "running", "done", "cancelled", "aborted" ]
        },
        "machine": {
            "type": "string"
        },
        "zonename": {
            "type": "string"
        },
        "server": {
            "type": "string"
        },
        "result": {
            "type": "string",
            "enum": [ "ok", "fail" ]
        },
        "error": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "required": true,
                    "minLength": 1
                },
                "message": {
                    "type": "string",
                    "required": true
                }
            }
        },
        "crtime": {
            "type": "string",
            "format": "date-time",
            "required": true
        },
        "qtime": {
            "type": "string",
            "format": "date-time"
        },
        "mtime": {
            "type": "string",
            "format": "date-time"
        },
        "atime": {
            "type": "string",
            "format": "date-time"
        },
        "ctime": {
            "type": "string",
            "format": "date-time"
        },
        "ptime": {
            "type": "string",
            "format": "date-time"
        },
        "nresults": {
            "type": "integer",
            "minimum": 0
        },
        "results": {
            "type": "array",
	    "minItems": 1,
            "items": {
                "type": "object",
		'additionalProperties': false,
                "properties": {
                    "entry": {
                        "type": "string",
                        "required": true,
                        "minLength": 1
                    },
                    "crtime": {
                        "type": "string",
                        "format": "date-time",
                        "required": true
                    }
                }
            }
        },
        "entry": {
            "type": "string"
        },
        "oid": {
            "type": "string"
        }
    }
};

var template =   {
    "gid": "ecf8bc81-a454-4e5d-ab30-c328df3f5fc9",
    "uid": "748a319d-65e4-49e4-b097-dbf87296bc9e",
    "oid": "e4515c50-3b57-44c5-895e-f93516132266",
    "server": "564d7268-5617-dba7-ad0d-ca714f0050c9",
    "zonename": "9e4e7c3d-dd4d-4cbd-b234-ffdfa3bc5fa2",
    "machine": "0c90171b-1830-469a-b42f-2fde8f9b7574",
    "crtime": "2012-09-05T22:00:58.112Z",
    "ctime": "2012-09-05T22:01:07.080Z",
    "mtime": "2012-09-05T22:01:04.534Z",
    "atime": "2012-09-05T22:01:04.730Z",
    "ord": 0,
    "state": "done",
    "entry": "wiggum",
    "result": "ok",
    "nresults": 1,
    "results": [ {
        "entry": "wiggum",
        "crtime": "2012-09-05T22:01:04.568Z"
    } ]
};
/* END JSSTYLED */

var obj, err;
var validate = jsprim.validateJsonObjectJS;

/* accepts a valid object */
obj = jsprim.deepCopy(template);
err = validate(schema, obj);
assert(!err);

/* rejects object with missing field */
obj = jsprim.deepCopy(template);
delete (obj['gid']);
err = validate(schema, obj);
console.log(err.message);
assert.ok(/required/.test(err.message));
/* JSSTYLED */
assert.ok(/"gid"/.test(err.message));

/* rejects object with wrong type for field */
obj = jsprim.deepCopy(template);
obj['gid'] = 5;
err = validate(schema, obj);
console.log(err.message);
assert.ok(/string/.test(err.message));
/* JSSTYLED */
assert.ok(/"gid"/.test(err.message));

obj['gid'] = {};
err = validate(schema, obj);
console.log(err.message);
assert.ok(/string/.test(err.message));
/* JSSTYLED */
assert.ok(/"gid"/.test(err.message));

/* rejects strings that are too short */
obj = jsprim.deepCopy(template);
obj['gid'] = '';
err = validate(schema, obj);
console.log(err.message);
assert.ok(/long/.test(err.message) || /length/.test(err.message));
/* JSSTYLED */
assert.ok(/"gid"/.test(err.message));

/* rejects wrong type for integer fields */
obj = jsprim.deepCopy(template);
obj['ord'] = 'food';
err = validate(schema, obj);
console.log(err.message);
assert.ok(/integer/.test(err.message));
/* JSSTYLED */
assert.ok(/"ord"/.test(err.message));

/* XXX json-schema accepts strings as integers */
obj = jsprim.deepCopy(template);
obj['ord'] = '12';
err = validate(schema, obj);
if (err) {
	console.log(err.message);
	assert.ok(/integer/.test(err.message));
	/* JSSTYLED */
	assert.ok(/"ord"/.test(err.message));
} else {
	console.error('WARNING: accepted string as integer');
}

/* rejects floats for integers */
obj = jsprim.deepCopy(template);
obj['ord'] = 3.582;
err = validate(schema, obj);
console.log(err.message);
assert.ok(/integer/.test(err.message));
/* JSSTYLED */
assert.ok(/"ord"/.test(err.message));

/* rejects numbers too small */
obj = jsprim.deepCopy(template);
obj['ord'] = -5;
err = validate(schema, obj);
console.log(err.message);
assert.ok(/minimum/.test(err.message));
/* JSSTYLED */
assert.ok(/"ord"/.test(err.message));

/* rejects enum string not in the valid set */
obj = jsprim.deepCopy(template);
obj['state'] = 'fubared';
err = validate(schema, obj);
console.log(err.message);
assert.ok(/enumeration/.test(err.message) || /possible/.test(err.message));
/* JSSTYLED */
assert.ok(/"state"/.test(err.message));

/* XXX both accept malformed date */
obj = jsprim.deepCopy(template);
obj['crtime'] = 'fubared';
err = validate(schema, obj);
if (err) {
	console.log(err.message);
	/* JSSTYLED */
	assert.ok(/"crtime"/.test(err.message));
} else {
	console.error('WARNING: accepted malformed date');
}

/* rejects array that is too short */
obj = jsprim.deepCopy(template);
obj['results'] = [];
err = validate(schema, obj);
console.log(err.message);
assert.ok(/minimum/.test(err.message));
/* JSSTYLED */
assert.ok(/"results"/.test(err.message));

/* rejects objects with extra properties */
obj = jsprim.deepCopy(template);
obj['results'][0]['extra'] = 'hello';
err = validate(schema, obj);
console.log(err.message);
assert.ok(/additional/.test(err.message));
/* BEGIN JSSTYLED */
assert.ok(/"results\[0\]"/.test(err.message) ||
    /"results\/0"/.test(err.message));
/* END JSSTYLED */
