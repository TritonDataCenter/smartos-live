CC=gcc
CFLAGS=-Wall
TARGETS=bootparams disklist removable_disk disk_size node-kstat/build/default/kstat.node
SMARTDC_TARGETS=has_hvx
DESTDIR=../proto
NODE_WAF=$(PWD)/../proto/usr/bin/node-waf

all: $(TARGETS) sysinfo $(SMARTDC_TARGETS)

install: $(TARGETS) sysinfo
	mkdir -p $(DESTDIR)/usr/bin
	cp -p $(TARGETS) sysinfo $(DESTDIR)/usr/bin
	mkdir -p $(DESTDIR)/smartdc/bin
	cp -p $(SMARTDC_TARGETS) $(DESTDIR)/smartdc/bin
	mkdir -m 0755 -p $(DESTDIR)/usr/sbin
	mkdir -m 0755 -p $(DESTDIR)/usr/lib
	cp vmadmd.js $(DESTDIR)/usr/lib/vmadmd
	cp vmadm.js $(DESTDIR)/usr/sbin/vmadm
	cp vmcfg.js $(DESTDIR)/usr/sbin/vmcfg
	cp machine/machine-create.js $(DESTDIR)/usr/sbin/machine-create
	cp machine/machine-json.js $(DESTDIR)/usr/sbin/machine-json
	cp machine/machine-lookup.js $(DESTDIR)/usr/sbin/machine-lookup
	mkdir -m 0755 -p $(DESTDIR)/usr/node_modules
	find node_modules -type f -exec cp {} $(DESTDIR)/usr/node_modules/ \;
	cp node-kstat/build/default/kstat.node $(DESTDIR)/usr/node_modules/

check:
	@tools/node-lint/bin/node-lint *.js \
        --config=tools/node-lint.json

bootparams: bootparams.c
	$(CC) $(CFLAGS) -o $@ $^ -ldevinfo

removable_disk: removable_disk.c
	$(CC) $(CFLAGS) -o $@ $^

disk_size: disk_size.c
	$(CC) $(CFLAGS) -o $@ $^

has_hvx: has_hvx.c
	$(CC) $(CFLAGS) -o $@ $^

node-kstat/build/default/kstat.node: node-kstat/kstat.cc $(NODE_WAF)
	(cd node-kstat && $(NODE_WAF) configure && $(NODE_WAF) build)

disklist:
	cp disklist.sh disklist
	chmod 0755 disklist

sysinfo:
	touch sysinfo

clean:
	@rm -f $(TARGETS)
