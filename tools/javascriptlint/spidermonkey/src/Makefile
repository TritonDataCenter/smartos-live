BUILDDIR = build
CSRCS = \
	jsapi.c		\
	jsarena.c	\
	jsarray.c	\
	jsatom.c	\
	jsbool.c	\
	jscntxt.c	\
	jsdate.c	\
	jsdbgapi.c	\
	jsdhash.c	\
	jsdtoa.c	\
	jsemit.c	\
	jsexn.c		\
	jsfun.c		\
	jsgc.c		\
	jshash.c	\
	jsinterp.c	\
	jsiter.c	\
	jslock.c	\
	jslog2.c	\
	jslong.c	\
	jsmath.c	\
	jsnum.c		\
	jsobj.c		\
	jsopcode.c	\
	jsparse.c	\
	jsprf.c		\
	jsregexp.c	\
	jsscan.c	\
	jsscope.c	\
	jsscript.c	\
	jsstr.c		\
	jsutil.c	\
	jsxdrapi.c	\
	jsxml.c		\
	prmjtime.c


OBJECTS = $(CSRCS:%.c=$(BUILDDIR)/%.o)
CFLAGS += -Wall -Wno-format -O
CPPFLAGS += -DXP_UNIX -O -DXP_UNIX -DSVR4 -DSYSV -DSOLARIS		\
    -DHAVE_LOCALTIME_R -UDEBUG -DNDEBUG -UDEBUG_dap -DEDITLINE		\
    -I$(BUILDDIR)

all: $(BUILDDIR)/libjs.a

$(BUILDDIR):
	mkdir -p $@

$(BUILDDIR)/libjs.a: $(BUILDDIR)/jsautocfg.h $(BUILDDIR)/jsautokw.h $(OBJECTS)
	$(AR) rv $@ $(OBJECTS)

$(BUILDDIR)/%.o: %.c | $(BUILDDIR)
	$(CC) -o $@ -c $(CFLAGS) $(CPPFLAGS) $^

clean:
	-rm -rf $(BUILDDIR)

$(BUILDDIR)/jscpucfg: $(BUILDDIR)/jscpucfg.o
	$(CC) -o $@ $^

$(BUILDDIR)/jsautocfg.h: $(BUILDDIR)/jscpucfg
	$(BUILDDIR)/jscpucfg > $@

$(BUILDDIR)/jskwgen: $(BUILDDIR)/jskwgen.o
	$(CC) -o $@ $^

$(BUILDDIR)/jsautokw.h: $(BUILDDIR)/jskwgen
	$(BUILDDIR)/jskwgen > $@
