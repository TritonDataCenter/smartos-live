# imgadm(1M) -- Manage SmartOS virtual machine images

## SYNOPSIS

    imgadm help [<command>]                help on commands

    imgadm sources [<options>]             list and edit image sources

    imgadm avail [<filters>]               list available images
    imgadm show <uuid|docker-repo-tag>     show manifest of an available image

    imgadm import [-P <pool>] <uuid|docker repo:tag>
                                           import image from a source
    imgadm install [-P <pool>] -m <manifest> -f <file>
                                           import from local image data

    imgadm list [<filters>]                list installed images
    imgadm get [-P <pool>] <uuid>          info on an installed image
    imgadm update [<uuid>...]              update installed images
    imgadm delete [-P <pool>] <uuid>       remove an installed image
    imgadm ancestry [-P <pool>] <uuid>     show ancestry of an installed image
    imgadm vacuum [-n] [-f]                delete unused images

    imgadm create <vm-uuid> [<manifest-field>=<value> ...] ...
                                           create an image from a VM
    imgadm publish -m <manifest> -f <file> <imgapi-url>
                                           publish an image to an image repo

## DESCRIPTION

The imgadm tool allows you to import and manage virtual machine images on a
SmartOS system. Virtual machine images (also sometimes referred to as
'datasets') are snapshots of pre-installed virtual machines which are prepared
for generic and repeated deployments.

Virtual machine images are made up of two primary components: A compressed
ZFS snapshot, and a manifest (metadata) which describes the contents of that
file. A ZFS snapshot may be of either a ZFS filesystem (for OS-level virtual
machines, a.k.a. zones), or a ZFS zvol (for KVM virtual machines).
The manifest is a JSON serialized description.

The identifier for an image is its UUID. Most commands operate on images by
UUID.


## OPTIONS

**-h**, **--help**
    Print tool (or subcommand) help and exit.

**--version**
    Print the imgadm version and exit.

**-v, --verbose**
    Verbose logging: trace-level logging, stack on error. See the
    **IMGADM\_LOG\_LEVEL=<level>** environment variable.

**-E**
    On error, emit a structured JSON error object as the last line of stderr
    output.


