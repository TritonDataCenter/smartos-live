CC=gcc
CFLAGS=-Wall
TARGETS=bootparams disklist removable_disk disk_size
SMARTDC_TARGETS=sdc-sbcreate sdc-sbupload marco polo beacon has_hvx
JOYENT_PUBKEY=pubkey.key
DESTDIR=../proto

all: $(TARGETS) sysinfo $(SMARTDC_TARGETS)

install: $(TARGETS) sysinfo
	mkdir -p $(DESTDIR)/usr/bin
	pfexec cp -p $(TARGETS) sysinfo $(DESTDIR)/usr/bin
	mkdir -p $(DESTDIR)/smartdc/bin
	pfexec cp -p $(SMARTDC_TARGETS) $(DESTDIR)/smartdc/bin
	pfexec cp -p $(JOYENT_PUBKEY) $(DESTDIR)/smartdc

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

sdc-sbcreate:
	touch sdc-sbcreate

sdc-sbupload:
	touch sdc-sbupload

beacon:
	touch beacon

marco: marco.c
	$(CC) $(CFLAGS) -o $@ $^ -lsocket

polo: polo.c
	$(CC) $(CFLAGS) -o $@ $^ -lsocket

clean:
	@rm -f $(TARGETS)
