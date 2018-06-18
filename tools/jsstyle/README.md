# jsstyle

## Overview

`jsstyle` is a style checker for JavaScript coding style.  This tool is derived
from the cstyle tool used to check for the style used in the Solaris kernel,
sometimes known as "Bill Joy Normal Form".  This tool is a *little bit*
configurable. However it strives to enforces a single coding style based on
that cstyle. See "Configuration Options" below.

The original cstyle tool can be found here:
<https://github.com/illumos/illumos-gate/blob/master/usr/src/tools/scripts/cstyle.pl>

The document describing C Style is available here:
<http://www.cis.upenn.edu/~lee/06cse480/data/cstyle.ms.pdf>

Examples of conditions checked by this tool include:

* Strings must be quoted with single quotes.
* Blocks must be indented with tabs, not spaces.
* Continuation lines must be indented with 4 spaces.
* Keywords (for, if, function, etc.) must be followed with a space.
* One line cannot contain multiple keywords.
* Relational operators must be surrounded with spaces.
* There must be no spaces between tabs, nor tabs between spaces.
* Lines must not end with whitespace.
* Multi-line block comments must start and end with a blank line.
* Return expressions must be parenthesized.


## Status

No new features planned.  The biggest known issue is that jsstyle doesn't grok
regexes, so you usually need to wrap these in JSSTYLED comments (see below).


## Usage

    jsstyle [OPTIONS] file1.js [file2.js ...]


## Configuration Options

Configuration options may be specified in a file (one option per line)
with the "-f PATH" switch, or on the command line with the "-o
OPTION1,OPTION2" switch.

As stated about, `jsstyle` is opinionated and intends to stay that way.
That said, this author was arm twisted under duress to allow the following
configurability.

    doxygen                 Allow doxygen-style block comments `/** /*!`.
    splint                  Allow splint-style lint comments `/*@ ... @*/`.
                            This is legacy. Does anyone use this?
    indent=<NUM|tab>        An integer number of spaces for indentation, or
                            'tab' for tab indentation (the default).
    strict-indent           Boolean option, set to 1 to force indents of spaces
                            to be a multiple of indent parameter.
    line-length             An integer number to specify the maximum length
                            of a line (default: 80)
    literal-string-quote    'single' (the default) or 'double'. Specifies
                            the preferred quote character for literal strings.
    unparenthesized-return  Boolean option, set to 0 to disable the
                            "unparenthesized return expression" check.
    blank-after-start-comment
                            Boolean option, set to 0 to disable the
                            "missing blank after start comment" check. `// `
    blank-after-open-comment
                            Boolean option, set to 0 to disable the
                            "missing blank after open comment" check. `/* */`
    no-blank-for-anon-function
                            Boolean option, set to 1 to allow anonymous
                            functions without blank before paren. `function() { ... }`
    continuation-at-front   Boolean option, set to 1 to force continations
                            to be at the beginning rather than end of line.
    leading-right-paren-ok  Boolean option, set to 1 to allow ) to start a
                            line.

    whitespace-after-left-paren-ok
                            Boolean option, allow whitespace after a (
                            character.

    leading-comma-ok        Boolean option to allow lines to begin with commas
                            (preceded by whitespace).

    uncuddled-else-ok       Boolean option to allow for an else block to begin
                            on a new line.

## "JSSTYLED"-comments

When you want `jsstyle` to ignore a line, you can use this:

    /* JSSTYLED */
    ignore = this + line;

Or for a block:

    /* BEGIN JSSTYLED */
    var here
      , be
      , some = funky
      , style
    /* END JSSTYLED */


## License

CDDL
