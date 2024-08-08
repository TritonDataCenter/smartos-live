# Upgrading Development Zones

Over time, we update the base development environment that everyone is using.
The current target is the x86_64 2021.4.x image series as noted in
[the SmartOS Getting Started Guide](../README.md#importing-the-zone-image).

The purpose of this guide is to describe how an **existing** development zone
(x86_64 2018.4) should be upgraded from one version of pkgsrc to the next
(x86_64 2021.4). In the past, the upgrade for this target was more disruptive
than previous ones, as we went from a `multiarch` release to an `x86_64`
release, which needed an entirely new /opt/local installation as pkgsrc
cannot upgraded across this sort of boundary.

The simplest and safest route still is to simply create a [fresh
zone](../README.md#setting-up-a-build-environment)

However, if you have customisations in your zone, reinstalling may be
time-consuming. This guide documents a procedure to allow you to upgrade
without provisioning a new devzone.

If you have advice on what else we could add to these instructions, please
do get in touch.

## Preparing to Upgrade

NOTE:  All pkgin and pkg_add instructions below should be done as root, or
with pfexec, or with sudo.

### Snapshot package list

First, it's helpful to snapshot the package list that you have
installed. You should do this by running:

```
pkgin export | sort > /package.list
```

### Cleaning up existing builds

Because all the base pkgsrc libraries that are used are going to
change, each build environment will need to be cleaned out. You should
identify the root of each smartos-live repository clone and for each
one, run the `gmake clean` target. This will cause all the builds to
be cleaned out.

### Backing up / Snapshotting

The next thing you should do is take a snapshot of your instance or
potentially back up important information. To snapshot your instance,
you can use the
[triton](https://github.com/TritonDataCenter/node-triton#node-triton)
tool. If you have not already, follow the
[setup](https://github.com/TritonDataCenter/node-triton#setup) instructions
such that you can point it at the system with your instance.

First, identify the name of the instance that you are working on. This
can usually be done by running `triton inst list`. For example:

```
$ triton inst list
SHORTID   NAME       IMG                        STATE    FLAGS  AGE
122fff4d  march-dev  base-multiarch-lts@16.4    running  -      3y
b80d08de  python     base-multiarch-lts@15.4.1  running  -      2y
2de86964  iasl       ubuntu-16.04@20161004      running  -      1y
```

In this case, we're interested in upgrading the instance called
`march-dev`. Next we create a snapshot and verify it exists:

```
$ triton inst snapshot create --name=2021.4-upgrade march-dev
Creating snapshot 2021.4-upgrade of instance march-dev
$ triton inst snapshot list march-dev
NAME            STATE    CREATED
2021.4-upgrade  created  2018-09-28T18:40:14.000Z
```

#### Manual Snapshots in SmartOS

When you're not running in a Triton environment, you can use vmadm to
create the snapshot. First, find the VM you want to use in vmadm list.
Then you use the `create-snapshot` option.

```
[root@00-0c-29-37-80-28 ~]# vmadm list
UUID                                  TYPE  RAM      STATE             ALIAS
79809c3b-6c21-4eee-ba85-b524bcecfdb8  OS    4096     running           multiarch
[root@00-0c-29-37-80-28 ~]# vmadm create-snapshot 79809c3b-6c21-4eee-ba85-b524bcecfdb8 2021.4-upgrade
Created snapshot 2021.4-upgrade for VM 79809c3b-6c21-4eee-ba85-b524bcecfdb8
```

If your VM has delegated snapshots, you won't be able to use `vmadm` to take
snapshots. In this case (and assuming you have CLI access to the global zone)
you should take a manual recursive snapshot of the VM instead:

```
[root@00-0c-29-37-80-28 ~]# zfs snapshot -r zones/79809c3b-6c21-4eee-ba85-b524bcecfdb8@pre-upgrade
```

You will not be able to use `vmadm` to roll-back to snapshots created with
`zfs`, so you would need to use manual zfs commands to do so. You should
halt the VM before attempting such a rollback.

## Upgrading

At this point we will be taking steps which will potentially break your
development zone. If you encounter problems, please don't hesitate to
reach out for assistance.

The approach we describe is to cleanly shutdown services that
are running from /opt/local, move /opt/local aside, install the 2021Q4
x86-64 pkgsrc bootstrap bundle. We then reinstall as many packages as
possible from the set that was previously manually installed, noting that
some packages may have been dropped from the pkgsrc repository.

### Shutdown running SMF services from /opt/local

First we need to determine which SMF services are running from /opt/local
in order to shut them down cleanly. We save a list of SMF manifests as
well as the SMF services and instances that were present.

You may choose to further prune this list to select only services that
were actually online at the time of upgrade.

```
cd /tmp
for mf in $(pkg_admin dump | grep svc/manifest | cut -d' ' -f2); do
    echo "Disabling services from $mf"
    echo $mf >> /old-smf-manifests.list
    for svc in $(svccfg inventory $mf); do
        svcadm disable $svc
        echo $svc >> /disabled-services.list
    done
done
```

Determining which SMF properties were set locally on SMF services or
SMF instances vs. which are the shipped defaults is tricky in SmartOS.

Doing a diff of the `svccfg -s <instance> listprop` against the output of:

```
# svccfg -s <instance>
svc:/instance> selectsnap initial
[initial]svc:/instance> listprop
```

can provide some answers (omitting the 'general/enabled' property group
in the comparison). As 'listprop' output adjusts to column width, stripping
spaces and sorting with `sed -e 's/ \+/ /g' | sort` will be necessary.

Unfortunately, that diff won't include a list of the properties modified
on the SMF _service_ itself since SMF snapshots in SmartOS do not track
properties set at the service level. To find those properties, it might
be possible to logically compare the XML produced from:

`svccfg -s <service> export`

against the shipped XML manifest from /opt/local, included in the list of
manifest files we found earlier.

The pkgsrc package `xmlstarlet` provides a command `xml canonic`, which when
run against an XML file, produces a canonical representation which could then
be used to determine modified properties. `xmllint` may also be used to
produce a view of a given pair of XML files in order to more easily compare
them.

### Update pkgin configuration from 2018.4 to 2021.4

NOTE:  This step is revertable if no subsequent steps are taken.

Edit these files:

```
/opt/local/etc/pkg_install.conf
/opt/local/etc/pkgin/repositories.conf
```

And change any instance of `2018Q4` to `2021Q4`, and any instance of
`pkgsrc.joyent.com` to `pkgsrc.smartos.org`.  There should be one
instance in each file.  Here's is a pre-upgrade view:

```
smartos-build(~)[0]% grep Q4 /opt/local/etc/pkg_install.conf 
PKG_PATH=https://pkgsrc.joyent.com/packages/SmartOS/2018Q4/x86_64/All
smartos-build(~)[0]% grep Q4 /opt/local/etc/pkgin/repositories.conf 
https://pkgsrc.joyent.com/packages/SmartOS/2018Q4/x86_64/All
smartos-build(~)[0]% 
```

and a post-upgrade view:

```
smartos-build-2(~)[0]% grep Q4 /opt/local/etc/pkg_install.conf 
PKG_PATH=https://pkgsrc.smartos.org/packages/SmartOS/2021Q4/x86_64/All
smartos-build-2(~)[0]% grep Q4 /opt/local/etc/pkgin/repositories.conf
https://pkgsrc.smartos.org/packages/SmartOS/2021Q4/x86_64/All
smartos-build-2(~)[0]% 
```

### Manually install necessary prerequisite upgrades

NOTE:  This step is NOT revertable once taken.

A few upgrades first need to be installed explicitly, to prevent dependency
tripping:

```
pkg_add -U libarchive pkg_install pkgin
```

Those will enable a 2021.4-savvy pkgin to perform the next step.

### Perform a full upgrade

Now that we've bootstrapped, we'd like to upgrade.

```
pkgin upgrade
```

The output should look like this:

```
smartos-build-2(~)[0]% pfexec pkg_add -U libarchive pkg_install pkgin
===========================================================================
The following directories are no longer being used by openssl-1.0.2p,
and they can be removed if no other packages are using them:

        /opt/local/etc/openssl/certs
  libgpg-error-1.43 libgcrypt-1.9.4 libfontenc-1.1.4 libffi-3.4.2nb1
  libfastjson-0.99.8nb1 libestr-0.1.11 libcares-1.18.1 libXi-1.8 libXft-2.3.4
  libXext-1.3.4 libXdmcp-1.1.3 libXau-1.0.9 libX11-1.7.3.1 less-563 lcms2-2.12
  jbigkit-2.1nb1 icu-70.1 http-parser-2.9.4 harfbuzz-3.1.2nb1 gtar-base-1.34
  gsed-4.8nb1 grep-3.7 gmp-6.2.1nb2 gmake-4.3nb3 glib2-2.70.2nb1
  git-gitk-2.34.1 git-2.34.1 giflib-5.2.1nb4 gettext-lib-0.21
  gettext-asprintf-0.21 gettext-0.21 gcc7-libs-7.5.0nb5 gcc7-7.5.0nb5
  gawk-5.1.1 freetype2-2.10.4 fontconfig-2.13.1nb5 findutils-4.8.0 expat-2.4.1
  encodings-1.0.5 emacs26-nox11-26.3nb1 diffutils-3.7 db4-4.8.30nb1
  cyrus-sasl-2.1.27nb2 curl-7.81.0 coreutils-9.0 cdrtools-3.02a10
  bmake-20200524nb1 bison-3.8.2 binutils-2.37 automake-1.16.5 autoconf-2.71nb1
  python27-2.7.18nb6 perl-5.34.0nb3 git-docs-2.34.1 git-contrib-2.34.1
  git-base-2.34.1nb1 gettext-tools-0.21nb3 gettext-m4-0.21
  p5-Net-SSLeay-1.90nb1 pcre2-10.39

7 packages to install:
  libXScrnSaver-1.2.3 brotli-1.0.9 blas-3.10.0 gcc10-10.3.0 lmdb-0.9.29
  graphite2-1.3.14 python39-3.9.9nb1

26 to refresh, 125 to upgrade, 7 to install
726M to download, 595M to install

proceed ? [Y/n] 
```

After the install has completed, you should review the install output,
and consult `/var/db/pkgin/pkg_install-err.log` to see if there are any
packages which failed to install which may be important.

### Re-enable SMF services

We can now enable the SMF services that were previously disabled. If you had
previously identified SMF properties that should be reset on your updated
instances, you should set those properties on instances before enabling them.

Similarly, if there were /opt/local/etc configuration files that need to be
restored or merged from any changes you may have made in /opt/local.bak/etc,
now is the time to do that.

Recall that before upgrading, we saved a list of old SMF manifests in
`/old-smf-manifests`. You should check that those manifest files still exist
on your new /opt/local pkgsrc installation.

If those manifests do not exist, then it's likely that the corresponding
package does not exist in the 2021Q4 pkgsrc install, and that attempting to
re-enable the SMF service post-upgrade will fail.

In that case, the SMF service should be deleted using:

```
svccfg -s <instance> delete
```

Otherwise, the services can now be enabled using:

```
svcadm restart manifest-import
for service in $(cat disabled-services.list) ; do
    svcadm enable -rs $service
done
```

During this command, we may see warnings about `svc:/milestone/network:default`
having a dependency on `svc:/network/physical`, which has multiple instances,
but this warning can be ignored.


### See what packages changed

Finally, we can compare which packages are now installed:

```
pkgin export | sort > /package.list.new
/opt/local/bin/diff -y /package.list /package.list.new
```

Note that the packages normally installed by smartos-live's `configure`
script might be missing at this point. When you next run `configure` in
advance of doing a smartos-live build, they will be installed from
http://us-central.manta.mnx.io/Joyent_Dev/public/releng/pkgsrc.

At this point, you should be able to build a post-OS-8349 (2021.4) revision
of smartos-live and repos.  NOTE that illumos-extra must be updated
concurrently with smartos-live. You may also reboot your dev zone and have it
come up cleanly. Note that the following files in /etc will now lie to you:

* /etc/motd
* /etc/pkgsrc_version

You may find it useful to manually update those files to correspond to
the /opt/local 2021Q4 pkgsrc installation.

## Testing

To test this, start a fresh clone of smartos-live and build. For
example:

```
$ git clone https://github.com/TritonDataCenter/smartos-live test
$ cd test
$ ./configure && gmake live
$
```

## Cleaning Up

Once you're satisfied, you should go through and delete the snapshots
that you created in the beginning. To do so, you would either use the
`triton inst snapshot delete` or `vmadm delete-snapshot`.

## Known Issues

This section is a placeholder for issues users may encounter during upgrade.
To date, no issues have been encountered.
