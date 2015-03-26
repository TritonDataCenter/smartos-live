#
# CDDL HEADER START
#
# The contents of this file are subject to the terms of the
# Common Development and Distribution License, Version 1.0 only
# (the "License").  You may not use this file except in compliance
# with the License.
#
# You can obtain a copy of the license at http://smartos.org/CDDL
#
# See the License for the specific language governing permissions
# and limitations under the License.
#
# When distributing Covered Code, include this CDDL HEADER in each
# file.
#
# If applicable, add the following below this CDDL HEADER, with the
# fields enclosed by brackets "[]" replaced with your own identifying
# information: Portions Copyright [yyyy] [name of copyright owner]
#
# CDDL HEADER END
#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
#
#
# imgadm Makefile
#


#
# Targets
#

.PHONY: test
test:
	./test/runtests

.PHONY: check
check:
	cd ../.. && make check

.PHONY: update_modules
update_modules:
	./tools/update-node-modules.sh

INSTALLIMAGE=/var/tmp/img-install-image
.PHONY: dev-install-image
dev-install-image:
	rm -rf $(INSTALLIMAGE)
	mkdir -p $(INSTALLIMAGE)
	cp package.json $(INSTALLIMAGE)/
	mkdir -p $(INSTALLIMAGE)/etc
	cp etc/imgadm.completion $(INSTALLIMAGE)/etc/
	mkdir -p $(INSTALLIMAGE)/sbin
	cp sbin/* $(INSTALLIMAGE)/sbin/
	cp -PR lib $(INSTALLIMAGE)/lib
	cp -PR node_modules $(INSTALLIMAGE)/node_modules
	cp -PR test $(INSTALLIMAGE)/test
	mkdir -p $(INSTALLIMAGE)/tools
	cp -PR tools/coal-create-docker-vm.sh $(INSTALLIMAGE)/tools/
	mkdir -p $(INSTALLIMAGE)/man
	node ../../tools/ronnjs/bin/ronn.js man/imgadm.1m.md > $(INSTALLIMAGE)/man/imgadm.1m
