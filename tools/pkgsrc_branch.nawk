#!/opt/local/bin/nawk -f
#
# This file and its contents are supplied under the terms of the
# Common Development and Distribution License ("CDDL"), version 1.0.
# You may only use this file in accordance with the terms of version
# 1.0 of the CDDL.
#
# A full copy of the text of the CDDL should have accompanied this
# source.  A copy of the CDDL is also available via the Internet at
# http://www.illumos.org/license/CDDL.
#
# Copyright 2018 Joyent, Inc.
#
# Determine pkgsrc branch given a repositories.conf file.
#

BEGIN {
	FS="/"
}

{
	#
	# Clear out comments.
	#
	gsub("#.*", "", $0);
}

!$0 {
	#
	# Skip blank lines.
	#
	next;
}

$3 != "pkgsrc.joyent.com" || $4 != "packages" {
	print("WARNING: unexpected URL format: " $0) >"/dev/stderr";
	next;
}

{
	c++;
	v = $(NF - 2);
	a = $(NF - 1);
}

END {
	if (c != 1) {
	    printf("wanted 1 repo, found %d\n", c) >"/dev/stderr";
	    exit(1);
	}

	printf("%s/%s\n", v, a);
}
