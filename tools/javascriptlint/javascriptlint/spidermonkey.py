# vim: ts=4 sw=4 expandtab

# This is a wrapper script to make it easier for development. It tries to
# import the development version first, and if that fails, it goes after the
# real version.
try:
	from pyspidermonkey_ import *
except ImportError:
	from pyspidermonkey import *

