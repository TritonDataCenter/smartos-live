# Upgrading Development Zones

The purpose of this guide is to describe how a development zone should
be upgraded from one version of pkgsrc to the next. Over time, we update
the base development environment that everyone is using. The current
target is the multiarch 2016.4.x image series as noted in [the SmartOS
Getting Started Guide](../README.md#importing-the-zone-image).

This guide is intended to describe how to transition an **existing**
zone on either a 2014.4.x or 2015.4.x multiarch image in place. A much
simpler path is to simply create a [fresh
zone](../README.md#setting-up-a-build-environment). However, if there
is a lot of customization or work in this zone, then this guide will
help.

If you're using a zone image older than 2014.4, you should just create a
new zone or consider using the optional instructions in [Appendix:
upgrading from 2013.Q3](#appendix-upgrading-from-2013q3).

Again, just creating a new zone is going to be the simplest and safest
way to go about this.

## Preparing to Upgrade

### Snapshot package list

First, it's helpful to snapshot the package list that you have
installed. You should do this by running:

```
$ pkgin export > ~/package.list
```

### Cleaning up existing builds

Because all of the base pkgsrc libraries that are used are going to
change, each build environment will need to be cleaned out. You should
identify the root of each smartos-live repository clone and for each
one, run the `gmake clean` target. This will cause all of the builds to
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
122fff4d  march-dev  base-multiarch-lts@14.4.1  running  -      3y
b80d08de  python     base-multiarch-lts@15.4.1  running  -      2y
2de86964  iasl       ubuntu-16.04@20161004      running  -      1y
```

In this case, we're interested in upgrading the instance called
`march-dev`. Next we create a snapshot and verify it exists:

```
$ triton inst snapshot create --name=2016.4-upgrade march-dev
Creating snapshot 2016.4-upgrade of instance march-dev
$ triton inst snapshot list march-dev
NAME            STATE    CREATED
2016.4-upgrade  created  2018-09-28T18:40:14.000Z
```

#### Manual Snapshots in SmartOS

When you're not running in a Triton environment, you can use vmadm to
create the snapshot. First, find the VM you want to use in vmadm list.
Then you use the `create-snapshot` option.

```
[root@00-0c-29-37-80-28 ~]# vmadm list
UUID                                  TYPE  RAM      STATE             ALIAS
79809c3b-6c21-4eee-ba85-b524bcecfdb8  OS    4096     running           multiarch
[root@00-0c-29-37-80-28 ~]# vmadm create-snapshot 79809c3b-6c21-4eee-ba85-b524bcecfdb8 2016.4-upgrade
Created snapshot 2016.4-upgrade for VM 79809c3b-6c21-4eee-ba85-b524bcecfdb8
```

## Upgrading

At this point we will be taking steps which will potentially break your
development zone. If you encounter problems, please don't hesitate to
reach out for assistance.

### Update pkgin config files

First we need to edit the pkgin metadata to point to the new repository.
The files we need to edit are `/opt/local/etc/pkgin/repositories.conf`
and `/opt/local/etc/pkg_install.conf`. Note, you will need to have root
privileges to edit these files. First, let's look at `pkg_install.conf`.

```
# cat /opt/local/etc/pkg_install.conf
GPG_KEYRING_VERIFY=/opt/local/etc/gnupg/pkgsrc.gpg
GPG_KEYRING_PKGVULN=/opt/local/share/gnupg/pkgsrc-security.gpg
PKG_PATH=http://pkgsrc.joyent.com/packages/SmartOS/2014Q4/multiarch/All
VERIFIED_INSTALLATION=trusted
```

We need to change the `PKG_PATH` line. It should now refer to 2016Q4.
The full line would be:

```
PKG_PATH=http://pkgsrc.joyent.com/packages/SmartOS/2016Q4/multiarch/All
```

Next, we need to make a similar change in repositories.conf. Inside of
it you will find a single uncommented line:
`http://pkgsrc.joyent.com/packages/SmartOS/2014Q4/multiarch/All`. Again
here, we should change from 2014Q4 to 2016Q4.

### Update pkgin and pkg_install

The next step is to update the `pkgin` and `pkg_install` packages which
are used to manage and install everything else. To do so, run the
following command. Note, a lot of output will show up from this which
we've included below:

```
# pkg_add -U pkgin
===========================================================================
The following files are no longer being used by pkgin-0.9.4nb5,
and they can be removed if no other packages are using them:

        /opt/local/etc/pkgin/repositories.conf

===========================================================================
===========================================================================
The following directories are no longer being used by pkgin-0.9.4nb5,
and they can be removed if no other packages are using them:

        /opt/local/etc/pkgin
        /var/db/pkgin

===========================================================================
pkgin-0.9.4nb5: /opt/local/etc/pkgin/repositories.conf already exists
===========================================================================
$NetBSD: MESSAGE,v 1.3 2010/06/10 08:05:00 is Exp $

First steps before using pkgin.

. Modify /opt/local/etc/pkgin/repositories.conf to suit your platform
. Initialize the database :

        # pkgin update

===========================================================================

# pkg_add -U pkg_install
===========================================================================
$NetBSD: MESSAGE,v 1.6 2014/12/05 14:31:07 schmonz Exp $

You may wish to have the vulnerabilities file downloaded daily so that
it remains current.  This may be done by adding an appropriate entry
to a user's crontab(5) entry.  For example the entry

# download vulnerabilities file
0 3 * * * /opt/local/sbin/pkg_admin fetch-pkg-vulnerabilities >/dev/null
2>&1

will update the vulnerability list every day at 3AM. You may wish to do
this more often than once a day.

In addition, you may wish to run the package audit from the daily
security script.  This may be accomplished by adding the following
lines to /etc/security.local

if [ -x /opt/local/sbin/pkg_admin ]; then
        /opt/local/sbin/pkg_admin audit
fi

Alternatively this can also be acomplished by adding an entry to a
user's
crontab(5) file. e.g.:

# run audit-packages
0 3 * * * /opt/local/sbin/pkg_admin audit

Both pkg_admin subcommands can be run as as an unprivileged user,
as long as the user chosen has permission to read the pkgdb and to write
the pkg-vulnerabilities to /opt/local/pkg.

The behavior of pkg_admin and pkg_add can be customised with
pkg_install.conf.  Please see pkg_install.conf(5) for details.

If you want to use GPG signature verification you will need to install
GnuPG and set the path for GPG appropriately in your pkg_install.conf.
===========================================================================
```

### Switch config files to HTTPS

The next change is to go back and edit both
`/opt/local/etc/pkg_install.conf` and
`/opt/local/etc/pkgin/repositories.conf` and edit the URLs that have
HTTP to refer to HTTPS.

For `pkg_install.conf` the final value for the `PKG_PATH` line should
be:
`PKG_PATH=https://pkgsrc.joyent.com/packages/SmartOS/2016Q4/multiarch/All`.

For `repositories.conf` the final value shoud be
`https://pkgsrc.joyent.com/packages/SmartOS/2016Q4/multiarch/All`.

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
# pkgin fug
reading local summary...
processing local summary...
pkg_summary.xz                   100% 1924KB 481.0KB/s 452.0KB/s   00:04
calculating dependencies... done.

120 packages to be upgraded:

wget-1.16.1 unrar-5.2.2 sudo-1.7.10p9 rsyslog-8.6.0 postfix-2.11.6
p5-XML-Parser-2.43 nginx-1.7.10 netperf-2.6.0 nasm-2.11.06
mozilla-rootcerts-1.0.20141117nb1 mercurial-3.2.3 libxslt-1.1.28nb3
libpcap-1.4.0nb1 less-470 icu-54.1nb2 gtar-base-1.28 grep-2.21
ghostscript-9.05nb7 gettext-0.19.3 gawk-4.1.1 flex-2.5.39nb2
findutils-4.4.2 diffutils-3.3 diffstat-1.59 coreutils-8.22nb1
cdrtools-3.01alpha24nb1 bsdinstall-20130905 bmake-20140314 zip-3.0nb2
unzip-6.0nb2 pcre-8.36nb1 patch-2.7.4 mpfr-3.1.2pl11
py27-mercurial-3.2.3nb1 libuuid-2.24.2 libtool-2.4.2nb2 liblognorm-1.0.1
liblogging-1.0.4 libgcrypt-1.6.3 libestr-0.1.9 libXtst-1.2.2nb1
libXi-1.7.4 json-c-0.12nb2 gmp-6.0.0a gmake-4.1nb1 git-2.2.1
ghostscript-gpl-9.06nb4 gettext-asprintf-0.19.3 gettext-tools-0.19.3
gettext-m4-0.19.3 dejavu-ttf-2.34nb1 bootstrap-mk-files-20141122
bison-3.0.2nb1 binutils-2.24nb3 automake-1.14.1nb1 autoconf-2.69nb5
tiff-4.0.8nb1 readline-6.3nb3 mkfontscale-1.1.1 libtool-fortran-2.4.2nb5
libtool-base-2.4.2nb9 libgpg-error-1.17nb1 libffi-3.2.1 libXt-1.1.4
libXfixes-5.0.1 git-gitk-2.2.1 git-docs-2.2.1 git-base-2.2.1
zlib-1.2.8nb2 xz-5.0.7nb1 tk-8.6.3 perl-5.20.1 p5-Net-SMTP-SSL-1.01nb5
p5-MailTools-2.14 p5-Error-0.17022 p5-Email-Valid-1.195
p5-Authen-SASL-2.16nb2 ncurses-5.9nb4 libjpeg-turbo-1.3.0nb1
libfontenc-1.1.2 expat-2.1.0 curl-7.51.0 tcl-8.6.3 p5-TimeDate-2.30nb1
p5-Net-Domain-TLD-1.72 p5-Net-DNS-0.81 p5-IO-Socket-SSL-2.007
p5-IO-CaptureOutput-1.11.03 p5-GSSAPI-0.28nb5 p5-Digest-HMAC-1.03nb4
openldap-client-2.4.40 libidn-1.32 libX11-1.6.2nb1 libssh2-1.5.0
p5-Socket6-0.25 p5-Net-SSLeay-1.66 p5-Net-LibIDN-0.12nb6
p5-Net-IP-1.26nb2 p5-IO-Socket-INET6-2.72 mit-krb5-1.10.7nb5 libxcb-1.11
libXrender-0.9.8 libXdmcp-1.1.1 gettext-lib-0.19.3 fontconfig-2.11.1nb1
cyrus-sasl-2.1.26nb4 png-1.6.16

128 packages to be installed (258M to download, 172M to install):

png-1.6.27 p5-Socket6-0.28 p5-Net-SSLeay-1.78 p5-Net-LibIDN-0.12nb8
p5-Net-IP-1.26nb4 p5-IO-Socket-INET6-2.72nb2 mit-krb5-1.14.4 libxcb-1.12
libXrender-0.9.10 libXdmcp-1.1.2 gettext-lib-0.19.8.1 fontconfig-2.12.1
cyrus-sasl-2.1.26nb5 tcl-8.6.6nb2 p5-TimeDate-2.30nb3
p5-Net-Domain-TLD-1.75 p5-Net-DNS-1.06nb1 p5-IO-Socket-SSL-2.040
p5-IO-CaptureOutput-1.11.04nb2 p5-GSSAPI-0.28nb7 p5-Digest-HMAC-1.03nb6
openldap-client-2.4.44nb3 libidn-1.33 libX11-1.6.4 libssh2-1.8.0
zlib-1.2.8nb3 xz-5.2.2 tk-8.6.6 perl-5.24.0 p5-Net-SMTP-SSL-1.04
p5-MailTools-2.18nb1 p5-Error-0.17024nb2 p5-Email-Valid-1.202
p5-Authen-SASL-2.16nb4 ncurses-6.0nb3 libjpeg-turbo-1.5.0
libfontenc-1.1.3 libunistring-0.9.7 expat-2.2.4 curl-7.57.0nb1
tiff-4.0.9nb1 readline-7.0 mkfontscale-1.1.2 libtool-fortran-2.4.2nb6
libtool-base-2.4.2nb13 libgpg-error-1.25 libffi-3.2.1nb2 libXt-1.1.5
libXfixes-5.0.3 nghttp2-1.17.0nb1 libidn2-2.0.4 git-gitk-2.15.1
git-docs-2.15.1 git-base-2.15.1 zip-3.0nb3 unzip-6.0nb8 pcre-8.41
patch-2.7.5 p5-Mozilla-CA-20160104nb1 mpfr-3.1.5 py27-mercurial-4.0.1
libuuid-2.28.2 libtool-2.4.2nb3 liblognorm-2.0.3 liblogging-1.0.5
libgcrypt-1.8.1 libestr-0.1.10 libXtst-1.2.3 libXi-1.7.8 json-c-0.12.1
gmp-6.1.2 gmake-4.1nb3 pcre2-10.30nb1 git-2.15.1 ghostscript-gpl-9.06nb9
gettext-asprintf-0.19.8.1 gettext-tools-0.19.8.1 gettext-m4-0.19.8.1
dejavu-ttf-2.37 bootstrap-mk-files-20160908 bison-3.0.4nb3
binutils-2.26.1 automake-1.15nb4 autoconf-2.69nb7 wget-1.19.1nb2
unrar-5.4.5 sudo-1.8.21p2 libfastjson-0.99.6 rsyslog-8.28.0
py27-curses-2.7.12nb2 postfix-3.1.3nb1 p5-XML-Parser-2.44nb2
nginx-1.13.3 netperf-2.7.0 nasm-2.12.01nb1
mozilla-rootcerts-1.0.20160610 mercurial-4.0.1 libxslt-1.1.32
libpcap-1.7.4 less-481 icu-60.2nb1 gtar-base-1.29 grep-2.24nb1
git-contrib-2.15.1 ghostscript-9.05nb8 gettext-0.19.8.1 gawk-4.1.3
flex-2.6.3 findutils-4.6.0nb1 diffutils-3.4 diffstat-1.61
coreutils-8.25nb1 cdrtools-3.01nb1 bsdinstall-20160108 bmake-20150505

proceed ? [Y/n]
```

At this point, to proceed, reply yes. Everything should install
successfully. You should verify the last lines of output. There may be
errors that show up. If so please reach out for additional assistance so
we can review the error log and determine what happened:

```
...
pkg_install warnings: 0, errors: 3
pkg_install error log can be found in /var/db/pkgin/pkg_install-err.log
reading local summary...
processing local summary...
#
```

If you do have a non-zero error log, I recommend that copy the error log
for analysis:

```
# cp /var/db/pkgin/pkg_install-err.log ~/upgrade.log
#
```

## Testing

To test this, start a fresh clone of smartos-live and build. For
example:

```
$ git clone git://github.com/joyent/smartos-live test
$ cd test
$ cp sample.configure.smartos configure.smartos
$ ./configure && gmake live
$
```

## Cleaning Up

Once you're satisfied, you should go through and delete the snapshots
that you created in the beginning. To do so, you would either use the
`triton inst snapshot delete` or `vmadm delete-snapshot`.

## Known Issues

There are a number of issues that we've seen with this in the wild that
you may or may not encounter and you'll have to fix manually.

### gawk doesn't work

We've seen cases where when going from 2015.q4 to 2016.q4 gawk does not
properly get updated. You can see if this is the case by running gawk.
If you're in this case you'll see something like:

```
# gawk
ld.so.1: gawk: fatal: libreadline.so.6: open failed: No such file or
directory
Killed
```

The solution is to remove and reinstall gawk as follows:

```
# pkgin rm gawk
1 packages to delete:

gawk-4.1.3

proceed ? [Y/n] y
removing gawk-4.1.3...
gawk-4.1.3: unregistering info file /opt/local/info/gawk.info
gawk-4.1.3: unregistering info file /opt/local/info/gawkinet.info
pkg_install warnings: 0, errors: 0
reading local summary...
processing local summary...
pk[root@b80d08de-e649-43c9-9cc2-3229ae8b55b1 ~/smartos-live]# pkgin in
gawk
calculating dependencies... done.

nothing to upgrade.
1 packages to be installed (1222K to download, 4172K to install):

gawk-4.1.3

proceed ? [Y/n] y
downloading packages...
gawk-4.1.3.tgz
100% 1222KB   1.2MB/s   1.2MB/s   00:00
installing packages...
installing gawk-4.1.3...
gawk-4.1.3: registering info file /opt/local/info/gawk.info
gawk-4.1.3: registering info file /opt/local/info/gawkinet.info
pkg_install warnings: 0, errors: 0
reading local summary...
processing local summary...
marking gawk-4.1.3 as non auto-removable
#
```

## Appendix: Upgrading from 2013.Q3

The upgrade path from 2013.q3 is much more complicated. You should first
perform all of the [preparation steps](#preparing-to-upgrade). Next,
we're going to basically blow away the old pkgsrc install completely and
then install a fresh one. Please review the [pkgsrc illumos
installation](http://pkgsrc.joyent.com/install-on-illumos/)
instructions. What follows will be an abbreviated version of them.

```
# cd /var/tmp
# curl -O https://pkgsrc.joyent.com/packages/SmartOS/bootstrap/bootstrap-2016Q4-multiarch.tar.gz
# mv /opt/local/ /opt/local.bak
# rm -rf /var/db/pkgin/
# tar xzf bootstrap-2016Q4-multiarch.tar.gz -C /
# pkg_add -U openssl
# pkg_add -U pkgin
# pkgin update
# pkgin fug
```

At this point you should reinstall any packages that you previously had that
aren't part of a normal SmartOS build.
