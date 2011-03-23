CC=gcc
CFLAGS=-Wall
TARGETS=bootparams disklist removable_disk disk_size
DESTDIR=../proto

all: $(TARGETS) sysinfo sdc-sbcreate

install: $(TARGETS) sysinfo
	mkdir -p $(DESTDIR)/usr/bin
	pfexec cp -p $(TARGETS) sysinfo $(DESTDIR)/usr/bin
	mkdir -p $(DESTDIR)/smartdc/bin
	pfexec cp -p sdc-sbcreate $(DESTDIR)/smartdc/bin

bootparams: bootparams.c
	$(CC) $(CFLAGS) -o $@ $^ -ldevinfo

removable_disk: removable_disk.c
	$(CC) $(CFLAGS) -o $@ $^

disk_size: disk_size.c
	$(CC) $(CFLAGS) -o $@ $^

disklist:
	cp disklist.sh disklist
	chmod 0755 disklist

sysinfo:
	touch sysinfo

sdc-sbcreate:
	touch sdc-sbcreate

clean:
	@rm -f $(TARGETS)
