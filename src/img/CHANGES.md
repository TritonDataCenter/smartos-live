# imgadm changelog

Known issues:

- Docker image imports are experimental. Docker image import also only supports
  Docker Registry v2.

## 3.9.3

- joyent/smartos-live#771 imgadm vacuum will try to reap images used by bhyve vms

## 3.9.2

- TRITON-622 'stdin.write' in promptYesNo func in common.js breaks on node v10

## 3.9.1

- OS-5979 ensure imgadm uses the provided req_id

## 3.9.0

- TRITON-178 add support for image creation for bhyve VMs. Also includes a
  change where created images for bhyve, lx and kvm will have requirements.brand
  set to the brand of the source VM when creating an image.

## 3.8.0

- joyent/imgadm#644 Update imgadm to use newer docker-registry-client so it can
  pull from v2 registries. Docker v1 registry pulls are no longer supported.

## 3.7.4

- DOCKER-1118 `imgadm create ...` will no longer set `requirements.min_platform`
  to the current platform version for LX and Docker images. KVM images already
  did not set `min_platform`. It is still set for SmartOS images.

## 3.7.3

- OS-6383 Fix a possible crash in 'imgadm import ...'.

## 3.7.2

- OS-6177 avoid checking content-md5 on imgadm import when a checksum exists on
  image metadata

## 3.7.1

- OS-5823 Allow 'imgadm install' to be able to install a type=docker image.

## 3.7.0

- OS-5798 Allow '+' in the image manifest "version" field.

## 3.6.2

- OS-5335 docker image import should disallow meaningless operations

## 3.6.1

- OS-5049 'imgadm import' of docker layers doesn't handle multiple *hardlinked* whiteout files

## 3.6.0

- OS-5088 expose image type in 'imgadm list' to help distinguish LX linux from KVM linux

## 3.5.2

- OS-4493 Fix an 'imgadm import' crash on invalid Docker image ancestry info.

## 3.5.1

- OS-4466 Fix an issue where some Docker images could not be imported because
  a child layer included a *file* at a path where a parent layer already had
  placed a *directory*. `gtar` being used by imgadm for extracting docker layers
  doesn't include an option for that case.

## 3.5.0

- Images imported from 'docker' sources now have a *different local image UUID*
  from before. Before this change the UUID was just the first half of the
  Docker 64-char ID, reformatted as a UUID. After this change, the image UUID
  is (a v5 UUID) generated from the Docker ID *and the Docker registry host*
  (a.k.a. the "index name"). The reason for this change is to ensure that
  the same Docker ID from separate registries do not collide. While it
  may commonly be the *intention* that they are the same image, the
  Docker Registry API v1 (still relevant, although currently be supplanted
  by v2) provides no guarantees that a given image ID from separate
  registries has the same *content*.

  The groundwork for this was laid in v3.2.0 with DOCKER-257.  This is a
  backwards incompatible change for users of 'docker' sources.  However the
  only side-effect should be that an image needs to be re-imported from its
  Docker source. Sources of type 'docker' are currently marked as experimental,
  hence no major version bump.

## 3.4.1

- DOCKER-424: docker pull failed to complete for an image manifest with no
  'comment' or 'container_config.Cmd'

## 3.4.0

- OS-4315: Slight change in Docker image import to use the "localName"
  for the "docker:repo" tag, instead of the "canonicalName". E.g. "busybox"
  instead of "docker.io/busybox". The former is more common parlance
  and looses no info.

## 3.3.0

- OS-4262: 'imgadm import -S <source> ...' to support importing from a given
  IMGAPI source.  Also 'imgadm import --zstream ...' to support importing where
  the image file is a raw ZFS stream. Together these options can be useful to
  import from a lightweight IMGAPI server that pulls image files directly from
  a ZFS zpool.


## 3.2.0

- DOCKER-257: A start at support for Docker registries other than Docker Hub.
  Changes here included support for "insecure" image sources, to allow using
  HTTPS sources with a self-signed certificate. Also `imgadm sources -k ...` to
  specify that option.
- OS-4209: imgadm test suite failure: 'Uncaught AssertionError: x-docker-size header (number) is required'
- OS-4261: imgadm vacuum


## 3.1.5

- OS-4140: imgadm list could do better excluding some filesystems
- OS-3873: imgadm exec's of 'zfs list' and 'zoneadm list' can break the default
  200k maxBuffer

## 3.1.4

- OS-4117: imgadm import crashes on a docker layer which is an empty gzip

## 3.1.3

- DOCKER-263 guard against symlink or hard link attacks with imgadm import of docker images
- [OS-4102] OS-4097 broke import of uncompressed images

