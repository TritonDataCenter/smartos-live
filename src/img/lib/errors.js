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
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * * *
 * Error classes that imgadm may produce.
 */

var util = require('util'),
    format = util.format;
var assert = require('assert-plus');
var verror = require('verror'),
    WError = verror.WError,
    VError = verror.VError;



// ---- internal support stuff

function _indent(s, indent) {
    if (!indent) indent = '    ';
    var lines = s.split(/\r?\n/g);
    return indent + lines.join('\n' + indent);
}



// ---- error classes

/**
 * Base imgadm error. Instances will always have a string `message` and
 * a string `code` (a CamelCase string). The possible codes are those
 * for every error subclass here, plus the possible `restCode` error
 * responses from IMGAPI.
 * See <https://mo.joyent.com/docs/imgapi/master/#errors>.
 */
function ImgadmError(options) {
    assert.object(options, 'options');
    assert.string(options.message, 'options.message');
    assert.string(options.code, 'options.code');
    assert.optionalObject(options.cause, 'options.cause');
    assert.optionalNumber(options.statusCode, 'options.statusCode');
    var self = this;

    var args = [];
    if (options.cause) args.push(options.cause);
    if (options.message) {
        args.push('%s');
        args.push(options.message);
    }
    WError.apply(this, args);

    var extra = Object.keys(options).filter(
        function (k) { return ['cause', 'message'].indexOf(k) === -1; });
    extra.forEach(function (k) {
        self[k] = options[k];
    });
}
util.inherits(ImgadmError, WError);

function InternalError(options) {
    assert.object(options, 'options');
    assert.optionalString(options.source, 'options.source');
    assert.optionalObject(options.cause, 'options.cause');
    assert.string(options.message, 'options.message');
    var message = options.message;
    if (options.source) {
        message = options.source + ': ' + message;
    }
    ImgadmError.call(this, {
        cause: options.cause,
        message: message,
        code: 'InternalError',
        exitStatus: 1
    });
}
util.inherits(InternalError, ImgadmError);

/**
 * Usage:
 *      new ManifestValidationError(errors)
 *      new ManifestValidationError(cause, errors)
 *
 * I.e. optional *first* arg "cause", per WError style.
 */
function ManifestValidationError(cause, errors) {
    if (errors === undefined) {
        errors = cause;
        cause = undefined;
    }
    assert.arrayOfObject(errors, 'errors');
    var message = errors.map(function (e) {
        if (e.message) {
            return format('%s (%s)', e.field, e.message);
        } else if (e.code === 'Invalid') {
            return e.field;
        } else {
            return format('%s (%s)', e.field, e.code);
        }
    });
    message = format('invalid manifest: %s', message.join(', '));
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'ManifestValidation'
    });
}
util.inherits(ManifestValidationError, ImgadmError);

function NoSourcesError() {
    ImgadmError.call(this, {
        message: 'imgadm has no configured sources',
        code: 'NoSources',
        exitStatus: 1
    });
}
util.inherits(NoSourcesError, ImgadmError);

function SourcePingError(cause, source) {
    if (source === undefined) {
        source = cause;
        cause = undefined;
    }
    assert.object(source, 'source');
    var details = '';
    if (cause) {
        details = ': ' + cause.toString();
    }
    ImgadmError.call(this, {
        cause: cause,
        message: format('unexpected ping error with image source "%s" (%s)%s',
            source.url, source.type, details),
        code: 'SourcePing',
        exitStatus: 1
    });
}
util.inherits(SourcePingError, ImgadmError);

function ImageNotFoundError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: format('image "%s" was not found', uuid),
        code: 'ImageNotFound',
        exitStatus: 1
    });
}
util.inherits(ImageNotFoundError, ImgadmError);

function VmNotFoundError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: format('vm "%s" was not found', uuid),
        code: 'VmNotFound',
        exitStatus: 1
    });
}
util.inherits(VmNotFoundError, ImgadmError);

// A VM must be prepared and stopped before it can be used by 'imgadm create'.
function VmNotStoppedError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: format('vm "%s" is not stopped', uuid),
        code: 'VmNotStopped',
        exitStatus: 1
    });
}
util.inherits(VmNotStoppedError, ImgadmError);

