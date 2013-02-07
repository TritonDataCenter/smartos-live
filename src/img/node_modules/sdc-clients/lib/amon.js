// Copyright 2012 Joyent, Inc.  All rights reserved.

var format = require('util').format;
var qs = require('querystring');

var assert = require('assert-plus');
var restify = require('restify');



// --- Exported Amon Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options
 *    - url {String} Amon Master location.
 *    - ... any other options allowed to `restify.createJsonClient`
 *
 */
function Amon(options) {
    if (!options)
        throw new TypeError('options required');
    if (!options.url)
        throw new TypeError('options.url (String) is required');

    this.client = restify.createJsonClient(options);
}


/**
 * Ping Amon server.
 *
 * @param {Function} callback : call of the form f(err, pong).
 */
Amon.prototype.ping = function (callback) {
    if (!callback || typeof (callback) !== 'function')
        throw new TypeError('callback (Function) is required');

    this.client.get('/ping', function (err, req, res, pong) {
        if (err) {
            return callback(err);
        }
        return callback(null, pong);
    });
};



// ---- Probe Groups

/**
 * List probe groups by user.
 *
 * @param {String} user : the user uuid.
 * @param {Function} callback : call of the form f(err, probegroups).
 */
Amon.prototype.listProbeGroups = function (user, callback) {
    assert.string(user, 'user');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probegroups', user);
    this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Create a probe group.
 *
 * @param {String} user : The user UUID.
 * @param {Object} probeGroup : The probe group data.
 */
Amon.prototype.createProbeGroup = function (user, probeGroup, callback) {
    assert.string(user, 'user');
    assert.object(probeGroup, 'probeGroup');
    var path = format('/pub/%s/probegroups', user);
    this.client.post(path, probeGroup, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Update a probe group.
 *
 * @param {String} user : The user UUID.
 * @param {String} uuid : probe group UUID.
 * @param {Object} probeGroup : The probe group data.
 */
Amon.prototype.putProbeGroup = function (user, uuid, probeGroup, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.object(probeGroup, 'probeGroup');
    var path = format('/pub/%s/probegroups/%s', user, uuid);
    this.client.put(path, probeGroup, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Deletes a probe group from Amon.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe group UUID.
 * @param {Function} callback of the form f(err).
 */
Amon.prototype.deleteProbeGroup = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probegroups/%s', user, uuid);
    this.client.del(path, function (err, req, res) {
        if (err) {
            return callback(err);
        }
        return callback(null);
    });
};


/**
 * Get a probe group.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe group UUID.
 * @param {Function} callback of the form f(err, account).
 */
Amon.prototype.getProbeGroup = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probegroups/%s', user, uuid);
    this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};



// ---- Probes

/**
 * List probes by user.
 *
 * @param {String} user : the user uuid.
 * @param {Function} callback : call of the form f(err, probes).
 */
Amon.prototype.listProbes = function (user, callback) {
    assert.string(user, 'user');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probes', user);
    this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Create a probe.
 *
 * @param {String} user : The user UUID.
 * @param {Object} probe : The probe data.
 */
Amon.prototype.createProbe = function (user, probe, callback) {
    assert.string(user, 'user');
    assert.object(probe, 'probe');
    var path = format('/pub/%s/probes', user);
    this.client.post(path, probe, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Update a probe.
 *
 * @param {String} user : The user UUID.
 * @param {String} uuid : probe UUID.
 * @param {Object} probe : The probe data.
 */
Amon.prototype.putProbe = function (user, uuid, probe, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.object(probe, 'probe');
    var path = format('/pub/%s/probes/%s', user, uuid);
    this.client.put(path, probe, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


/**
 * Deletes a probe from Amon.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe UUID.
 * @param {Function} callback of the form f(err).
 */
Amon.prototype.deleteProbe = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probes/%s', user, uuid);
    this.client.del(path, function (err, req, res) {
        if (err) {
            return callback(err);
        }
        return callback(null);
    });
};


/**
 * Gets probe.
 *
 * @param {String} user : the user uuid.
 * @param {String} uuid : probe UUID.
 * @param {Function} callback : callback of the form f(err, account).
 */
Amon.prototype.getProbe = function (user, uuid, callback) {
    assert.string(user, 'user');
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var path = format('/pub/%s/probes/%s', user, uuid);
    this.client.get(path, function (err, req, res, obj) {
        if (err) {
            return callback(err);
        }
        return callback(null, obj);
    });
};


// ---- Alarms

/**
 * Get all alarms in the system.
 *
 * **WARNING**: This is a resource intensive call. It should only be called
 * on behalf of operators and **sparingly**.
 */
Amon.prototype.listAllAlarms = function listAllAlarms(callback) {
    assert.func(callback, 'callback');

    this.client.get('/alarms', function (err, req, res, alarms) {
        if (err) {
            return callback(err);
        }
        return callback(null, alarms);
    });
};


/**
 * List alarms for a user.
 *
 * @param {UUID} user : the user uuid.
 * @param {Object} options : Optional filters:
 *      - {String} state : One of 'recent' (implicit default, includes all
 *        open and recently closed alarms), 'open', 'closed', 'all'.
 *      - {UUID} probeGroup : Limit returned alarms to those associated with
 *        the given probe group UUID, i.e. alarms due to a fault in a probe
 *        that is part of that probe group.
 * @param {Function} callback : callback of the form fn(err, alarms)
 */
Amon.prototype.listAlarms = function listAlarms(user, options, callback) {
    if (callback === undefined) {
        callback = options;
        options = undefined;
    }
    assert.string(user, 'user');
    assert.optionalObject(options, 'options');
    assert.func(callback, 'callback');

    var path = format('/pub/%s/alarms', user);
    if (options) {
        var query = {};
        if (options.state) query.state = options.state;
        if (options.probeGroup) query.probeGroup = options.probeGroup;
        query = qs.stringify(query);
        if (query.length > 0) {
            path += '?' + query;
        }
    }
    this.client.get(path, function (err, req, res, alarms) {
        if (err) {
            return callback(err);
        }
        return callback(null, alarms);
    });
};


/**
 * Get a specific user alarm.
 *
 * @param {UUID} user : the user uuid.
 * @param {Number} id : The integer alarm id.
 * @param {Function} callback : callback of the form fn(err, alarm)
 */
Amon.prototype.getAlarm = function getAlarm(user, id, callback) {
    assert.string(user, 'user');
    assert.number(id, 'id');
    if (!/^\d+$/.test(String(id))) {
        throw new assert.AssertionError({
            message: format('id is not a positive integer: %s', id),
            actual: typeof (id), expected: 'integer', operator: '==='});
    }
    assert.func(callback, 'callback');

    var path = format('/pub/%s/alarms/%d', user, id);
    this.client.get(path, function (err, req, res, alarm) {
        if (err) {
            return callback(err);
        }
        return callback(null, alarm);
    });
};


/**
 * Close an alarm.
 * <https://mo.joyent.com/docs/amon/master/#CloseAlarm>
 *
 * @param {UUID} user : the user uuid.
 * @param {Number} id : The integer alarm id.
 * @param {Function} callback : callback of the form fn(err)
 */
Amon.prototype.closeAlarm = function closeAlarm(user, id, callback) {
    assert.string(user, 'user');
    assert.number(id, 'id');
    if (!/^\d+$/.test(String(id))) {
        throw new assert.AssertionError({
            message: format('id is not a positive integer: %s', id),
            actual: typeof (id), expected: 'integer', operator: '==='});
    }
    assert.func(callback, 'callback');

    var path = format('/pub/%s/alarms/%d?action=close', user, id);
    this.client.post(path, function (err, req, res) {
        callback(err);
    });
};


/**
 * Reopen an alarm.
 * <https://mo.joyent.com/docs/amon/master/#ReopenAlarm>
 *
 * @param {UUID} user : the user uuid.
 * @param {Number} id : The integer alarm id.
 * @param {Function} callback : callback of the form fn(err)
 */
Amon.prototype.reopenAlarm = function reopenAlarm(user, id, callback) {
    assert.string(user, 'user');
    assert.number(id, 'id');
    if (!/^\d+$/.test(String(id))) {
        throw new assert.AssertionError({
            message: format('id is not a positive integer: %s', id),
            actual: typeof (id), expected: 'integer', operator: '==='});
    }
    assert.func(callback, 'callback');

    var path = format('/pub/%s/alarms/%d?action=reopen', user, id);
    this.client.post(path, function (err, req, res) {
        callback(err);
    });
};


/**
 * Delete an alarm.
 * <https://mo.joyent.com/docs/amon/master/#DeleteAlarm>
 *
 * Note: Typical usage of Amon alarms is NOT to delete them. Instead, one
 * typically closes an alarm (via CloseAlarm). The Amon system automatically
 * expunges closed alarms after a time period (typically a week).
 *
 * @param {UUID} user : the user uuid.
 * @param {Number} id : The integer alarm id.
 * @param {Function} callback : callback of the form fn(err)
 */
Amon.prototype.deleteAlarm = function deleteAlarm(user, id, callback) {
    assert.string(user, 'user');
    assert.number(id, 'id');
    if (!/^\d+$/.test(String(id))) {
        throw new assert.AssertionError({
            message: format('id is not a positive integer: %s', id),
            actual: typeof (id), expected: 'integer', operator: '==='});
    }
    assert.func(callback, 'callback');

    var path = format('/pub/%s/alarms/%d', user, id);
    this.client.del(path, function (err, req, res) {
        callback(err);
    });
};




module.exports = Amon;
