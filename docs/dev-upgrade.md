# Upgrading Development Zones

Over time, we update the base development environment that everyone is using.
The current target is the x86_64 2024.4.1 image series as noted in
[the SmartOS Getting Started Guide](../README.md#importing-the-zone-image).

The purpose of this guide is to describe how an **existing** development zone
(x86_64 2021.4) should be upgraded from one version of pkgsrc to the next
(x86_64 2024.4). In the past, the upgrade for this target was more disruptive
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
$ triton inst snapshot create --name=2024.4-upgrade march-dev
Creating snapshot 2024.4-upgrade of instance march-dev
$ triton inst snapshot list march-dev
NAME            STATE    CREATED
2024.4-upgrade  created  2025-04-18T18:40:14.000Z
```

#### Manual Snapshots in SmartOS

When you're not running in a Triton environment, you can use vmadm to
create the snapshot. First, find the VM you want to use in vmadm list.
Then you use the `create-snapshot` option.

```
[root@00-0c-29-37-80-28 ~]# vmadm list
UUID                                  TYPE  RAM      STATE             ALIAS
79809c3b-6c21-4eee-ba85-b524bcecfdb8  OS    4096     running           multiarch
[root@00-0c-29-37-80-28 ~]# vmadm create-snapshot 79809c3b-6c21-4eee-ba85-b524bcecfdb8 2024.4-upgrade
Created snapshot 2024.4-upgrade for VM 79809c3b-6c21-4eee-ba85-b524bcecfdb8
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

### Newer way

Follow the "Upgrade-in-Place" directions here:

	https://github.com/TritonDataCenter/pkgsrc/wiki/about:upgrades

### Older way

At this point we will be taking steps which will potentially break your
development zone. If you encounter problems, please don't hesitate to
reach out for assistance.

The approach we describe is to cleanly shutdown services that
are running from /opt/local, move /opt/local aside, install the 2024Q4
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

### Update pkgin configuration from 2021.4 to 2024.4

NOTE: This step is revertable if proper backups are made.  For reversability,
backup these files:

```
/opt/local/etc/mk.conf
/opt/local/etc/pkg_install.conf
/opt/local/etc/pkgin/repositories.conf
/opt/local/etc/gnupg/pkgsrc.gpg
```

Next, download this tarfile:

`https://pkgsrc.smartos.org/packages/SmartOS/bootstrap-upgrade/bootstrap-2024Q4-x86_64-upgrade.tar.gz`

And run the following extractor with privilege:

`gtar -xzvf ./bootstrap-2024Q4-x86_64-upgrade.tar.gz -C /.`

### Manually install necessary prerequisite upgrades

NOTE:  This step is NOT revertable once taken.

A few upgrades first need to be installed explicitly, to prevent dependency
tripping:

```
pkg_add -U libarchive pkg_install pkgin
```

Those will enable a 2024.4-savvy pkgin to perform the next step.

### Perform a full upgrade

Now that we've bootstrapped, we'd like to upgrade.

```
pkgin upgrade
```

The output should look similar to this:

```
smartos-build-2(/tmp)[0]% pfexec pkgin upgrade
pkgin: Dependency perl>=5.28.0<5.30.0 of p5-Digest-MD5-2.55nb3 unresolved
pkgin: Dependency perl>=5.28.0<5.30.0 of p5-MIME-Base64-3.15nb4 unresolved
processing remote summary (https://pkgsrc.smartos.org/packages/SmartOS/2024Q4/x86_64/All)...
pkg_summary.xz                                100% 2897KB 965.7KB/s   00:03    
calculating dependencies...done.

17 packages to refresh:
  bzip2-1.0.8 db4-4.8.30nb1 dejavu-ttf-2.37 emacs26-nox11-26.3nb1 flex-2.6.4
  http-parser-2.9.4 jbigkit-2.1nb1 libestr-0.1.11 libfastjson-0.99.8nb1
  liblognorm-2.0.6 patch-2.7.6nb1 pcre-8.45 pkg_alternatives-1.7
  pkg_install-info-4.5nb3 smartos-build-tools-20130927 xmlcatmgr-2.2nb1
  zip-3.0nb3

138 packages to upgrade:
  autoconf-2.72 automake-1.16.5nb3 binutils-2.41 bison-3.8.2nb1 blas-3.12.0
  bmake-20240909 bootstrap-mk-files-20240422 brotli-1.1.0
  bsdinstall-20160108nb1 cdrtools-3.02a10nb5 coreutils-9.5 curl-8.11.1nb1
  cwrappers-20220403 cyrus-sasl-2.1.28nb1 diffutils-3.10 emacs-29.4
  encodings-1.1.0 expat-2.6.3 findutils-4.9.0 fontconfig-2.15.0
  freetype2-2.13.3 gawk-5.3.0 gcc7-7.5.0nb6 gcc7-libs-7.5.0nb7 gettext-0.22.5
  gettext-asprintf-0.22.5 gettext-lib-0.22.5 gettext-m4-0.22.5
  gettext-tools-0.22.5 giflib-5.2.2 git-2.48.1 git-base-2.48.1
  git-contrib-2.48.1 git-docs-2.48.1 git-gitk-2.48.1 glib2-2.82.2 gmake-4.4.1
  gmp-6.3.0 go-1.23.4 go-hugo-0.136.4 graphite2-1.3.14nb3 grep-3.11 gsed-4.9nb1
  gtar-base-1.35 harfbuzz-10.1.0 icu-76.1nb1 lcms2-2.16 less-668 libX11-1.8.10
  libXScrnSaver-1.2.4 libXau-1.0.12 libXdmcp-1.1.5 libXext-1.3.6
  libXfixes-6.0.1 libXft-2.3.8nb1 libXi-1.8.2 libXrender-0.9.12 libXtst-1.2.5
  libcares-1.34.3 libffi-3.4.6 libfontenc-1.1.8 libgcrypt-1.11.0nb2
  libgpg-error-1.51 libiconv-1.17 libidn-1.42 libidn2-2.3.7 libjpeg-turbo-3.0.4
  liblinear-2.47 libpcap-1.10.5 libpsl-0.21.5 libssh2-1.11.1 libtool-2.4.7
  libtool-base-2.4.7nb1 libtool-fortran-2.4.7nb1 libtool-info-2.4.7
  libunistring-1.2 libuuid-2.32.1nb2 libuv-1.49.2 libxcb-1.17.0
  libxml2-2.12.9nb3 libxslt-1.1.42nb3 lmdb-0.9.33 m4-1.4.19nb1
  mit-krb5-1.21.3nb1 mkfontscale-1.2.3 mozilla-rootcerts-1.1.20241118
  mpfr-4.2.1 mtr-0.95nb8 nasm-2.16.01 nawk-20230909 nbsed-20240312nb2
  ncurses-6.5 nghttp2-1.64.0nb3 nmap-7.95 nodejs-23.3.0 openldap-client-2.6.9
  p5-Authen-SASL-2.1700nb1 p5-Digest-HMAC-1.05nb1 p5-Email-Valid-1.204nb1
  p5-Error-0.17029nb5 p5-GSSAPI-0.28nb16 p5-IO-CaptureOutput-1.1105nb5
  p5-IO-Socket-INET6-2.73nb3 p5-IO-Socket-SSL-2.089nb1 p5-MailTools-2.22
  p5-Mozilla-CA-20240924nb1 p5-Net-DNS-1.48nb1 p5-Net-Domain-TLD-1.75nb8
  p5-Net-IP-1.26nb12 p5-Net-LibIDN-0.12nb16 p5-Net-SMTP-SSL-1.04nb8
  p5-Net-SSLeay-1.94nb1 p5-Socket6-0.29nb6 p5-TimeDate-2.33nb4
  p5-XML-Parser-2.47nb1 pcre2-10.44 perl-5.40.0nb1 pigz-2.8 pkgconf-2.3.0
  png-1.6.44 postfix-3.9.1 python27-2.7.18nb19 python39-3.9.21 readline-8.2nb2
  rsyslog-8.38.0nb23 screen-4.9.1 sqlite3-3.47.2 sudo-1.9.16nb1 tcl-8.6.14nb4
  tcp_wrappers-7.6.4nb2 tcsh-6.24.14 tiff-4.7.0 tk-8.6.14 unzip-6.0nb10
  wget-1.25.0 xz-5.6.3 zlib-1.3.1 zsh-5.9nb2

92 packages to install:
  MesaLib-21.3.9nb4 at-spi2-core-2.54.0nb4 cairo-1.18.2 dbus-1.14.10
  emacs29-29.4nb10 fribidi-1.0.16 gdk-pixbuf2-2.42.12 git-perlscripts-2.48.1
  gnutls-3.8.8nb2 go123-1.23.4 gobject-introspection-1.80.1nb3 gtk3+-3.24.43nb5
  hicolor-icon-theme-0.17nb1 jansson-2.14 libICE-1.1.2 libSM-1.2.5
  libXaw-1.0.16 libXcomposite-0.4.6 libXcursor-1.2.3 libXdamage-1.1.6
  libXinerama-1.1.5 libXmu-1.2.1 libXpm-3.5.17 libXrandr-1.5.4 libXt-1.3.1
  libXxf86vm-1.1.6 libcups-2.4.11nb3 libdrm-2.4.124 libepoxy-1.5.10nb2
  libotf-0.9.16nb4 libpaper-2.2.5 libpciaccess-0.18.1 libtasn1-4.19.0
  libvdpau-1.4nb1 libwebp-1.4.0 libxshmfence-1.3.3 lua53-5.3.6 lzo-2.10
  mDNSResponder-2559.1.1 nettle-3.10 nghttp3-1.6.0 ngtcp2-1.8.1 p11-kit-0.25.5
  p5-Capture-Tiny-0.48nb7 p5-Clone-0.47nb1 p5-DBD-SQLite-1.76nb4
  p5-DBI-1.645nb1 p5-Encode-Locale-1.05nb10 p5-File-Listing-6.16nb1
  p5-HTML-Parser-3.83nb1 p5-HTML-Tagset-3.24nb1 p5-HTTP-Cookies-6.11nb1
  p5-HTTP-Daemon-6.16nb2 p5-HTTP-Date-6.06nb1 p5-HTTP-Message-7.00nb1
  p5-HTTP-Negotiate-6.01nb13 p5-IO-HTML-1.004nb4 p5-LWP-MediaTypes-6.04nb5
  p5-MIME-Base32-1.303nb8 p5-Net-HTTP-6.23nb1 p5-Try-Tiny-0.32nb1
  p5-URI-5.31nb1 p5-WWW-RobotRules-6.02nb13 p5-libwww-6.77nb2 pango-1.54.0
  pciids-20200222 pixman-0.44.2 py312-setuptools-75.6.0 python312-3.12.8nb1
  shared-mime-info-2.4nb4 tree-sitter-0.24.4 tree-sitter-bash-0.23.3
  tree-sitter-c-0.23.2 tree-sitter-c-sharp-0.23.1 tree-sitter-cmake-0.5.0
  tree-sitter-cpp-0.23.4 tree-sitter-css-0.23.1 tree-sitter-dockerfile-0.2.0
  tree-sitter-elixir-0.3.1 tree-sitter-go-0.23.4 tree-sitter-go-mod-1.1.0
  tree-sitter-heex-0.6.0 tree-sitter-html-0.23.2 tree-sitter-java-0.23.4
  tree-sitter-json-0.24.8 tree-sitter-python-0.23.5 tree-sitter-ruby-0.23.1
  tree-sitter-rust-0.23.2 tree-sitter-toml-0.5.1nb1 tree-sitter-tsx-0.23.2
  tree-sitter-typescript-0.23.2 tree-sitter-yaml-0.5.0nb1

4 packages to remove (superseded):
  npm-6.14.13nb1 py27-sqlite3-2.7.18nb20 py39-expat-3.9.9 scmgit-2.0

4 to remove, 17 to refresh, 138 to upgrade, 92 to install
1023M to download, 2011M of additional disk space will be used

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
package does not exist in the 2024Q4 pkgsrc install, and that attempting to
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

At this point, you should be able to build a post-OS-8349 (2024.4) revision
of smartos-live and repos.  NOTE that illumos-extra must be updated
concurrently with smartos-live. You may also reboot your dev zone and have it
come up cleanly. Note that the following files in /etc will now lie to you:

* /etc/motd
* /etc/pkgsrc_version

You may find it useful to manually update those files to correspond to
the /opt/local 2024Q4 pkgsrc installation.

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
