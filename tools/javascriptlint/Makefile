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

# Try to get a Python 2. On macOS there isn't a "python2". On
# SmartOS pkgsrc 2019Q2 minimal "python" is v3.
ifeq ($(BUILDOS),Darwin)
#	As of macOS 12, we can't use the system python anymore, so take the
#	first one that's not in /usr/bin.
	PY_EXEC=$(shell which -a python2.7 | grep -v /usr/bin/python | head -1)
else
	PY_EXEC=$(shell which python2.7)
endif
ifndef PY_EXEC
#	If we get here, there wasn't a python2.7 binary. It's getting pretty
#	untennable at this point, because even as it is, python2.7 isn't
#	supported anymore, and anything older than that is even worse off, but
#	at least we won't break anybody who was previously working.
#
#	For macOS 12 that gets here, this will pick up the system python which
#	will refuse to link later because linking against system python is
#	no longer allowed. That means that while it's still broken, there's
#	nothing we can do about it and we're no worse off than before. If you're
#	reading this trying to figure out how to compile this on macOS 12+,
#	you need to install your own python2.7 and have that in your PATH.
	PY_EXEC=$(shell which python2)
endif
ifndef PY_EXEC
	PY_EXEC=python
endif
PY_PYTHON=$(shell $(PY_EXEC) -c "import sys; print(sys.executable)")
PY_PREFIX=$(shell $(PY_PYTHON) -c "import sys; print(sys.real_prefix)" || $(PY_PYTHON) -c "import sys; print(sys.prefix)")
PY_VERSION=$(shell $(PY_PYTHON) -c "import sys; print('.'.join(map(str, sys.version_info[:2])))")
ifeq ($(BUILDOS),Darwin)
	PY_ARCH=$(shell $(PY_PYTHON) -c 'import platform; print platform.machine()')
	SOLDFLAGS += -lpython$(PY_VERSION)
	CC=gcc -arch $(PY_ARCH)
else
	PY_BIT=$(shell $(PY_PYTHON) -c 'import sys; print (sys.maxint > 2**32 and "64" or "32")')
	CFLAGS += -m$(PY_BIT)
endif

CPPFLAGS += -I$(PY_PREFIX)/include/python$(PY_VERSION)
SOFILE = $(BUILDDIR)/pyspidermonkey.so

all: $(SOFILE)

$(BUILDDIR) $(INSTALLDIRS):
	mkdir -p $@

$(OBJECTS): spidermonkey/src/build/libjs.a spidermonkey/src/build/js_operating_system.h

$(SOFILE): $(OBJECTS)
	$(CC) $(CFLAGS) $(SOLDFLAGS) $(LDFLAGS) $(OBJECTS) -L$(PY_PREFIX)/lib -Lspidermonkey/src/build -ljs -o $@

$(BUILDDIR)/%.o: javascriptlint/pyspidermonkey/%.c | $(BUILDDIR)
	$(CC) -o $@ -c $(CFLAGS) $(CPPFLAGS) $<

spidermonkey/src/build/libjs.a:
	(cd spidermonkey/src && CC="$(CC)" CFLAGS="$(CFLAGS)" $(MAKE))

spidermonkey/src/build/js_operating_system.h:
	echo "#define XP_UNIX" > $@

clean:
	-rm -rf $(BUILDDIR) $(INSTALLDIRS)
	-(cd spidermonkey/src && $(MAKE) clean)

install: $(SOFILE) javascriptlint/jsl javascriptlint/jsl | $(INSTALLDIRS)
	cp $(SOFILE) build/install
	cp javascriptlint/*.py build/install/javascriptlint
	sed -e "1s:#\!/usr/bin/env python:#\!$(PY_PYTHON):" javascriptlint/jsl >build/install/jsl
	chmod +x build/install/jsl
	sed -e "1s:#\!/usr/bin/env python:#\!$(PY_PYTHON):" javascriptlint/jsl.py >build/install/javascriptlint/jsl.py
	chmod +x build/install/javascriptlint/jsl.py
	sed -e "1s:#\!/usr/bin/env python:#\!$(PY_PYTHON):" javascriptlint/jsparse.py >build/install/javascriptlint/jsparse.py
	sed -e "1s:#\!/usr/bin/env python:#\!$(PY_PYTHON):" javascriptlint/lint.py >build/install/javascriptlint/lint.py

.PHONY: install
