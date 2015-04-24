# `mancheck`: Manual Page Shipping Checks

The `mancheck` tool performs several checks against the contents of the
`proto/` area and the shipping `manifest` files produced during the build.  The
goal of running the tool is to ensure that no available manual pages are left
accidentally unshipped.

To that end, the `-m` and `-s` flags may be used to check shipped binaries in
directories like `usr/bin` against pages in section `1` or `1m`.  In addition
to these checks, configuration files containing pattern-based rules may be
provided to describe the full set of manual pages we expect to ship.  Those
files are described in the following section.

## `mancheck.conf` File Format

The file may contain C style comments, e.g.

    /*
     * An example comment.
     */

The file may also contain several different directive classes.  These directives
are described here in the same order that `mancheck` uses when processing
files.

### Pass 1: Section-level Exclusion Directives

The first directive type enables a specific manual page section (e.g. `3lib`)
to be excluded from processing.  If the manual page section matches _any_
section exclusion directive, the section is excluded immediately, even if it
later matches a section inclusion directive.

For example, to exclude the `3perl` section, use this directive:

    -section "3perl";

All directives also accept partially specified section names using the globbing
tokens described in _fnmatch(5)_.  For example, to exclude section `1` and
every subsection (e.g. `1m`, `1b`, etc), use:

    -section "1*";

Because exclusion directives are processed first, and negate all subsequent
directive processing, it is of vital importance to be as specific as possible
when excluding sections or subsections.

### Pass 2: Section-level Inclusion Directives

If a section is not explicitly excluded in _Pass 1_, it may then be included
for processing with an inclusion directive.  For example, to include all of
section `7` (and subsections), use:

    +section "7*";

If a section is not matched by any inclusion directive, it is implicitly left
out of all further processing.

### Pass 3: Page-level Exclusion Directives

Even though the goal is generally to ship entire sections of the manual, some
components will install pages into the wrong part of the proto area or will
install pages that are explicitly not relevant to SmartOS.  If a specific page
is to be excluded, a page-level exclusion directive may be used.

For example, say that section `3lib` is being shipped.  That section may
contain a page that is not relevant, and should not be shipped: e.g.
`libusb.3lib`.  That single page may be excluded from `mancheck` processing
by using:

    -page "libusb.3lib";

Note that _fnmatch(5)_ patterns are available here as well, but in general
exclusion rules should be as specific as possible to prevent unshipped pages
creeping into the build in the future.
