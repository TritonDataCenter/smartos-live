CC=gcc
CFLAGS=-Wall
TARGETS=bootparams disklist removable_disk disk_size has_hvx
SMARTDC_TARGETS=has_hvx
DESTDIR=../proto

all: $(TARGETS) sysinfo 

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
	cp create-machine.js $(DESTDIR)/usr/sbin/create-machine
	cp machine/machine-json.js $(DESTDIR)/usr/sbin/machine-json
	mkdir -m 0755 -p $(DESTDIR)/usr/node_modules
	find node_modules -type f -exec cp {} $(DESTDIR)/usr/node_modules/ \;

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

disklist:
	cp disklist.sh disklist
	chmod 0755 disklist

sysinfo:
	touch sysinfo

clean:
	@rm -f $(TARGETS)
