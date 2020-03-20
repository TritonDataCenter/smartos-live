# Upgrading Development Zones

Over time, we update the base development environment that everyone is using.
The current target is the x86_64 2019.4.x image series as noted in
[the SmartOS Getting Started Guide](../README.md#importing-the-zone-image).

The purpose of this guide is to describe how an **existing** development zone
should be upgraded from one version of pkgsrc to the next.
Since previous supported devzone was 2018.4, upgrades to 2019.4 are
straightforward.

If  an In the past, because pkgsrc versions were compatible, we've been able to
upgrade devzones in place (e.g. use pkgin and pkg_* utilities to upgrade from
2015.4.x -> 2016.4)

If you are upgrading from an earlier image (e.g. 2016.4) the process is more
disruptive as we're going from a `multiarch` release to an `x86_64` release,
which needs an entirely new /opt/local installation as pkgsrc cannot be
upgraded across this sort of boundary.

The simplest and safest route is to simply create a [fresh
zone](../README.md#setting-up-a-build-environment)

However, if you have customisations in your zone, reinstalling may be
time-consuming. This guide documents a procedure to allow you to upgrade
without provisioning a new devzone. Unfortunately due to the nature of the
upgrade, it cannot be complete for every use case, and you will likely need
to take additional steps to preserve and restore your configuration.

If you have advice on what else we could add to these instructions, please
do get in touch.

## Preparing to Upgrade

### Snapshot package list

First, it's helpful to snapshot the package list that you have
installed. You should do this by running:

```
pkg_info -u | cut -d' ' -f1 | sort > /package.list
```

Aside: normally, we would produce this list using:

```
pkgin export | sort > /package.list
```

but we believe a bug in pkgin from 2016 causes the resulting list to
be empty. That bug was fixed by the time 2018Q4 was released.

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
[triton](https://github.com/joyent/node-triton#node-triton) tool. If you
have not already, follow the
[setup](https://github.com/joyent/node-triton#setup) instructions such
that you can point it at the system with your instance.

First, identify the name of the instance that you are working on. This
can usually be done by running `triton inst list`. For example:

```
$ triton inst list
SHORTID   NAME       IMG                        STATE    FLAGS  AGE
122fff4d  march-dev  base-64-lts@19.4           running  -      2m
b80d08de  python     base-multiarch-lts@15.4.1  running  -      2y
2de86964  iasl       ubuntu-16.04@20161004      running  -      1y
```

In this case, we're interested in upgrading the instance called
`march-dev`. Next we create a snapshot and verify it exists:

```
$ triton inst snapshot create --name=2019.4-upgrade march-dev
Creating snapshot 2019.4-upgrade of instance march-dev
$ triton inst snapshot list march-dev
NAME            STATE    CREATED
2019.4-upgrade  created  2020-02-04T18:40:14.000Z
```

#### Manual Snapshots in SmartOS

When you're not running in a Triton environment, you can use vmadm to
create the snapshot. First, find the VM you want to use in vmadm list.
Then you use the `create-snapshot` option.

```
# vmadm list
UUID                                  TYPE  RAM      STATE             ALIAS
79809c3b-6c21-4eee-ba85-b524bcecfdb8  OS    4096     running           multiarch
# vmadm create-snapshot 79809c3b-6c21-4eee-ba85-b524bcecfdb8 2019.4-upgrade
Created snapshot 2019.4-upgrade for VM 79809c3b-6c21-4eee-ba85-b524bcecfdb8
```

If your VM has delegated snapshots, you won't be able to use `vmadm` to take
snapshots. In this case (and assuming you have CLI access to the global zone)
you should take a manual recursive snapshot of the VM instead:

```
# zfs snapshot -r zones/79809c3b-6c21-4eee-ba85-b524bcecfdb8@2019.4-upgrade
```

You will not be able to use `vmadm` to roll-back to snapshots created with
`zfs`, so you would need to use manual zfs commands to do so. You should
halt the VM before attempting such a rollback.

## Upgrading from 2018.4

At this point we will be taking steps which will potentially break your
development zone. If you encounter problems, please don't hesitate to
reach out for assistance.

This is the simplest upgrade that you can do, though again, creating a new
dev zone may be an easier option for many.

First we remove some packages that are no longer needed in 2019Q4. Their
replacement package will be installed automatically by the smartos-live.git
`configure` script after we have upgrade the devzone.

```
root@smartos-build-64 /]# pkgin rm dmake sgstools rpcgen astmsgtools
4 packages to delete:
  dmake-20130927 sgstools-20130402 rpcgen-20130402 astmsgtools-20130402

proceed ? [Y/n] y
removing dmake-20130927...
removing sgstools-20130402...
removing rpcgen-20130402...
removing astmsgtools-20130402...
pkg_install warnings: 0, errors: 0
reading local summary...
processing local summary...
[root@smartos-build-64 /]#
```

Next we need to edit the pkgin metadata to point to the new repository.
The files we need to edit are `/opt/local/etc/pkgin/repositories.conf`
and `/opt/local/etc/pkg_install.conf`. Note, you will need to have root
privileges to edit these files. First, let's look at `pkg_install.conf`.

```
# cat /opt/local/etc/pkg_install.conf
GPG_KEYRING_PKGVULN=/opt/local/share/gnupg/pkgsrc-security.gpg
GPG_KEYRING_VERIFY=/opt/local/etc/gnupg/pkgsrc.gpg
PKG_PATH=https://pkgsrc.joyent.com/packages/SmartOS/2018Q4/x86_64/All
VERIFIED_INSTALLATION=always
```

We need to change the `PKG_PATH` line. It should now refer to 2019Q4.
The full line would be:

```
PKG_PATH=https://pkgsrc.joyent.com/packages/SmartOS/2019Q4/x86_64/All
```

Next, we need to make a similar change in repositories.conf. Inside of
it you will find a single uncommented line:
`https://pkgsrc.joyent.com/packages/SmartOS/2018Q4/x86_64/All`. Again
here, we should change from 2018Q4 to 2019Q4.

### Update pkgin and pkg_install

The next step is to update the `pkgin` and `pkg_install` packages which
are used to manage and install everything else. To do so, run the
following commands. Note, a lot of output will show up from this which
we've included below:

```
[root@smartos-build-64 /]# PKG_PATH=http://pkgsrc.joyent.com/packages/SmartOS/2019Q4/x86_64/All pkg_add -U pkg_install pkgin libarchive
===========================================================================
The following files are no longer being used by pkgin-0.11.6nb1,
and they can be removed if no other packages are using them:

	/opt/local/etc/pkgin/repositories.conf

===========================================================================
===========================================================================
The following directories are no longer being used by pkgin-0.11.6nb1,
and they can be removed if no other packages are using them:

	/opt/local/etc/pkgin
	/var/db/pkgin

===========================================================================
===========================================================================
The following directories are no longer being used by openssl-1.0.2p,
and they can be removed if no other packages are using them:

	/opt/local/etc/openssl/certs

===========================================================================
openssl-1.1.1d: copying /opt/local/share/examples/openssl/openssl.cnf to /opt/local/etc/openssl/openssl.cnf
pkgin-0.15.0: /opt/local/etc/pkgin/repositories.conf already exists
===========================================================================
$NetBSD: MESSAGE,v 1.3 2010/06/10 08:05:00 is Exp $

First steps before using pkgin.

. Modify /opt/local/etc/pkgin/repositories.conf to suit your platform
. Initialize the database :

	# pkgin update
```

### Clean up pkgin database

The pkgin repository database needs to be removed. To do that you will
need to run the following command:

```
# rm -rf /var/db/pkgin
```

### Updating packages

Finally, the moment of truth. It's time to update all of your installed
packages. You should do this by running a pkgin full-upgrade. The list
of packages to be upgraded will vary based on the zone and what you have
installed. You should see something similar to, but somewhat different:

```
[root@smartos-build-64 /]# pkgin full-upgrade
calculating dependencies...done.

32 packages to refresh:
  readline-7.0 p5-GSSAPI-0.28nb9 zip-3.0nb3 less-530 mkfontscale-1.1.3
  pcre2-10.32 p5-Authen-SASL-2.16nb6 gettext-tools-0.19.8.1nb1
  freetype2-2.9.1nb1 git-docs-2.20.1 git-base-2.20.1 rsyslog-8.38.0nb1
  python27-2.7.15nb1 py27-sqlite3-2.7.15nb14 py27-expat-2.7.15
  openldap-client-2.4.47 openjdk7-1.7.141nb9 npm-6.4.1 nodejs-10.14.2nb1
  nghttp2-1.35.1nb2 nasm-2.14 mkfontdir-1.0.7 libpsl-0.20.2nb2 gettext-0.19.8.1
  gawk-4.2.1 fontconfig-2.13.1 dejavu-ttf-2.37 cyrus-sasl-2.1.27
  cwrappers-20180325 curl-7.64.0 build-essential-1.3
  bootstrap-mk-files-20180901

8 packages to upgrade:
  wget-1.20.1 sudo-1.8.28nb1 postfix-3.3.3 pkgsrc-gnupg-keys-20190423
  ncurses-6.1nb5 mit-krb5-1.16.2nb2 icu-63.1nb2 bzip2-1.0.8

32 to refresh, 8 to upgrade, 0 to install
179M to download, 729K to install

proceed ? [Y/n]
```

At this point, to proceed, reply yes. Everything should install
successfully. You should verify the last lines of output. There may be
errors that show up. If so please reach out for additional assistance so
we can review the error log and determine what happened:

```
...
pkg_install warnings: 0, errors: 0
reading local summary...
processing local summary...
#
```

If you do have a non-zero error log, we recommend that you copy the error log
for analysis:

```
# cp /var/db/pkgin/pkg_install-err.log ~/upgrade.log
#
```

Now, skip to the section 'Testing', later in this document.


## Upgrading from an earlier release

The approach above worked because both 2018.4 and 2019.4 were both "x86-64"
releases. Earlier SmartOS devzones were "multiarch", and cannot be as easily
upgraded.

The approach we describe here is to cleanly shutdown services that
are running from /opt/local, move /opt/local aside, install the 2018Q4
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

### Clean up pkgin database

The pkgin repository database needs to be removed. To do that you will
need to run the following command:

```
rm -rf /var/db/pkgin
```

### Move aside /opt/local and bootstrap the new pkgsrc install

The instructions in this step are an abbreviated version of the [pkgsrc illumos
installation](http://pkgsrc.joyent.com/install-on-illumos/) instructions.

Note that the old /opt/local directory is saved to /opt/local.bak

```
cd /var/tmp
curl -O https://pkgsrc.joyent.com/packages/SmartOS/bootstrap/bootstrap-2019Q4-x86_64.tar.gz
mv /opt/local/ /opt/local.bak
tar xzf bootstrap-2019Q4-x86_64.tar.gz -C /
pkg_add -U pkgin
```

### Reinstall packages

Now that we've bootstrapped, we'd like to reinstall packages that were
previously installed. Noting that these may not map exactly, we prune the
old version numbers, and install the latest versions of each package.

Slightly complicating things, is the fact that the Illumos build needs
specific versions of certain packages. We'll avoid re-installing packages
in that set and let the smartos-live `configure` script install them for
us instead.

```
LIST=""
AVOID_PKGS="dmake sgstools rpcgen astmsgtools"
for package in $(/bin/cat /package.list); do
    VER=$(echo $package | /bin/awk -F- '{print $NF}')
    PKG=$(echo $package | /bin/sed -e "s/-$VER$//g")
    avoid=''
    for avoid_pkg in $AVOID_PKGS; do
        if [[ "$avoid_pkg" == "$PKG" ]]; then
            avoid=true
        fi
    done
    if [[ -n "$avoid" ]]; then
        continue
    fi
    LIST="$LIST $PKG"
done
pkgin in $LIST
```

At this point you will see output similar to:

```
calculating dependencies...done.

133 packages to install:
  png-1.6.36 libidn-1.34 libxcb-1.13.1 libXdmcp-1.1.2nb1 libXau-1.0.8nb1 libXrender-0.9.10nb1 freetype2-2.9.1nb1 fontconfig-2.13.1 xmlcatmgr-2.2nb1 p5-Net-SSLeay-1.85nb1
  p5-Net-LibIDN-0.12nb10 p5-Mozilla-CA-20180117nb1 p5-Socket6-0.29 p5-Net-IP-1.26nb6 p5-MIME-Base64-3.15nb4 p5-IO-Socket-INET6-2.72nb4 p5-Digest-MD5-2.55nb3 mit-krb5-1.16.2
  tcl-8.5.19 libXft-2.3.2nb2 libXext-1.3.3nb1 libX11-1.6.7 libunistring-0.9.10 libxml2-2.9.9 p5-GSSAPI-0.28nb9 p5-Digest-HMAC-1.03nb8 p5-Net-Domain-TLD-1.75nb2 p5-Net-DNS-1.19
  p5-IO-CaptureOutput-1.11.04nb4 p5-TimeDate-2.30nb5 p5-IO-Socket-SSL-2.060 tk-8.6.9 py27-pytz-2018.7 libfontenc-1.1.3nb1 db4-4.8.30 tcp_wrappers-7.6.4 libiconv-1.14nb3
  libffi-3.2.1nb4 nghttp2-1.35.1nb2 libssh2-1.8.0 libidn2-2.0.5 perl-5.28.1 pcre2-10.32 p5-Net-SMTP-SSL-1.04nb2 p5-MailTools-2.20nb1 p5-Error-0.17027 p5-Email-Valid-1.202nb2
  p5-Authen-SASL-2.16nb6 libtool-info-2.4.6 libtool-fortran-2.4.6nb1 libtool-base-2.4.6nb2 git-gitk-2.20.1 git-contrib-2.20.1 libgpg-error-1.33 py27-setuptools-40.6.3
  py27-babel-2.6.0 mkfontscale-1.1.3 mkfontdir-1.0.7 encodings-1.0.4nb1 libXfixes-5.0.3nb1 openldap-client-2.4.47 cyrus-sasl-2.1.27 gettext-lib-0.19.8.1 mpfr-4.0.1 gmp-6.1.2
  python27-2.7.15nb1 expat-2.2.6 libuuid-2.32.1 liblognorm-2.0.5 libfastjson-0.99.8 libestr-0.1.10 curl-7.64.0 libuv-1.24.1 libcares-1.15.0 icu-63.1nb2 http-parser-2.8.1
  pcre-8.42 gettext-tools-0.19.8.1nb1 gettext-m4-0.19.8.1nb1 gettext-asprintf-0.19.8.1 pkgconf-1.4.1nb1 m4-1.4.18nb1 libtool-2.4.6 gmake-4.2.1nb1 git-docs-2.20.1 git-base-2.20.1
  gcc7-7.3.0nb4 bison-3.0.4nb4 binutils-2.26.1nb1 automake-1.16.1 autoconf-2.69nb8 libltdl-2.4.6 git-2.20.1 libgcrypt-1.8.4 py27-genshi-0.7 zip-3.0nb3 unzip-6.0nb8
  libXtst-1.2.3nb1 libXi-1.7.9nb1 dejavu-ttf-2.37 libpsl-0.20.2nb2 sudo-1.8.26 gtar-base-1.30 smtools-20160926 zoneinit-1.6.9 gawk-4.2.1 py27-expat-2.7.15 rsyslog-8.38.0nb1
  findutils-4.6.0nb2 coreutils-8.29nb1 patch-2.7.6nb1 nodejs-10.14.2nb1 gsed-4.6 grep-3.1nb2 pigz-2.4 cdrtools-3.01nb1 py27-sqlite3-2.7.15nb14 gettext-0.19.8.1
  build-essential-1.3 postfix-3.3.2 squid-3.5.28nb1 diffutils-3.6 scmgit-2.0 flex-2.6.4 less-530 libxslt-1.1.32nb1 nasm-2.14 manifold-0.2.0 openjdk7-1.7.141nb9
  wget-1.20.1 p5-XML-Parser-2.44nb4 changepass-1.3.3

0 to refresh, 0 to upgrade, 132 to install
357M to download, 1009M to install

proceed ? [Y/n]
.
.
.
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
package does not exist in the 2019Q4 pkgsrc install, and that attempting to
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
pkg_info -u | cut -d' ' -f1 | sort > /package.list.new
/opt/local/bin/diff -y /package.list /package.list.new
```

Note that the packages normally installed by smartos-live's `configure`
script will be missing at this point. When you next run `configure` in
advance of doing a smartos-live build, they will be installed from
http://us-east.manta.joyent.com/Joyent_Dev/public/releng/pkgsrc.

At this point, you should be able to reboot your dev zone and have it
come up cleanly. Note that the following files in /etc will now lie to
you:

* /etc/motd
* /etc/pkgsrc_version

You may find it useful to manually update those files to correspond to
the /opt/local 2019Q4 pkgsrc installation.

## Testing

To test this, start a fresh clone of smartos-live and build. For
example:

```
$ git clone git://github.com/joyent/smartos-live test
$ cd test
$ ./configure && gmake live
$
```

Note that during the `configure` phase, if gcc49 does not exist on the
system, it will be installed as it's still needed for bootstrapping the
`proto.strap` gcc compiler used by the build.

## Cleaning Up

Once you're satisfied, you should go through and delete the snapshots
that you created in the beginning. To do so, you would either use the
`triton inst snapshot delete` or `vmadm delete-snapshot`.

## Known Issues

This section is a placeholder for issues users may encounter during upgrade.
To date, no issues have been encountered.
