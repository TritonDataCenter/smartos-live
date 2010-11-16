CC=gcc
CFLAGS=-Wall
TARGETS=bootparams disklist removable_disk disk_size sysinfo
DESTDIR=../proto

all: $(TARGETS)

install: $(TARGETS)
	mkdir -p $(DESTDIR)/usr/bin
	pfexec cp -p $(TARGETS) $(DESTDIR)/usr/bin

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

clean:
	@rm -f $(TARGETS)
