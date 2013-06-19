# imgadm(1m) -- Manage SmartOS virtual machine images

## SYNOPSIS

    imgadm help [<command>]                help on commands

    imgadm sources [<options>]             list and edit image sources

    imgadm avail                           list available images
    imgadm show <uuid>                     show manifest of an available image

    imgadm import [-P <pool>] <uuid>       import image from a source
    imgadm install [-P <pool>] -m <manifest> -f <file>
                                           import from local image data

    imgadm list                            list installed images
    imgadm get [-P <pool>] <uuid>          info on an installed image
    imgadm update                          gather info on unknown images
    imgadm delete [-P <pool>] <uuid>       remove an installed image


## DESCRIPTION

The imgadm tool allows you to interact with virtual machine images on a
SmartOS system. Virtual machine images (also sometimes referred to as
'datasets') are snapshots of pre-installed virtual machines which are
prepared for generic and repeated deployments.

Virtual machine images are made up of two primary components: A compressed
ZFS snapshot, and a manifest (metadata) which describes the contents of that
file. A ZFS snapshot may be of either a ZFS filesystem (for OS-level virtual
machines, a.k.a. zones), or a ZFS zvol (for KVM virtual machines).
The manifest is a JSON serialized description.

The identifier for an Image is its UUID. Most commands operate on Images by
UUID.

## OPTIONS

**-h**, **--help**
    Print tool (or subcommand) help and exit.

**--version**
    Print the imgadm version and exit.

## SUBCOMMANDS

    The following commands are supported:

      imgadm help [<command>]

        Print general tool help or help on a specific command.


      imgadm sources [<options>]

        List and edit image sources. An image source is a URL to a server
        implementing the Images API (IMGAPI). The default source is
        "https://images.joyent.com".

        Options:
            -j, --json         List sources as JSON.
            -a SOURCE          Add a source. It is appended.
            -d SOURCE          Delete a source.
            -e                 Edit sources in an editor.
            -f                 Force no "ping check" on new source URLs. By
                               default a ping check is done against new
                               source URLs to attempt to ensure they are a
                               running IMGAPI server.


      imgadm avail

        List available images from all sources.

        Options:
            -j, --json         JSON output
            -H                 Do not print table header row
            -o field1,...      Specify fields (columns) to output. Default is
                               "uuid,name,version,os,published".
            -s field1,...      Sort on the given fields. Default is
                               "published_at,name".

        Valid fields for "-o" and "-s" are: source, uuid, owner, name,
        version, state, disabled, public, published, published_at,
        published_date, type, os, urn, nic_driver, disk_driver, cpu_type,
        image_size, generate_passwords, description.


      imgadm show <uuid>

        Show the manifest for an available image. This searches each imgadm
        source for an available image with this UUID and prints its manifest
        (in JSON format).


      imgadm import [-P <pool>] <uuid>

        Import an image from a source IMGAPI. This finds the image with the
        given UUID in the configured sources and imports it into the local
        system.

        Options:
            -P <pool>          Name of zpool in which to import the image.
                               Default is "zones".
            -q, --quiet        Disable progress bar.


      imgadm install [-P <pool>] -m <manifest> -f <file>

        Install an image from local manifest and image data files.

        Options:
            -h, --help         Print this help and exit.
            -m MANIFEST        Required. Path to the image manifest file.
            -f FILE            Required. Path to the image file to import.
            -P <pool>          Name of zpool in which to import the image.
                               Default is "zones".
            -q, --quiet        Disable progress bar.


      imgadm list

        List locally installed images.

        Options:
            -j, --json         JSON output
            -H                 Do not print table header row
            -o field1,...      Specify fields (columns) to output. Default is
                               "uuid,name,version,os,published".
            -s field1,...      Sort on the given fields. Default is
                               "published_at,name".

        A heuristic is used to determine which ZFS datasets are images
        (any filesystem or volume named 'POOL/UUID' whose mountpoint is not
        a zoneroot). If this includes datasets that it should not, you can
        tell imgadm to ignore them via: `zfs set imgadm:ignore=true DATASET`.

        Valid fields for "-o" and "-s" are: source, uuid, owner, name,
        version, state, disabled, public, published, published_at, type, os,
        urn, nic_driver, disk_driver, cpu_type, image_size,
        generate_passwords, description, clones, zpool.


      imgadm get [-P <pool>] <uuid>

        Get local information for an installed image (JSON format).

        Options:
            -r                 Recursively gather children (child snapshots
                               and dependent clones).
            -P <pool>          Name of zpool in which to look for the image.
                               Default is "zones".

      imgadm update

        Gather info on unknown images.

        Images that are installed without "imgadm" (e.g. via "zfs recv") will
        not have cached image manifest information. This command will attempt
        to retrieve this information from current image sources based on
        image UUID.

      imgadm delete [-P <pool>] <uuid>

        Delete an image from the local zpool. The removal can only succeed if
        the image is not actively in use by a VM -- i.e. has no dependent
        ZFS children. "imgadm get -r <uuid>" can be used to show dependent
        children.

        Options:
            -P <pool>          Name of zpool from which to delete the image.
                               Default is "zones".


## COMPATIBILITY NOTES

    The imgadm tool was re-written for version 2. There are a few minor
    compatibility differences with earlier imgadm. These are:

    - "imgadm show <uuid>" no longer includes the non-standard "_url" field.
      The equivalent data is now in the "source" field of "imgadm info
      <uuid>".
    - "imgadm update" used to be required to fetch current available image
      manifests from the image source(s). That is no longer required.
      However, "imgadm update" remains and now fetches image manifests for
      **locally install images that were not installed by imgadm**. If there
      are none, then "imgadm update" is a no-op.
    - "imgadm list" default output columns have changed from
      "UUID, OS, PUBLISHED, URN" to "UUID, NAME, VERSION, OS, PUBLISHED".
      The image "urn" field is now deprecated, hence the change. The old
      output can be achieved via: "imgadm list -o uuid,os,published,urn"
    - The internal database dir has changed from "/var/db/imgadm" to
      "/var/imgadm". One side-effect of this is that one can no longer edit
      image sources by editing "/var/db/imgadm/sources.list". The "imgadm
      sources" command should now be used for this.
    - "imgadm info <uuid>" output no longer includes the (previously
      undocumented) "volume" key.


## EXIT STATUS

The following exit values are returned:

    0
        Successful completion.

    1
        An error occurred.

    2
        Usage error.

    3
        "ImageNotInstalled" error. Returned when an operation is requested
        on an image UUID that needs to be installed, but is not.


## SEE ALSO

    vmadm(1m), zfs(1m)
