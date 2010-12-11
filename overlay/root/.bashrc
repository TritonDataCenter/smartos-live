export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/sfw/bin:/usr/ccs/bin:/opt/local/bin

if [ "$PS1" ]; then
    shopt -s checkwinsize
    PS1="[\u@\h \w]\\$ "
    alias ll='ls -lF'
    [ -n "${SSH_CLIENT}" ] && export PROMPT_COMMAND='echo -ne "\033]0;${HOSTNAME} \007" && history -a'
fi
