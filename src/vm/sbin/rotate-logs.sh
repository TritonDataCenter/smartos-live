#!/bin/bash
#
# Copyright (c) 2013 Joyent Inc.
#
# Consume bunyan log files in <directory> appending contents to <targetfile>
#
# Important: files in <directory> must be named in the format:
#
#    1358497440806-091018*.log
#
# where the first 13 characters are a number of ms from 00:00 Jan 1, 1970, and
# the set of 6 digits represents the (0-padded) PID of the process that was or is
# writing to the log.
#
# Files for PIDs where the PID does not match an active process will have their
# contents appended to <targetfile> and the file will be deleted.  When there is
# an active process, the behavior can be defined through the -c, -i and -m
# options.  If more than one of these options is specified, the last one will be
# used.
#

DEBUG=0
MODE=
VERBOSE=0

usage() {
    if [[ -n $1 ]]; then
        echo $* >&2
    fi

    cat >&2 <<EOF
Usage: $0 [options] <directory> <targetfile>

Options:

 -c  When PID is still running, copy the file to a temp name then truncate old.
 -d  Enable extra debugging (enables bash's xtrace)
 -i  When PID is still running, ignore this file. (default)
 -m  When PID is still running, move the file then consume from the new name.
 -v  Verbose. Print a message for each file.

EOF
    exit 2
}

set -- `getopt cdimv $*`
if [ $? != 0 ]; then
    usage;
fi
for i in $*; do
    case $i in
        -c) MODE="copytruncate"; shift;;
        -d) DEBUG=1; shift;;
        -i) MODE="ignorerunning"; shift;;
        -m) MODE="moverunning"; shift;;
        -v) VERBOSE=1; shift;;
        --) shift; break;;
    esac
done

[[ ${DEBUG} == 1 ]] && set -o xtrace

dir=$1
targetfile=$2

[[ -z ${dir} ]] && usage "<directory> is required."
[[ -d ${dir} ]] || usage "${dir} is not a directory."
[[ -z ${targetfile} ]] && usage "<targetfile> is required."

# default to ignoring files for running PIDs.
[[ -z ${MODE} ]] && MODE="ignorerunning"

for file in $(ls ${dir}); do

    re="^([0-9]{13})-[0]{0,5}([1-9][0-9]{1,5})-.*.log"
    if [[ ${file} =~ ${re} ]]; then
        timestamp=${BASH_REMATCH[1]}
        pid=${BASH_REMATCH[2]}
        rotatefile=

        if kill -0 ${pid} 2>/dev/null; then
            case ${MODE} in
                copytruncate)
                    # running so we copy to .merging and truncate original, note:
                    # There's the possibility of losing records here if some come
                    # in between these calls.
                    if cp ${dir}/${file} ${dir}/${file}.merging; then
                        cp /dev/null ${dir}/${file} # truncate
                        rotatefile=${file}.merging
                    else
                        echo "Warning failed to copy ${dir}/${file}" >&2
                        continue;
                    fi
                    [[ ${VERBOSE} == 1 ]] && echo "Rotating (copied) ${file}"
                    ;;
                ignorerunning)
                    [[ ${VERBOSE} == 1 ]] && echo "Skipping running ${file}"
                    continue;
                    ;;
                moverunning)
                    # running so we move to .merging and let VM.js start a new one
                    if mv ${dir}/${file} ${dir}/${file}.merging; then
                        rotatefile=${file}.merging
                    else
                        echo "Warning failed to copy ${dir}/${file}" >&2
                        continue;
                    fi
                    [[ ${VERBOSE} == 1 ]] && echo "Rotating (moved) ${file}"
                    ;;
                *)
                    echo "FATAL: internal error, case missing handler for ${MODE}" >&2
                    exit 1
                    ;;
            esac
        else
            # not running so don't need to move first.
            rotatefile=${file}
            [[ ${VERBOSE} == 1 ]] && echo "Rotating ${file}"
        fi

        # TODO: bunyan is adding a tool to perform the following for us, use
        #       that when it's available.
        cat ${dir}/${rotatefile} >>${targetfile} \
            && rm -f ${dir}/${rotatefile}
    else
        echo "Warning: skipping file with incorrect filename: ${file}" >&2
    fi

done

exit 0