## SUBCOMMANDS

    The following commands are supported:

    imgadm help [<command>]

        Print general tool help or help on a specific command.


    imgadm sources [<options>]

        List and edit image sources.

        An image source is a URL to a server implementing the IMGAPI, or
        the Docker Registry API. The default IMGAPI is https://images.joyent.com

        Usage:
            imgadm sources [--verbose|-v] [--json|-j]  # list sources
            imgadm sources -a <url> [-t <type>]        # add a source
            imgadm sources -d <url>                    # delete a source
            imgadm sources -e                          # edit sources
            imgadm sources -c                          # check current sources

        Options:
            -h, --help                Show this help.
            -v, --verbose             Verbose output. List source URL and TYPE.
            -j, --json                List sources as JSON.

            -a <source>               Add a source. It is appended to the list of
                                      sources.
            --add-docker-hub          A shortcut for "imgadm sources -t docker -a
                                      https://docker.io".
            -d <source>               Delete a source.
            -e                        Edit sources in an editor.
            -c, --check               Ping check all sources.

            -t <type>, --type=<type>  The source type for an added source. One of
                                      "imgapi" (the default), "docker", or "dsapi"
                                      (deprecated).
            -k, --insecure            Allow insecure (no server certificate checking)
                                      access to the added HTTPS source URL.
            -f, --force               Force no "ping check" on new source URLs. By
                                      default a ping check is done against new source
                                      URLs to attempt to ensure they are a running
                                      IMGAPI server.

        Examples:
            # Joyent's primary public image repository (defaults to "imgapi")
            imgadm sources -a https://images.joyent.com
            # Docker Hub
            imgadm sources -a https://docker.io -t docker
            # Legacy SDC 6.5 DSAPI (deprecated)
            imgadm sources -a https://datasets.joyent.com/datasets -t dsapi

    imgadm avail [<filters>]

        List available images from all sources.
        This is not supported for Docker sources.

        Usage:
            imgadm avail [<options>...]

        Options:
            -h, --help                Show this help.
            -j, --json                JSON output.
            -H                        Do not print table header row.
            -o FIELD,...              Specify fields (columns) to output. Default is
                                      "uuid,name,version,os,published".
            -s FIELD,...              Sort on the given fields. Default is
                                      "published_at,name".

        Fields for "-o" and "-s":
            Any of the manifest fields (see `imgadm avail -j` output) plus the
            following computed fields for convenience.

            published_date            just the date part of `published_at`
            published                 `published_at` with the milliseconds removed
            source                    the source URL, if available
            clones                    the number of clones (dependent images and VMs)
            size                      the size, in bytes, of the image file

            In addition if this is a docker image, then the following:

            docker_id                 the full docker id string
            docker_short_id           the short 12 character docker id
            docker_repo               the docker repo from which this image
                                      originates, if available
            docker_tags               a JSON array of docker repo tags, if available


    imgadm show <uuid|docker-repo-tag>

        Show the manifest for an available image. This searches each imgadm
        source for an available image with this UUID and prints its manifest
        (in JSON format).


    imgadm import [-P <pool>] <uuid|docker repo:tag>

        Import an image from a source IMGAPI.

        This finds the image with the given UUID in the configured sources
        and imports it into the local system.

        Options:
            -h, --help                Show this help.
            -q, --quiet               Disable progress bar.
            -P <pool>                 Name of zpool in which to look for the image.
                                      Default is "zones".


    imgadm install [-P <pool>] -m <manifest> -f <file>

        Install an image from local manifest and image data files.

        Options:
            -h, --help         Print this help and exit.
            -m <manifest>      Required. Path to the image manifest file.
            -f <file>          Required. Path to the image file to import.
            -P <pool>          Name of zpool in which to import the image.
                               Default is "zones".
            -q, --quiet        Disable progress bar.


    imgadm list [<filters>]

        List locally installed images.

        Usage:
            imgadm list [<options>...] [<filters>]

        Options:
            -h, --help                Show this help.
            -j, --json                JSON output.
            -H                        Do not print table header row.
            -o FIELD,...              Specify fields (columns) to output. Default is
                                      "uuid,name,version,os,published".
            -s FIELD,...              Sort on the given fields. Default is
                                      "published_at,name".
            --docker                  Limit and format list similar to `docker images`.

        Filters:
            FIELD=VALUE               exact string match
            FIELD=true|false          boolean match
            FIELD=~SUBSTRING          substring match

        Fields for filtering, "-o" and "-s":
            Any of the manifest fields (see `imgadm list -j` output) plus the
            following computed fields for convenience.

            published_date            just the date part of `published_at`
            published                 `published_at` with the milliseconds removed
            source                    the source URL, if available
            clones                    the number of clones (dependent images and VMs)
            size                      the size, in bytes, of the image file

            In addition if this is a docker image, then the following:

            docker_id                 the full docker id string
            docker_short_id           the short 12 character docker id
            docker_repo               the docker repo from which this image
                                      originates, if available
            docker_tags               a JSON array of docker repo tags, if available


    imgadm get [-P <pool>] <uuid>

        Get local information for an installed image (JSON format).

        Options:
            -r                 Recursively gather children (child snapshots
                               and dependent clones).
            -P <pool>          Name of zpool in which to look for the image.
                               Default is "zones".


    imgadm update [<uuid>...]

        Update currently installed images, if necessary.
        This does not yet support images from a "docker" source.

        Images that are installed without "imgadm" (e.g. via "zfs recv")
        not have cached image manifest information. Also, images installed
        prior to imgadm version 2.0.3 will not have a "@final" snapshot
        (preferred for provisioning and require for incremental image
        creation, via "imgadm create -i ..."). This command will attempt
        to retrieve manifest information and to ensure images have the correct
        "@final" snapshot, using info from current image sources.

        If no "<uuid>" is given, then update is run for all installed images.

        Options:
            -h, --help         Print this help and exit.
            -n, --dry-run      Do a dry-run (do not actually make changes).


    imgadm ancestry [-P <pool>] <uuid>

        List the ancestry (the "origin" chain) for the given incremental image.

        Usage:
            imgadm ancestry [<options>...] <uuid>

        Options:
            -h, --help                Show this help.
            -j, --json                JSON output.
            -H                        Do not print table header row.
            -o FIELD,...              Specify fields (columns) to output. Default is
                                      "uuid,name,version,published".
            -P <pool>                 Name of zpool in which to look for the image.
                                      Default is "zones".

        Fields for "-o":
            Any of the manifest fields (see `imgadm list -j` output) plus the
            following computed fields for convenience.

            published_date            just the date part of `published_at`
            published                 `published_at` with the milliseconds removed
            source                    the source URL, if available
            clones                    the number of clones (dependent images and VMs)
            size                      the size, in bytes, of the image file

            In addition if this is a docker image, then the following:

            docker_id                 the full docker id string
            docker_short_id           the short 12 character docker id
            docker_repo               the docker repo from which this image
                                      originates, if available
            docker_tags               a JSON array of docker repo tags, if available


    imgadm delete [-P <pool>] <uuid>

        Delete an image from the local zpool. The removal can only succeed if
        the image is not actively in use by a VM -- i.e. has no dependent
        ZFS children. "imgadm get -r <uuid>" can be used to show dependent
        children.

        Options:
            -h, --help         Print this help and exit.
            -P <pool>          Name of zpool from which to delete the image.
                               Default is "zones".

    imgadm vacuum [-n] [-f]                delete unused images

        Remove unused images -- i.e. not used for any VMs or child images.

        Usage:
            imgadm vacuum [<options>]

        Options:
            -h, --help                Show this help.
            -n, --dry-run             Do a dry-run (do not actually make changes).
            -f, --force               Force deletion without prompting for confirmation.

    imgadm create [<options>] <vm-uuid> [<manifest-field>=<value> ...]

        Create an image from the given VM and manifest data.

        There are two basic calling modes: (1) a prepare-image script is
        provided (via "-s") to have imgadm automatically run the script inside the
        VM before image creation; or (2) the given VM is already "prepared" and
        shutdown.

        The former involves snapshotting the VM, running the prepare-image script
        (via the SmartOS mdata operator-script facility), creating the image,
        rolling back to the pre-prepared state. This is preferred because it is (a)
        easier (fewer steps to follow for imaging) and (b) safe (gating with
        snapshot/rollback ensures the VM is unchanged by imaging -- the preparation
        script is typically destructive.

        With the latter, one first creates a VM from an existing image, customizes
        it, runs "sm-prepare-image" (or equivalent for KVM guest OSes), shuts it
        down, runs this "imgadm create" to create the image file and manifest, and
        finally destroys the "proto" VM.

        With either calling mode, the image can optionally be published directly
        to a given image repository (IMGAPI) via "-p URL". This can also be
        done separately via "imgadm publish".

        Note: When creating an image from a VM with brand 'bhyve', 'lx', or
        'kvm', the resulting manifest will have requirements.brand set to match
        the brand of the source VM. If this is undesirable, the
        requirements.brand can be set (optionally empty if the resulting image
        should not have this value set) in the manifest passed with the '-m'
        option.

        Options:
            -h, --help     Print this help and exit.
            -m <manifest>  Path to image manifest data (as JSON) to
                           include in the created manifest. Specify "-"
                           to read manifest JSON from stdin.
            -o <path>, --output-template <path>
                           Path prefix to which to save the created manifest
                           and image file. By default "NAME-VER.imgmanifest
                           and "NAME-VER.zfs[.EXT]" are saved to the current
                           dir. If "PATH" is a dir, then the files are saved
                           to it. If the basename of "PATH" is not a dir,
                           then "PATH.imgmanifest" and "PATH.zfs[.EXT]" are
                           created.
            -c <comp>, --compression=<comp>
                           One of "none", "gzip", "bzip2" or "xz" for the compression
                           to use on the image file, if any. Default is "none".
            -i             Build an incremental image (based on the "@final"
                           snapshot of the source image for the VM).

            --max-origin-depth <max-origin-depth>
                           Maximum origin depth to allow when creating
                           incremental images. E.g. a value of 3 means that
                           the image will only be created if there are no more
                           than 3 parent images in the origin chain.

            -s <prepare-image-path>
                           Path to a script that is run inside the VM to
                           prepare it for imaging. Specifying this triggers the
                           full snapshot/prepare-image/create-image/rollback
                           automatic image creation process (see notes above).
                           There is a contract with "imgadm" that a
                           prepare-image script must follow. See the "PREPARE
                           IMAGE SCRIPT" section in "man imgadm".

            -p <url>, --publish <url>
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
            # Create an image from VM 5f7a53e9-fc4d-d94b-9205-9ff110742aaf.
            echo '{"name": "foo", "version": "1.0.0"}' \
                | imgadm create -m - -s /path/to/prepare-image \
                    5f7a53e9-fc4d-d94b-9205-9ff110742aaf

            # Specify manifest data as arguments.
            imgadm create -s prep-image 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \
                name=foo version=1.0.0

            # Write the manifest and image file to "/var/tmp".
            imgadm create -s prep-image 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \
                name=foo version=1.0.0 -o /var/tmp

            # Publish directly to an image repository (IMGAPI server).
            imgadm create -s prep-image 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \
                name=foo version=1.0.0 --publish https://images.example.com

            # Create an image from the prepared and shutdown VM
            # 5f7a53e9-fc4d-d94b-9205-9ff110742aaf, using some manifest JSON
            # data from stdin.
            echo '{"name": "foo", "version": "1.0.0"}' \
                | imgadm create -m - 5f7a53e9-fc4d-d94b-9205-9ff110742aaf


    imgadm publish [<options>] -m <manifest> -f <file> <imgapi-url>

        Publish an image (local manifest and data) to a remote IMGAPI repo.

        Typically the local manifest and image file are created with
        "imgadm create ...". Note that "imgadm create" supports a
        "-p/--publish" option to publish directly in one step.
        Limitation: This does not yet support *authentication* that some
        IMGAPI image repositories require.

        Options:
            -h, --help         Print this help and exit.
            -m <manifest>      Required. Path to the image manifest to import.
            -f <file>          Required. Path to the image file to import.
            -q, --quiet        Disable progress bar.


## PREPARE IMAGE SCRIPT

Image creation basically involves a `zfs send` of a customized *and prepared*
VM to a file for use in creating new VMs (along with a manifest file that
captures metadata about the image). "Customized" means software in the VM
is installed and setup as desired. "Prepared" means that the VM is cleaned up
(e.g. host keys removed, log files removed or truncated, hardcoded IP
information removed) and tools required for VM creation (e.g. zoneinit in
SmartOS VMs, guest tools for Linux and Windows OSes) are layed down.

As described above "imgadm create" has two modes: one where a prepare-image
script is given for "imgadm create" to run (gated by VM snapshotting and
rollback for safety); and another where one manually prepares and stops a VM
before calling "imgadm create". This section describes prepare-image and guest
requirements for the former.

The given prepare-image script is run via the SmartOS mdata
"sdc:operator-script" facility. This requires the guest tools in the VM to
support "sdc:operator-script" (SmartOS zones running on SDC 7.0 platforms
with OS-2515, from 24 Sep 2013, support this.)

For orderly VM preparation, a prepare-image script must implement the following
contract:

1. The script starts out by setting:

        mdata-put prepare-image:state running

2. On successful completion it sets:

        mdata-put prepare-image:state success

3. On error it sets:

        mdata-put prepare-image:state error
        mdata-put prepare-image:error '... some error details ...'

   These are not *required* as, obviously, `imgadm create`
   needs to reliably handle a prepare-image script *crash*. However setting
   these enables `imgadm create` to fail fast.

4. Shutdown the VM when done.

Preparing a VM for imaging is meant to be a quick activity. By
default there is a 5 minute timeout on state transitions: (VM booted) -> running
-> success or error -> (VM stopped).


## DOCKER INTEGRATION

Since version 3.0.0 imgadm has support for importing Docker images: both in
importing images of `type=docker` from an IMGAPI source and in importing Docker
images directly from Docker Hub. Docker registries other than Docker Hub are
technically supported, but client auth is not yet implemented.

Add the Docker Hub as an import source with:

    imgadm sources --add-docker-hub

Use the following to mimic `docker images`:

    imgadm list --docker

and list all Docker images (including intermediate layers) with:

    imgadm list type=docker

A subset of the full Docker "image json" metadata is stored as "docker:*"
tags on the image. E.g. for the current "busybox:latest":

    ...
    "tags": {
      "docker:id": "4986bf8c15363d1c5d15512d5266f8777bfba4974ac56e3270e7760f6f0a8125",
      "docker:architecture": "amd64",
      "docker:repo": "docker.io/library/busybox",
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


## COMPATIBILITY NOTES

Version 3 of "imgadm" added Docker image support. This involved a significant
refactoring of import and source handling leading to a few compatibility
differences with previous versions. These are:

- "imgadm sources -j" is an object for each source; previously each listed
  sources we just a string (the URL).
- "imgadm sources -e" includes type in edited lines.

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

    IMGADM_LOG_LEVEL

        Set the level at which imgadm will log to stderr. Supported levels are
        "trace", "debug", "info", "warn" (default), "error", "fatal".

    REQ_ID

        If provided, this value is used for imgadm's logging.


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

    vmadm(1M), zfs(1M)
