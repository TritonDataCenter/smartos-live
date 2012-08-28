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


PY_PYTHON=$(shell python -c "import sys; print(sys.executable)")
PY_PREFIX=$(shell $(PY_PYTHON) -c "import sys; print(sys.prefix)")
PY_VERSION=$(shell $(PY_PYTHON) -c "import sys; print('.'.join(map(str, sys.version_info[:2])))")
ifeq ($(BUILDOS),Darwin)
	PY_ARCH=$(shell $(PY_PYTHON) -c 'import sys; print (sys.maxint > 2**32 and "x86_64" or "i386")')
	SOLDFLAGS += $(PY_PREFIX)/Python
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
	$(CC) $(CFLAGS) $(SOLDFLAGS) $(LDFLAGS) $(OBJECTS) -Lspidermonkey/src/build -ljs -o $@

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
