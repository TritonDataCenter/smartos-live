# fwrule

Joyent firewall rule object wrapper. There are two parts to this package:

* A Jison grammar (src/fwrule.jison) that specifies a DSL for writing
  firewall rules. This is used to generate the parser (lib/parser.js)
* A rule object that wraps the parser and provides various convenience
  and serialization methods.

The parser is currently checked in to avoid requiring jison to be installed
in order to use this package.


# Repository

    lib/            Source files
    node_modules/   node.js dependencies (populate by running "npm install")
    src/            Contains the jison grammar for creating the firewall rule
                    parser
    tools/          Tools and configuration files
    test/           Test suite (using nodeunit)


# Development

If you update the jison grammar, run the following to regenerate the parser:

    make parser

Before checking in, please run:

    make check

and fix any warnings. Note that jsstyle will stop after the first file with an
error, so you may need to run this multiple times while fixing.


# Testing

    make test

To run an individual test:

    ./node_modules/.bin/nodeunit <path to test file>
