BUILDOS=$(shell uname -s)
BUILDDIR = build
INSTALLDIRS =					\
	$(BUILDDIR)/install			\
	$(BUILDDIR)/install/javascriptlint	\

CSRCS = \
	nodepos.c		\
	pyspidermonkey.c

OBJECTS = $(CSRCS:%.c=$(BUILDDIR)/%.o)
CFLAGS += -fno-strict-aliasing -O -fPIC

SOLDFLAGS += -shared
CPPFLAGS += -DNDEBUG -D_REENTRANT					\
	-Ispidermonkey/src -Ispidermonkey/src/build			\
	-I/usr/include							\

ifeq ($(BUILDOS),Darwin)
	PY_PREFIX=$(shell python2.6 -c "import sys; sys.stdout.write(sys.prefix)")
	PY_FRAMEWORK_PREFIX=$(shell python2.6 -c "import sys,os; sys.stdout.write(os.path.normpath(sys.prefix+'/../../..'))")
	SYSTEM_ARCH=$(shell uname -m)
	CPPFLAGS += -I$(PY_PREFIX)/include/python2.6
	SOLDFLAGS += -F$(PY_FRAMEWORK_PREFIX) -framework Python
	LD=gcc -arch $(SYSTEM_ARCH)
	CC=gcc -arch $(SYSTEM_ARCH)
else
	CPPFLAGS += \
		-I/opt/local/include/db4				\
		-I/opt/local/include/python2.6				\
		-I/opt/local/include/ncurses
endif

SOFILE = $(BUILDDIR)/pyspidermonkey.so

all: $(SOFILE)

$(BUILDDIR) $(INSTALLDIRS):
	mkdir -p $@

$(OBJECTS): spidermonkey/src/build/libjs.a spidermonkey/src/build/js_operating_system.h

$(SOFILE): $(OBJECTS)
	$(LD) $(SOLDFLAGS) $(LDFLAGS) $(OBJECTS) -Lspidermonkey/src/build -ljs -o $@

$(BUILDDIR)/%.o: javascriptlint/pyspidermonkey/%.c | $(BUILDDIR)
	$(CC) -o $@ -c $(CFLAGS) $(CPPFLAGS) $<

spidermonkey/src/build/libjs.a:
	(cd spidermonkey/src && CC="$(CC)" $(MAKE))

spidermonkey/src/build/js_operating_system.h:
	echo "#define XP_UNIX" > $@

clean:
	-rm -rf $(BUILDDIR) $(INSTALLDIRS)
	-(cd spidermonkey/src && $(MAKE) clean)

install: $(SOFILE) javascriptlint/jsl javascriptlint/jsl | $(INSTALLDIRS)
	cp javascriptlint/jsl $(SOFILE) build/install
	cp javascriptlint/*.py build/install/javascriptlint

.PHONY: install
