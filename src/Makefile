CC=gcc
CFLAGS=-Wall
TARGETS=bootparams
DESTDIR=../proto

all: $(TARGETS)

install: $(TARGETS)
	mkdir -p $(DESTDIR)/usr/bin
	pfexec cp -p $(TARGETS) $(DESTDIR)/usr/bin

bootparams: bootparams.c
	$(CC) $(CFLAGS) -o $@ $^ -ldevinfo

clean:
	@rm -f $(TARGETS)
