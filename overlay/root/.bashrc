if [ "$PS1" ]; then
    shopt -s checkwinsize
    if [[ -f /.dcinfo ]]; then
        . /.dcinfo
        DC_NAME="${SDC_DATACENTER_NAME}"
        DC_HEADNODE_ID="${SDC_DATACENTER_HEADNODE_ID}"
    fi
    if [[ -n "${DC_NAME}" && -n "${DC_HEADNODE_ID}" ]]; then
       PS1="[\u@\h (${DC_NAME}:${DC_HEADNODE_ID}) \w]\\$ "
    elif [[ -n "${DC_NAME}" ]]; then
       PS1="[\u@\h (${DC_NAME}) \w]\\$ "
    else
       PS1="[\u@\h \w]\\$ "
    fi
    alias ll='ls -lF'
    [ -n "${SSH_CLIENT}" ] && export PROMPT_COMMAND='echo -ne "\033]0;${HOSTNAME} \007" && history -a'
fi

# Load bash completion
[ -f /etc/bash/bash_completion ] && . /etc/bash/bash_completion

if [ "${TERM}" == "screen" ]; then
    export TERM=xterm-color
fi