## 3.1.2

*Bad version.*

- [OS-4097] support xz-compressed Docker images, e.g. learn/tutorial


## 3.1.1

- [#412] support 'imgadm create' on non-cloned KVM VMs
- [OS-3734] imgadm import fails with 'dataset already exists'


## 3.1.0

- [OS-3692] Start a very limited "/usr/img/lib/IMG.js" node.js API to
  imgadm for *platform-based* node.js tools to use for performance.
  Currently this only adds `IMG.quickGetImage()` for use by `vminfod`.


## 3.0.0

- [joyent/smartos-live#120] Support using a HTTP(S) proxy via
  the `https_proxy` or `http_proxy` environment variable.

- Docker image import: both in importing images of `type=docker` from an
  IMGAPI source and in importing Docker images directly from Docker Hub.
  Docker registries other than Docker Hub are technically supported, but client
  auth is not yet implemented. A shortcut for adding the Docker Hub as an
  import source is:

        imgadm sources --add-docker-hub

  Use the following to mimic `docker images`:

        imgadm list --docker

  And list all Docker images (including intermediate layers) with:

        imgadm list type=docker

  A subset of the full Docker "image json" metadata is stored as "docker:*"
  tags on the image. E.g. for the current "busybox:latest":

        ...
        "tags": {
          "docker:id": "4986bf8c15363d1c5d15512d5266f8777bfba4974ac56e3270e7760f6f0a8125",
          "docker:architecture": "amd64",
          "docker:repo": "library/busybox",
          "docker:tag:buildroot-2014.02": true,
          "docker:tag:latest": true,
          "docker:config": {
            "Cmd": [
              "/bin/sh"
            ],
            "Entrypoint": null,
            "Env": [
              "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
            ],
            "WorkingDir": ""
          }
        ...

  This work involved the following tickets: OS-3593, OS-3585, OS-3584, OS-3521,
  OS-3604, OS-3566.

- Refactoring of import and source handling. Multiple images (in a single
  image's ancestry) are downloaded in parallel. As well a number of small
  command changes are part of this:

    - `imgadm sources -v` gives tabular output with the source *type*
    - `imgadm sources -c`
    - `imgadm -v` used to result in *debug*-level logging, now it results in
      *trace*-level

- `imgadm list [<filters>]` support for filtering with 'field=value'
  arguments. E.g., `imgadm list type=docker`.

- Add the `imgadm ancestry <uuid>` command to list the full ancestry
  (i.e. walk the `origin` chanin) of the given installed image.


## 2.6.13

- [OS-2989] Fix 'imgadm import UUID' *when importing from a DSAPI source*
  (e.g. https://datasets.joyent.com/datasets). This has been broken since
  v2.2.0. Note that import from an IMGAPI source (the default and more
  common) is fine.


## 2.6.12

- [OS-2981, joyent/smartos-live#322] Fix 'imgadm avail' crash with a DSAPI
  image source.


## 2.6.11

- [OS-2961] Fix a breakage in 'imgadm import' introduced in version 2.6.10.


## 2.6.10

Note: This was a bad version. Use 2.6.11 or later.

- [IMGAPI-395] Fix race in IMGAPI client that could result in
  spurious 'imgadm import' errors.
- [OS-2925] 'imgadm update' should include disabled images


## 2.6.9

- [OS-2903] Error out with 'OriginNotFoundInSource' instead of crashing if
  an attempt to import an image cannot proceed if the source IMGAPI does
  not have the image's origin image. (This is a bug in the source IMGAPI,
  but `imgadm` still should not crash.)


## 2.6.8

- [IMGAPI-373] `imgadm avail` now returns all images by making use of limit and
  marker implicitly instead of forcing the client to pass these values as
  command line options.


## 2.6.7

- [OS-2878] Fix 'imgadm import' broken in previous version.


## 2.6.6

Note: This was a bad version in which "imgadm import" was broken.
Use version 2.6.7 or later.

- Debug logging will include a "req_id", optionally taken from a `REQ_ID`
  environment variable.

- [OS-2203] 'imgadm import' and 'imgadm avail' will coordinate concurrent
  attempts to import the same image, instead of having all but one of them
  fail.


## 2.6.5

- [OS-2867] Add optional `config.userAgentExtra` for a string to append to
  the User-Agent in IMGAPI client usage.


## 2.6.4

- [OS-2484] Support for incremental of incremental image creation. Added
  --max-origin-depth to `imgadm create` to allow setting a limit in the number
  of child incremental images for an image.


## 2.6.3

- [OS-2657] Fix an issue where an error message with a printf formatting char
  could crash on error creation: loosing error details.


## 2.6.2

- [IMGAPI-312] `imgadm create` will set "requirements.min_platform" to the
  current platform for *SmartOS* images, to ensure proper binary compatibility
  -- in case the image includes binaries built on this platform.


## 2.6.1

- Include User-Agent header in requests to IMGAPI and DSAPI sources,
  e.g. "imgadm/2.6.1 (node/0.8.26; OpenSSL/1.0.1d)".

- [OS-2651] Fix 'imgadm create' wiping any given manifest.requirements.


## 2.6.0

- Change '-v, --verbose' option to mean *debug*-level logging (instead of
  trace-level in v2.3.0-v2.5.0). Also add support for the
  `IMGADM_LOG_LEVEL=<log level name>` environment variable, e.g.

        IMGADM_LOG_LEVEL=trace imgadm create ...

  Supported log level names are: trace, debug, info, warn (default), error,
  fatal.

- Improve debug logging for `imgadm create`.

## 2.5.0

- [OS-2600] `imgadm create -i ...` using a VM created from an *incremental*
  image explicitly fails with NotSupported.

- [OS-2550] `imgadm create -s <prepare-image-script> ...` support to automatic
  running of a preparation script, gated by VM snapshotting and rollback for
  safety. This makes image creation easier (fewer steps, do not need to
  manually prepare and stop the VM) and safer (snapshot/rollback ensures an
  unchanged and usable original VM on completion).

## 2.4.0

- Add `imgadm update [UUID...]` support for updating specific image uuids.

- [OS-2490] `imgadm update` should ensure imported images' snapshot is named
  `@final`

- [OS-1999] `imgadm update` on already installed image should re-fetch manifest
  for mutable field changes

## 2.3.1

- [OS-2487] 'imgadm import' will now not complain about not being able to
  delete -partial dataset on rollback (because sometimes it really isn't
  there yet).

- [OS-2488] Incremental imgadm creation (`imgadm create -i`) will not explicitly
  fail if the origin image does not have a '@final' snapshot on the origin image.
  Images installed with imgadm v2.0.3 or later will have this but images installed
  prior to that may not.

- [OS-2489] `imgadm create` will now properly fail (exit non-zero) on a failure
  of the `zfs send` command it is using internally. Previously in some cases it
  would not.

## 2.3.0

- [OS-2410] KVM support for 'imgadm create'.

- Drop the need for multiple '-v|--verbose' options to increase levels of
  verbosity. There is now the default logging output and verbose output (one or
  any number of '-v').


## 2.2.0

- [IMGAPI-124] Incremental image support. `imgadm create -i ...` will create
  an incremental image, i.e. an image that depends on the image used to
  create the source VM. This is called the "origin" and is stored on the
  `origin` field in the created image manifest.

  `imgadm import` and `imgadm install` now ensure that an image's origin is
  installed before the image itself is installed. `imgadm import` will attempt
  to automatically fetch the origin from current image sources.


## 2.1.1

- [OS-2315] Change from manually DNS resolving source URL hostnames and not
  checking SSL certificates, to *not* resolving hostnames (leave it to the
  OS) and checking SSL certificates. This is safer, but does mean that
  usage of custom imgadm sources over HTTPS and without a valid cert will
  fail. This can be worked around with the new `IMGADM_INSECURE=1`
  environment variable.

  This fixes a bug in 2.1.0 where https sources would always fail SSL
  certificate checks.


## 2.1.0

- [IMGAPI-95] Add 'imgadm publish' to publish a created image to an image
  repository (an IMGAPI). This command is currently *experimental* because
  it is incomplete and not fully vetted.

- [IMGAPI-95] Add 'imgadm create' to create a virtual image from a prepared
  VM. This is still not finalized. Creation of zvol images (i.e. for KVM VMs)
  is not yet supported. This command is currently *experimental* because
  it is incomplete and not fully vetted.


## 2.0.6

- Change to node-progbar for progress bars.


## 2.0.5

- [OS-2274] Fix `imgadm avail` to not crash if there was a problem accessing
  one or more of the sources. Also improve `imgadm avail` to show results
  from working sources even if one or more are not working.

## 2.0.4

- [OS-2218] Correct `imgadm list` to be able to list images with an origin,
  i.e. incremental images.

## 2.0.3

- [IMGAPI-152, smartos-live#204] Ensure that there is a '@final' snapshot
  of an imported image.

## 2.0.2

- `NoSourcesError: imgadm has no configured sources` now only raised for commands
  that need to use the source URLs.
- DNS resolution of source hosts is done lazily, so can `imgadm install` for example
  without internet access.

## 2.0.1

First version for this this changelog maintained.
