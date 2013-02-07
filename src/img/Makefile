#
# Copyright (c) 2012, Joyent, Inc. All rights reserved.
#
# imgadm Makefile
#

#
# Files & Tools
#
NODEUNIT	:= ./node_modules/.bin/nodeunit


#
# Targets
#

.PHONY: test
test: | $(NODEUNIT)
	$(NODEUNIT) test/*.test.js

.PHONY: update_modules
update_modules:
	./tools/mk-sdc-clients-light.sh $(shell json -f package.json dependencies.sdc-clients | cut -d'#' -f2)
	./tools/mk-nodeunit-light.sh $(shell json -f package.json devDependencies.nodeunit)
	for dep in $(shell json -f package.json dependencies | json --keys -a | grep -v sdc-clients); do \
		echo "# update $$dep dependency"; \
		rm -rf node_modules/$$dep; \
		npm install $$dep; \
		find node_modules/$$dep -name .gitmodules | xargs rm; \
		find node_modules/$$dep -name .npmignore | xargs rm; \
		find node_modules/$$dep -name .travis.yml | xargs rm; \
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
	done;

INSTALLIMAGE = $(TOP)/build/installimage
.PHONY: installimage
installimage:
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
	# TODO: built man pages


