#
# This file contains an example of default settings that can be made for
# bash(1) users on this system.  To make these settings the default for system
# users, you will need to copy it to /etc/bash/bashrc
#
# Bourne Again SHell init file.
#
umask 022

# Where's the Gnu stuff at?
GNU=/usr/gnu/bin
X11=/usr/X11/bin

UTIL_PATH=$GNU:$X11
STANDARD_PATH=/bin:/usr/bin:/sbin:/usr/sbin

if [ -d $HOME/bin ]; then
    MY_PATH=$MY_PATH:$HOME/bin
fi

export PATH="$MY_PATH:$UTIL_PATH:$STANDARD_PATH"

# If not running interactively, then return
if [ -z "$PS1" ]; then
	return
fi

# Set ignoreeof if you don't want EOF as the sole input to the shell to
# immediately signal a quit condition.  This only happens at the start
# of a line if the line is empty, and you haven't just deleted a character
# with C-d.  I turn this on in ~/.bash_profile so that only login shells
# have the right to be obnoxious.
set -o ignoreeof

# Set auto_resume if you want to resume on "emacs", as well as on
# "%emacs".
auto_resume=exact

# Set notify if you want to be asynchronously notified about background
# job completion.
set -o notify

# Make it so that failed `exec' commands don't flush this shell.
shopt -s execfail

if [ -z "$LOGIN_SHELL" ]; then
    PS1="[\u@\h]:[\#]:[\w]:\$ "
fi

HISTSIZE=256
MAILCHECK=60

#
# we want pretty colored file listings
#
if [ -x /usr/bin/dircolors ] ; then
    if [ -f ~/.dir_colors ] ; then
	eval "`/usr/bin/dircolors -b ~/.dir_colors`"
    elif [ -f ~/.dircolors ] ; then
	eval "`/usr/bin/dircolors -b ~/.dircolors`"
    fi
fi

[ -f /etc/bash/bash_completion ] && . /etc/bash/bash_completion

for s in /etc/bash/*.sh ; do
    test -r $s && . $s
done

for s in /etc/bash/*.bash ; do
    test -r $s && . $s
done

[ -f ~/.bash_expert ] && . ~/.bash_expert

[ -f ~/.bash_aliases ] && . ~/.bash_aliases

