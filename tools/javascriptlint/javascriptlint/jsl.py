#!/usr/bin/python
# vim: ts=4 sw=4 expandtab
import codecs
import fnmatch
import glob
import os
import sys
import unittest
from optparse import OptionParser

import conf
import htmlparse
import jsparse
import lint
import util

_lint_results = {
    'warnings': 0,
    'errors': 0
}

def _dump(paths):
    for path in paths:
        script = util.readfile(path)
        jsparse.dump_tree(script)

def _lint(paths, conf_, printpaths):
    def lint_error(path, line, col, errname, errdesc):
        _lint_results['warnings'] = _lint_results['warnings'] + 1
        print util.format_error(conf_['output-format'], path, line, col,
                                      errname, errdesc)
    lint.lint_files(paths, lint_error, conf=conf_, printpaths=printpaths)

def _resolve_paths(path, recurse):
    # Build a list of directories
    paths = []

    dir, pattern = os.path.split(path)
    for cur_root, cur_dirs, cur_files in os.walk(dir):
        paths.extend(os.path.join(cur_root, file) for file in \
                     fnmatch.filter(cur_files, pattern))
        if not recurse:
            break

    # If no files have been found, return the original path/pattern. This will
    # force an error to be thrown if no matching files were found.
    return paths or [path]

def printlogo():
    # TODO: Print version number.
    print "JavaScript Lint"
    print "Developed by Matthias Miller (http://www.JavaScriptLint.com)"

def _profile_enabled(func, *args, **kwargs):
    import tempfile
    import hotshot
    import hotshot.stats
    handle, filename = tempfile.mkstemp()
    profile = hotshot.Profile(filename)
    profile.runcall(func, *args, **kwargs)
    profile.close()
    stats = hotshot.stats.load(filename)
    stats = stats.sort_stats("time")
    stats.print_stats()
def _profile_disabled(func, *args, **kwargs):
    func(*args, **kwargs)

def main():
    parser = OptionParser(usage="%prog [options] [files]")
    add = parser.add_option
    add("--conf", dest="conf", metavar="CONF",
        help="set the conf file")
    add("--profile", dest="profile", action="store_true", default=False,
        help="turn on hotshot profiling")
    add("--recurse", dest="recurse", action="store_true", default=False,
        help="recursively search directories on the command line")
    if os.name == 'nt':
        add("--disable-wildcards", dest="wildcards", action="store_false",
            default=True, help="do not resolve wildcards in the command line")
    else:
        add("--enable-wildcards", dest="wildcards", action="store_true",
            default=False, help="resolve wildcards in the command line")
    add("--dump", dest="dump", action="store_true", default=False,
        help="dump this script")
    add("--unittest", dest="unittest", action="store_true", default=False,
        help="run the python unittests")
    add("--quiet", dest="verbosity", action="store_const", const=0,
        help="minimal output")
    add("--verbose", dest="verbosity", action="store_const", const=2,
        help="verbose output")
    add("--nologo", dest="printlogo", action="store_false", default=True,
        help="suppress version information")
    add("--nofilelisting", dest="printlisting", action="store_false",
        default=True, help="suppress file names")
    add("--nosummary", dest="printsummary", action="store_false", default=True,
        help="suppress lint summary")
    add("--help:conf", dest="showdefaultconf", action="store_true", default=False,
        help="display the default configuration file")
    parser.set_defaults(verbosity=1)
    options, args = parser.parse_args()

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit()

    if options.showdefaultconf:
        print conf.DEFAULT_CONF
        sys.exit()

    if options.printlogo:
        printlogo()

    conf_ = conf.Conf()
    if options.conf:
        conf_.loadfile(options.conf)

    profile_func = _profile_disabled
    if options.profile:
        profile_func = _profile_enabled

    if options.unittest:
        suite = unittest.TestSuite();
        for module in [conf, htmlparse, jsparse, lint, util]:
            suite.addTest(unittest.findTestCases(module))

        runner = unittest.TextTestRunner(verbosity=options.verbosity)
        runner.run(suite)

    paths = []
    for recurse, path in conf_['paths']:
        paths.extend(_resolve_paths(path, recurse))
    for arg in args:
        if options.wildcards:
            paths.extend(_resolve_paths(arg, options.recurse))
        elif options.recurse and os.path.isdir(arg):
            paths.extend(_resolve_paths(os.path.join(arg, '*'), True))
        else:
            paths.append(arg)
    if options.dump:
        profile_func(_dump, paths)
    else:
        profile_func(_lint, paths, conf_, options.printlisting)

    if options.printsummary:
        print '\n%i error(s), %i warnings(s)' % (_lint_results['errors'],
                                                 _lint_results['warnings'])

    if _lint_results['errors']:
        sys.exit(3)
    if _lint_results['warnings']:
        sys.exit(1)
    sys.exit(0)

if __name__ == '__main__':
    main()

