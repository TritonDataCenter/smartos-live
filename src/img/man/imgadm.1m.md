imgadm(1m) -- Manage SmartOS Virtual Images
===========================================

## SYNOPSIS
    /usr/ds/sbin/imgadm <command> [-Pv] [command-specific arguments]

## DESCRIPTION

The imgadm tool allows you to interact with virtual images on a SmartOS system.
virtual images (also sometimes referred to as 'datasets') are snapshots of
pre-installed virtual machines which are preppared for generic and repeated
deployments.

Virtual Images are made up of two primary components: A compressed ZFS
snapshot, and a manifest which describes the contents of that file. A ZFS
snapshot may be of either a ZFS filesystem, or a ZFS zvol, which correspond to
both OS-level and HVM-level virtual machine types (Joyent and KVM brands). The
manifest is a JSON serialized description

The primary reference for an Image is its UUID. Most commands operate on Images
by UUID. In SmartOS, there are bash tab-completion rules which are included by
default, to make using UUIDs easier.


## COMMANDS

    The following commands and options are supported:

      list

        Lists all the images that are currently installed on this machine.
        Images in this list may be used as the "image_uuid" attribute in a
        VM JSON description.

      info <uuid>

        A terse list of information is printed to stdout. This includes
        properties such as uuid, name, version, os, description and type. The
        number of machines currently using this image are also listed

      available

        Lists all the available images from the list of servers in the
        sources.list file. The results from these servers are queried from the
        local cache. To upload the local cache, run 'imgadm update'

      import <uuid>

        Imports the image specified by uuid. The image is retrieved from the
        appropriate remote server, and installed to the local ZFS pool named
        "zones". After an image is imported, it can be used to launch machines.

      install -m <manifest> -f <imagefile>

        Installs the image from an on-disk copy of the manifest and image. Both
        the manifest and image must be specified. After the image is installed,
        it can be used to launch machines.

      show <uuid>

        Shows JSON formatted output about the local image and its usage.

      update

        Updates the local cache with the list of images available from all
        sources listed in the "sources.list". By default this file exists in
        "/var/db/imgadm/sources.list". An update will retrieve the list of
        manifests from each source and place them into a local cache file. Most
        operations will use the cache file with the exception of an import or
        an update.

      destroy <uuid>

        Destroys the local image specified by uuid. A destroy can only succeed
        if the image is not actively in use by a machine. Any dependent
        children preventing a destroy can be listed using the "show" command.

## EXAMPLES

    Example 1: Updating a list of Images from the default sources

        $ imgadm update

    Example 2: Listing all available images in the local cache

        $ imgadm available
          UUID             OS      PUBLISHED  URN
          f953e97e-4991... smartos 2012-02-07 sdc:sdc:nodejs:1.3.3

    Example 3: Importing an image to the local GZ

        $ imgadm import e483afce-10b2-11e1-86bc-ff468add832f
          e483afce-10b2-11e1-86bc-ff468add832f doesnt exist. continuing.
          e483afce-10b2-11e1-86bc-ff468add832f successfully installed
          image e483afce-10b2-11e1-86bc-ff468add832 successfully imported

## EXIT STATUS

The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.

## SEE ALSO

    vmadm(1m), zpool(1m), zfs(1m)

## NOTES

    None
