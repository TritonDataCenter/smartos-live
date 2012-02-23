# vim: ts=4 sw=4 expandtab
from distutils.core import setup, Extension
import os
import sys

# Add the bin directory to the module search path
def _get_lib_path():
    import distutils.dist
    import distutils.command.build
    dist = distutils.dist.Distribution()
    build = distutils.command.build.build(dist)
    build.finalize_options()
    return os.path.join(os.path.dirname(__file__), '..', '..',
                        build.build_platlib, 'javascriptlint')

sys.path.insert(0, _get_lib_path())
try:
    from pyspidermonkey import *
finally:
    sys.path.pop(0)

