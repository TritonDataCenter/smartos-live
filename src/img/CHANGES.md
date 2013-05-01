# imgadm changelog

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
