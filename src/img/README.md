# imgadm -- manage VM images

`imgadm` is a tool for managing images on a local headnode or compute node. It
can import and destroy local images, present information about how they're
being used.  To find and install new images, imgadm speaks to a server
implementing the IMGAPI. The default and canonical IMGAPI server is the Joyent
Images repository at <https://images.joyent.com>.


# Test Suite

    /usr/img/test/runtests

This can only be run in the global zone (GZ).


# Development

The src/img tree has not binary components, so you can get away
with faster edit/test cycle than having to do a full smartos platform
build and rebooting on it. Here is how:

    # On the target SmartOS GZ (e.g. MY-SMARTOS-BOX), make /usr/img
    # and /usr/man/man1m writeable for testing:
    ssh root@MY-SMARTOS-BOX
    rm -rf /var/tmp/img \
        && cp -RP /usr/img /var/tmp/img \
        && mount -O -F lofs /var/tmp/img /usr/img \
        && rm -rf /var/tmp/man1m \
        && cp -RP /usr/man/man1m /var/tmp/man1m \
        && mount -O -F lofs /var/tmp/man1m /usr/man/man1m

    # On a dev machine:
    # Get a clone of the repo.
    git clone git@github.com:joyent/smartos-live.git
    cd src/img

    # Make edits, e.g. change the version:
    vi package.json

    # Build a dev install image (in /var/tmp/img-install-image)
    # and rsync that to the target node.
    ./tools/dev-install root@MY-SMARTOS-BOX

    # Test that it worked by checking for the version change:
    ssh root@MY-SMARTOS-BOX imgadm --version

    # Or run the test suite:
    ssh root@MY-SMARTOS-BOX /var/img/test/runtests


Before commits, please (a) run the test suite on a test box per the notes
above and (b) maintain style by running `make check`.


# /var/imgadm/imgadm.conf

"/var/imgadm/imgadm.conf" is imgadm's config file. Typically it should not be
edited as most configuration is done via `imgadm ...` commands. For example,
the list of image repository (IMGAPI) "sources" is controlled via
`imgadm sources ...`.

    VAR             DESCRIPTION
    sources         Array of image repository (IMGAPI) sources used for
                    `imgadm avail`, `imgadm import`, etc. Use `imgadm sources`
                    to control this value.
    upgradedToVer   Automatically set by `imgadm` as it does any necessary
                    internal DB migrations.
    userAgentExtra  Optional string that is appended to the User-Agent header
                    when talking to an IMGAPI source.
