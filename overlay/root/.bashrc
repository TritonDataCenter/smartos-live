if [ "$PS1" ]; then
    shopt -s checkwinsize
    PS1="[\u@\h \w]\\$ "
    alias ll='ls -lF'
    [ -n "${SSH_CLIENT}" ] && export PROMPT_COMMAND='echo -ne "\033]0;${HOSTNAME} \007" && history -a'
fi

# Load bash completion
[ -f /etc/bash/bash_completion ] && . /etc/bash/bash_completion

if [ "${TERM}" == "screen" ]; then
    export TERM=xterm-color
fi
