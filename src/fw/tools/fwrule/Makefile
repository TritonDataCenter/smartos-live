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
# fwrule Makefile
#


#
# Tools
#
JISON	:= ./node_modules/jison/lib/cli.js
NODEUNIT := node_modules/nodeunit/bin/nodeunit
NPM := npm
JS_FILES	:= $(shell find lib test -name '*.js' | grep -v parser.js)
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSL_FLAGS  	?= --nologo --nosummary
JSL_FLAGS_NODE 	 = --conf=$(JSL_CONF_NODE)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,strict-indent=1,doxygen,unparenthesized-return=0,continuation-at-front=1,leading-right-paren-ok=1


#
# Repo-specific targets
#

.PHONY: parser
parser: $(JISON)
	@cp ./src/header.js ./lib/parser.js
	@cat ./src/fwrule.jison | $(JISON)  >> ./lib/parser.js

$(NODEUNIT):
	$(NPM) install

$(JISON):
	$(NPM) install


#
# test / check targets
#

.PHONY: test
test: $(NODEUNIT)
	@(for F in test/*.js; do \
		echo "# $$F" ;\
		$(NODEUNIT) --reporter tap $$F ;\
		[[ $$? == "0" ]] || exit 1; \
	done)

.PHONY: check
check: check-jsl check-jsstyle
	@echo check ok

.PHONY: prepush
prepush: check test

#
# This rule enables other rules that use files from a git submodule to have
# those files depend on deps/module/.git and have "make" automatically check
# out the submodule as needed.
#
deps/%/.git:
	git submodule update --init deps/$*

#
# javascriptlint
#

JSL_EXEC	?= deps/javascriptlint/build/install/jsl
JSL		?= $(JSL_EXEC)

$(JSL_EXEC): | deps/javascriptlint/.git
	cd deps/javascriptlint && make install

distclean::
	if [[ -f deps/javascriptlint/Makefile ]]; then \
		cd deps/javascriptlint && make clean; \
	fi


#
# jsstyle
#

JSSTYLE_EXEC	?= deps/jsstyle/jsstyle
JSSTYLE		?= $(JSSTYLE_EXEC)

$(JSSTYLE_EXEC): | deps/jsstyle/.git

.PHONY: check-jsl
check-jsl: $(JSL_EXEC)
	@$(JSL) $(JSL_FLAGS) $(JSL_FLAGS_NODE) $(JSL_FILES_NODE)

.PHONY: check-jsstyle
check-jsstyle:  $(JSSTYLE_EXEC)
	@$(JSSTYLE) $(JSSTYLE_FLAGS) $(JSSTYLE_FILES)
