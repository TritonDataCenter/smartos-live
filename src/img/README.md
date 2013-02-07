# imgadm -- manage VM images

`imgadm` is a tool for managing images on a local headnode or compute node. It
can import and destroy local images, present information about how they're
being used.  To find and install new images, imgadm speaks to a server
implementing the IMGAPI. The default and canonical IMGAPI server is the Joyent
Images repository at <https://images.joyent.com>.


# Test Suite

    /usr/img/test/runtests


# Development

    git clone git@github.com:joyent/smartos-live.git
    cd src/img
    # edit
    # build
    # test

In a SmartOS build "/usr/img/..." where this installs is read-only. You can
get a read/write "/usr" as follows:

    /usbkey/scripts/mount-image.sh -w

This will create a writeable copy of the platform in "/image". Make your
edits in "/image/usr/img/..." then re-package the platform and reboot
into it:

    /usbkey/scripts/umount-image.sh && reboot


Before commiting/pushing run `make prepush` and, if possible, get a code
review.
