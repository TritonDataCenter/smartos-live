# imgadm(1m) -- Manage SmartOS virtual machine images

## SYNOPSIS

    imgadm help [<command>]             help on commands

    imgadm sources [<options>]          list and edit image sources

    imgadm avail                        list available images
    imgadm show <uuid>                  show manifest of an available image

    imgadm import [-P <pool>] <uuid>    import image from a source
    imgadm install [-P <pool>] -m <manifest> -f <file>
                                        import from local image data

    imgadm list                         list installed images
    imgadm get [-P <pool>] <uuid>       info on an installed image
    imgadm update                       gather info on unknown images
    imgadm delete [-P <pool>] <uuid>    remove an installed image

    # Experimental.
    imgadm create [-p <url>] <uuid> [<manifest-field>=<value> ...]
                                        create an image from a prepared VM
    imgadm publish -m <manifest> -f <file> <imgapi-url>
                                        publish an image to an image repo

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

**-v, --verbose**
    More verbose logging. Use multiple times for more verbosity.


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
            -m <manifest>      Required. Path to the image manifest file.
            -f <file>          Required. Path to the image file to import.
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
            -h, --help         Print this help and exit.
            -P <pool>          Name of zpool from which to delete the image.
                               Default is "zones".


    imgadm create [-p <url>] <uuid> [<manifest-field>=<value> ...]

        **Experimental. This command currently does not work on KVM zones.**
        Create a new image from a prepared and stopped VM.

        To create a new virtual image, one first creates a VM from an existing
        image, customizes it, runs "sm-prepare-image", shuts it down, and
        then runs this "imgadm create" to create the image file and manifest.

        This will snapshot the VM, create a manifest and image file and
        delete the snapshot. Optionally the image can be published directly
        to a given image repository (IMGAPI) via "-p URL" (or that can be
        done separately via "imgadm publish").

        Usage:
            imgadm create [<options>] <uuid> [<manifest-field>=<value> ...]

        Options:
            -h, --help     Print this help and exit.
            -m <manifest>  Path to image manifest data (as JSON) to
                           include in the created manifest. Specify "-"
                           to read manifest JSON from stdin.
            -o PATH, --output-template PATH
                           Path prefix to which to save the created manifest
                           and image file. By default "NAME-VER.imgmanifest
                           and "NAME-VER.zfs[.EXT]" are saved to the current
                           dir. If "PATH" is a dir, then the files are saved
                           to it. If the basename of "PATH" is not a dir,
                           then "PATH.imgmanifest" and "PATH.zfs[.EXT]" are
                           created.
            -c COMPRESSION One of "none", "gz" or "bzip2" for the compression
                           to use on the image file, if any. Default is "none".

            -p URL, --publish URL
                           Publish directly to the given image source
                           (an IMGAPI server). You may not specify both
                           "-p" and "-o".
            -q, --quiet    Disable progress bar in upload.

        Arguments:
            <uuid>         The UUID of the prepared and shutdown VM
                           from which to create the image.
            <manifest-field>=<value>
                           Zero or more manifest fields to include in
                           in the created manifest. The "<value>" is
                           first interpreted as JSON, else as a string.
                           E.g. 'disabled=true' will be a boolean true
                           and both 'name=foo' and 'name="true"'
                           will be strings.

        Examples:
            # Create an image from the prepared and shutdown VM
            # 5f7a53e9-fc4d-d94b-9205-9ff110742aaf, using some manifest JSON
            # data from stdin.
            echo '{"name": "foo", "version": "1.0.0"}' \
                | imgadm create -m - 5f7a53e9-fc4d-d94b-9205-9ff110742aaf

            # Specify manifest data as arguments.
            imgadm create 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \
                name=foo version=1.0.0

            # Write the manifest and image file to "/var/tmp".
            imgadm create 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \
                name=foo version=1.0.0 -o /var/tmp

            # Publish directly to an image repository (IMGAPI server).
            imgadm create 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \
                name=foo version=1.0.0 --publish https://images.example.com

    imgadm publish

        **Experimental.** Publish an image from local manifest and image
        data files.

        Typically the local manifest and image file are created with
        "imgadm create ...". Note that "imgadm create" supports a
        "-p/--publish" option to publish directly in one step.

        Usage:
            imgadm publish [<options>] -m <manifest> -f <file> <imgapi-url>

        Options:
            -h, --help         Print this help and exit.
            -m <manifest>      Required. Path to the image manifest to import.
            -f <file>          Required. Path to the image file to import.
            -q, --quiet        Disable progress bar.


## COMPATIBILITY NOTES

The imgadm tool was re-written for version 2. There are a few minor
compatibility differences with earlier imgadm. These are:

- "imgadm show <uuid>" no longer includes the non-standard "_url" field.
  The equivalent data is now in the "source" field of "imgadm info
  <uuid>".
- "imgadm update" used to be required to fetch current available image
  manifests from the image source(s). That is no longer required.
  However, "imgadm update" remains (for backwards compat) and now fetches
  image manifests for **locally install images that were not installed by
  imgadm**. If there are none, then "imgadm update" is a no-op.
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


## ENVIRONMENT

    IMGADM_INSECURE

        Set to 1 to allow an imgadm source URL that uses HTTPS to a server
        without a valid SSL certificate.


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
