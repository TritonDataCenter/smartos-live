# imgadm changelog

## 2.3.1

- [OS-2487] 'imgadm import' will now not complain about not being able to
  delete -partial dataset on rollback (because sometimes it really isn't
  there yet).

- [OS-2488] Incremental imgadm creation (`imgadm create -i`) will not explcitly
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
