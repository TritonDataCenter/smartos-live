CC=gcc
CFLAGS=-Wall
TARGETS=bootparams


all: $(TARGETS)

bootparams: bootparams.c
	$(CC) $(CFLAGS) -o $@ $^ -ldevinfo

clean:
	@rm -f $(TARGETS)
