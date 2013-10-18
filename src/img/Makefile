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
	rm -rf node_modules
	./tools/mk-sdc-clients-light.sh \
		$(shell json -f package.json dependencies.sdc-clients | cut -d'#' -f2) \
		node_modules/sdc-clients imgapi.js dsapi.js
	./tools/mk-nodeunit-light.sh $(shell json -f package.json devDependencies.nodeunit)
	npm install
	for dep in $(shell json -f package.json dependencies devDependencies \
			| json --keys -a --merge \
			| grep -v sdc-clients | grep -v nodeunit); do \
		echo "# trim $$dep dependency"; \
		find node_modules/$$dep -name .gitmodules | xargs rm; \
		find node_modules/$$dep -name .npmignore | xargs rm; \
		find node_modules/$$dep -name .travis.yml | xargs rm; \
		find node_modules/$$dep -name AUTHORS | xargs rm; \
		find node_modules/$$dep -name README.md | xargs rm; \
		find node_modules/$$dep -name Readme.md | xargs rm; \
		find node_modules/$$dep -name History.md | xargs rm; \
		find node_modules/$$dep -name jsl.node.conf | xargs rm; \
		find node_modules/$$dep -name examples | xargs rm -rf; \
		find node_modules/$$dep -name CHANGES.md | xargs rm; \
		find node_modules/$$dep -name "Makefile*" | xargs rm; \
		find node_modules/$$dep -name tools | xargs rm -rf; \
		find node_modules/$$dep -name tst | xargs rm -rf; \
		find node_modules/$$dep -name test | xargs rm -rf; \
		find node_modules/$$dep -name tests | xargs rm -rf; \
		find node_modules/$$dep -name benchmark | xargs rm -rf; \
		find node_modules/$$dep -name component.json | xargs rm -rf; \
	done;
	rm -rf node_modules/progbar/node_modules/assert-plus  # slight version mismatch
	rm -rf node_modules/imgmanifest/node_modules/assert-plus  # slight version mismatch



INSTALLIMAGE=/var/tmp/img-install-image
.PHONY: dev-install-image
dev-install-image:
	rm -rf $(INSTALLIMAGE)
	mkdir -p $(INSTALLIMAGE)
	cp package.json $(INSTALLIMAGE)/
	mkdir -p $(INSTALLIMAGE)/etc
	cp etc/imgadm.completion $(INSTALLIMAGE)/etc/
	mkdir -p $(INSTALLIMAGE)/sbin
	cp sbin/imgadm $(INSTALLIMAGE)/sbin/
	cp -PR lib $(INSTALLIMAGE)/lib
	cp -PR node_modules $(INSTALLIMAGE)/node_modules
	cp -PR test $(INSTALLIMAGE)/test
	mkdir -p $(INSTALLIMAGE)/man
	node ../../tools/ronnjs/bin/ronn.js man/imgadm.1m.md > $(INSTALLIMAGE)/man/imgadm.1m