// A VM must have an origin image to 'imgadm create' an *incremental* image.
function VmHasNoOriginError(cause, vmUuid) {
    if (vmUuid === undefined) {
        vmUuid = cause;
        cause = undefined;
    }
    assert.string(vmUuid, 'vmUuid');
    ImgadmError.call(this, {
        cause: cause,
        message: format('cannot create an incremental image: vm "%s" has '
            + 'no origin', vmUuid),
        code: 'VmHasNoOrigin',
        exitStatus: 1
    });
}
util.inherits(VmHasNoOriginError, ImgadmError);

function PrepareImageError(cause, vmUuid, details) {
    if (details === undefined) {
        details = vmUuid;
        vmUuid = cause;
        cause = undefined;
    }
    assert.string(vmUuid, 'vmUuid');
    assert.string(details, 'details');
    var extra = '';
    if (details) {
        if (details.indexOf('\n') !== -1) {
            extra = ':\n' + _indent('...\n' + details);
        } else {
            extra = ': ' + details;
        }
    }
    ImgadmError.call(this, {
        cause: cause,
        message: format('prepare-image script error while preparing VM %s%s',
            vmUuid, extra),
        code: 'PrepareImageError',
        exitStatus: 1
    });
}
util.inherits(PrepareImageError, ImgadmError);

/**
 * When the prepare-image script (used by `imgadm create -s prep-script`)
 * does not set the 'prepare-image:state=running' mdata to indicate that it
 * started running.
 */
function PrepareImageDidNotRunError(cause, vmUuid) {
    if (vmUuid === undefined) {
        vmUuid = cause;
        cause = undefined;
    }
    assert.string(vmUuid, 'vmUuid');
    ImgadmError.call(this, {
        cause: cause,
        message: format('prepare-image script did not indicate it was run '
            + '(old guest tools in VM %s?)', vmUuid),
        code: 'PrepareImageDidNotRun',
        exitStatus: 1
    });
}
util.inherits(PrepareImageDidNotRunError, ImgadmError);

function TimeoutError(cause, msg) {
    if (msg === undefined) {
        msg = cause;
        cause = undefined;
    }
    assert.string(msg, 'msg');
    ImgadmError.call(this, {
        cause: cause,
        message: msg,
        code: 'Timeout',
        exitStatus: 1
    });
}
util.inherits(TimeoutError, ImgadmError);

// For *incremental* image creation the origin image must have a '@final'
// snapshot from which the incr zfs send is taken. '@final' is what 'imgadm
// install' ensures, but imported datasets from earlier 'imgadm' or pre-imgadm
// might not have one.
function OriginHasNoFinalSnapshotError(cause, originUuid) {
    if (originUuid === undefined) {
        originUuid = cause;
        cause = undefined;
    }
    assert.string(originUuid, 'originUuid');
    ImgadmError.call(this, {
        cause: cause,
        message: format('cannot create an incremental image: origin image "%s" '
            + 'has no "@final" snapshot (sometimes this can be fixed by '
            + '"imgadm update")', originUuid),
        code: 'OriginHasNoFinalSnapshot',
        exitStatus: 1
    });
}
util.inherits(OriginHasNoFinalSnapshotError, ImgadmError);

function ActiveImageNotFoundError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: format('an active image "%s" was not found', uuid),
        code: 'ActiveImageNotFound',
        exitStatus: 1
    });
}
util.inherits(ActiveImageNotFoundError, ImgadmError);

function ImageNotActiveError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: format('image "%s" is not active', uuid),
        code: 'ImageNotActive',
        exitStatus: 1
    });
}
util.inherits(ImageNotActiveError, ImgadmError);

function ImageNotInstalledError(cause, zpool, uuid) {
    if (uuid === undefined) {
        // `cause` was not provided.
        uuid = zpool;
        zpool = cause;
        cause = undefined;
    }
    assert.string(zpool, 'zpool');
    assert.string(uuid, 'uuid');
    ImgadmError.call(this, {
        cause: cause,
        message: format('image "%s" was not found on zpool "%s"', uuid, zpool),
        code: 'ImageNotInstalled',
        exitStatus: 3
    });
}
util.inherits(ImageNotInstalledError, ImgadmError);

function ImageHasDependentClonesError(cause, imageInfo) {
    if (imageInfo === undefined) {
        imageInfo = cause;
        cause = undefined;
    }
    assert.object(imageInfo, 'imageInfo');
    assert.string(imageInfo.manifest.uuid, 'imageInfo.manifest.uuid');
    var clones = imageInfo.children.clones;
    assert.arrayOfString(clones, 'imageInfo.children.clones');
    var message = format('image "%s" has dependent clones: %s',
        imageInfo.manifest.uuid, clones[0]);
    if (clones.length > 1) {
        message += format(' and %d others...', clones.length - 1);
    }
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'ImageHasDependentClones',
        exitStatus: 1
    });
}
util.inherits(ImageHasDependentClonesError, ImgadmError);

function OriginNotInstalledError(cause, zpool, uuid) {
    if (uuid === undefined) {
        // `cause` was not provided.
        uuid = zpool;
        zpool = cause;
        cause = undefined;
    }
    assert.string(zpool, 'zpool');
    assert.string(uuid, 'uuid');
    ImgadmError.call(this, {
        cause: cause,
        message: format('origin image "%s" was not found on zpool "%s"',
            uuid, zpool),
        code: 'OriginNotInstalled',
        exitStatus: 3
    });
}
util.inherits(OriginNotInstalledError, ImgadmError);

function InvalidUUIDError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    ImgadmError.call(this, {
        cause: cause,
        message: format('invalid uuid: "%s"', uuid),
        code: 'InvalidUUID',
        exitStatus: 1
    });
}
util.inherits(InvalidUUIDError, ImgadmError);

function InvalidManifestError(cause) {
    assert.optionalObject(cause);
    var message = 'manifest is invalid';
    if (cause) {
        message += ': ' + (cause.message || String(cause));
    }
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'InvalidManifest',
        exitStatus: 1
    });
}
util.inherits(InvalidManifestError, ImgadmError);

function UnexpectedNumberOfSnapshotsError(uuid, snapnames) {
    assert.string(uuid, 'uuid');
    assert.arrayOfString(snapnames, 'snapnames');
    var extra = '';
    if (snapnames.length) {
        extra = ': ' + snapnames.join(', ');
    }
    ImgadmError.call(this, {
        message: format(
            'image "%s" has an unexpected number of snapshots (%d)%s',
            uuid, snapnames.length, extra),
        code: 'UnexpectedNumberOfSnapshots',
        exitStatus: 1
    });
}
util.inherits(UnexpectedNumberOfSnapshotsError, ImgadmError);

function ImageMissingOriginalSnapshotError(uuid, datasetGuid) {
    assert.string(uuid, 'uuid');
    assert.optionalString(datasetGuid, 'datasetGuid');
    var extra = '';
    if (datasetGuid) {
        extra = ' (expected a snapshot with guid ' + datasetGuid + ')';
    }
    ImgadmError.call(this, {
        message: format('image "%s" is missing its original snapshot%s',
            uuid, extra),
        code: 'ImageMissingOriginalSnapshot',
        exitStatus: 1
    });
}
util.inherits(ImageMissingOriginalSnapshotError, ImgadmError);

function FileSystemError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'FileSystem',
        exitStatus: 1
    });
}
util.inherits(FileSystemError, ImgadmError);

function UncompressionError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'UncompressionError',
        exitStatus: 1
    });
}
util.inherits(UncompressionError, ImgadmError);

function NotSupportedError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'NotSupported',
        exitStatus: 1
    });
}
util.inherits(NotSupportedError, ImgadmError);

function UsageError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'Usage',
        exitStatus: 1
    });
}
util.inherits(UsageError, ImgadmError);

function UnknownOptionError(cause, option) {
    if (option === undefined) {
        option = cause;
        cause = undefined;
    }
    assert.string(option);
    ImgadmError.call(this, {
        cause: cause,
        message: format('unknown option: "%s"', option),
        code: 'UnknownOption',
        exitStatus: 1
    });
}
util.inherits(UnknownOptionError, ImgadmError);

function UnknownCommandError(cause, command) {
    if (command === undefined) {
        command = cause;
        cause = undefined;
    }
    assert.string(command);
    ImgadmError.call(this, {
        cause: cause,
        message: format('unknown command: "%s"', command),
        code: 'UnknownCommand',
        exitStatus: 1
    });
}
util.inherits(UnknownCommandError, ImgadmError);

function ClientError(source, cause) {
    assert.string(source, 'source');
    assert.object(cause, 'cause');
    ImgadmError.call(this, {
        cause: cause,
        message: format('%s: %s', source, cause),
        code: 'ClientError',
        exitStatus: 1
    });
}
ClientError.description = 'An error from a syscall in the IMGAPI client.';
util.inherits(ClientError, ImgadmError);


function APIError(source, cause) {
    assert.string(source, 'source');
    assert.object(cause, 'cause');
    assert.optionalNumber(cause.statusCode, 'cause.statusCode');
    assert.string(cause.body.code, 'cause.body.code');
    assert.string(cause.body.message, 'cause.body.message');
    var message = cause.body.message;
    if (cause.body.errors) {
        cause.body.errors.forEach(function (e) {
            message += format('\n    %s: %s', e.field, e.code);
            if (e.message) {
                message += ': ' + e.message;
            }
        });
    }
    ImgadmError.call(this, {
        cause: cause,
        message: format('%s: %s', source, message),
        code: cause.body.code,
        statusCode: cause.statusCode,
        exitStatus: 1
    });
}
APIError.description = 'An error from the IMGAPI http request.';
util.inherits(APIError, ImgadmError);


function DownloadError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'DownloadError'
    });
}
util.inherits(DownloadError, ImgadmError);

function UploadError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'UploadError'
    });
}
util.inherits(UploadError, ImgadmError);

function ConfigError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'ConfigError'
    });
}
util.inherits(ConfigError, ImgadmError);


function UpgradeError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'UpgradeError'
    });
}
util.inherits(UpgradeError, ImgadmError);


/**
 * Multiple ImgadmErrors in a group.
 */
function MultiError(errs) {
    assert.arrayOfObject(errs, 'errs');
    var lines = [format('multiple (%d) errors', errs.length)];
    for (var i = 0; i < errs.length; i++) {
        var err = errs[i];
        lines.push(format('    error (%s): %s', err.code, err.message));
    }
    ImgadmError.call(this, {
        cause: errs[0],
        message: lines.join('\n'),
        code: 'MultiError',
        exitStatus: 1
    });
}
MultiError.description = 'Multiple IMGADM errors.';
util.inherits(MultiError, ImgadmError);



// ---- exports

module.exports = {
    ImgadmError: ImgadmError,
    InternalError: InternalError,
    InvalidUUIDError: InvalidUUIDError,
    NoSourcesError: NoSourcesError,
    SourcePingError: SourcePingError,
    ImageNotFoundError: ImageNotFoundError,
    VmNotFoundError: VmNotFoundError,
    VmNotStoppedError: VmNotStoppedError,
    VmHasNoOriginError: VmHasNoOriginError,
    PrepareImageError: PrepareImageError,
    PrepareImageDidNotRunError: PrepareImageDidNotRunError,
    TimeoutError: TimeoutError,
    OriginHasNoFinalSnapshotError: OriginHasNoFinalSnapshotError,
    ManifestValidationError: ManifestValidationError,
    ActiveImageNotFoundError: ActiveImageNotFoundError,
    ImageNotActiveError: ImageNotActiveError,
    ImageNotInstalledError: ImageNotInstalledError,
    ImageHasDependentClonesError: ImageHasDependentClonesError,
    OriginNotInstalledError: OriginNotInstalledError,
    InvalidManifestError: InvalidManifestError,
    UnexpectedNumberOfSnapshotsError: UnexpectedNumberOfSnapshotsError,
    ImageMissingOriginalSnapshotError: ImageMissingOriginalSnapshotError,
    FileSystemError: FileSystemError,
    UncompressionError: UncompressionError,
    NotSupportedError: NotSupportedError,
    UsageError: UsageError,
    UnknownOptionError: UnknownOptionError,
    UnknownCommandError: UnknownCommandError,
    ClientError: ClientError,
    APIError: APIError,
    DownloadError: DownloadError,
    UploadError: UploadError,
    ConfigError: ConfigError,
    UpgradeError: UpgradeError,
    MultiError: MultiError
};
