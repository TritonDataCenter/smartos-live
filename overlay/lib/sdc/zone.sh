#!/usr/bin/bash
#
# functions for interacting with zones
#
# Copyright (c) 2010,2011 Joyent Inc., All rights reserved.
#

# zone_status <zonename>
#
# Returns the current status of the specified zone.
function zone_status {
    local ZONENAME=$1
    if [ -z "$ZONENAME" ]; then
        echo "ERROR: cannot shutdown zone, no zonename defined"
        exit 1
    fi
    echo `zoneadm -z $1 list -p | cut -d':' -f3`    
}   

# zone_shutdown <zonename> <number_of_status_checks> <time_between_checks>
#
# This will attempt to shutdown the zone specified in the background and then
# periodically check the zone status until the zone is no longer running.
#
# This defaults to checking every second for up to 30 attempts.
function zone_shutdown {
    local ZONENAME=$1
    if [ -z "$ZONENAME" ]; then
        echo "ERROR: cannot shutdown zone, no zonename defined"
        exit 1
    fi
 
    local TRIES=$(this_or_that "$2" "30")
    local WAIT=$(this_or_that "$3" "1")

    # Inbetween "running" and "installed" there are two states that can appear very briefly,
    # "shutting down" and "down". While these generally fly by very quickly, best to double
    # check
    local STATUS=$(zone_status "$ZONENAME")
    if [ "$STATUS" != "running" ] && [ "$STATUS" != "shutting_down" ] && [ "$STATUS" != "down" ]; then
        return 0
    fi
    
    zoneadm -z $ZONENAME halt 2>/dev/null &

    while [[ "$TRIES" > 0 ]]; do
        STATUS=$(zone_status "$ZONENAME")
        
        if [ "$STATUS" != "running" ] && [ "$STATUS" != "shutting_down" ] && [ "$STATUS" != "down" ]; then
            break
        fi
        
        sleep $WAIT
        let TRIES=$TRIES-1
    done

    if [ "$STATUS" == "running" ] || [ "$STATUS" == "shutting_down" ] || [ "$STATUS" == "down" ]; then
        echo "ERROR: unable to shutdown zone '$ZONENAME'"
        return 1
    fi

    return 0
}

# zone_startup <zonename> <number_of_status_checks> <time_between_checks>
#
# This will attempt to boot the zone specified in the background and then
# periodically check the zone status until the zone is running.
#
# This defaults to checking every second for up to 30 attempts.
function zone_startup {
    local ZONENAME=$1
    if [ -z "$ZONENAME" ]; then
        echo "ERROR: cannot startup zone, no zonename defined"
        exit 1
    fi
 
    local TRIES=$(this_or_that "$2" "30")
    local WAIT=$(this_or_that "$3" "1")

    if [ $(zone_status "$ZONENAME") == "running" ]; then
        return 0
    fi
    
    zoneadm -z $ZONENAME boot 2>/dev/null &

    local STATUS= 
    while [[ "$TRIES" > 0 ]]; do
        STATUS=$(zone_status "$ZONENAME")
        
        if [ "$STATUS" == "running" ]; then
            break
        fi
        
        sleep $WAIT
        let TRIES=$TRIES-1
    done

    if [ "$STATUS" != "running" ]; then
        echo "ERROR: unable to startup zone '$ZONENAME'"
        return 1
    fi

    return 0
}

# zone_detach <zonename> <number_of_status_checks> <time_between_checks>
#
# This will attempt to detach the zone specified in the background and then
# periodically check the zone status until the zone is detached.
#
# This defaults to checking every second for up to 30 attempts.
function zone_detach {
    local ZONENAME=$1
    if [ -z "$ZONENAME" ]; then
        echo "ERROR: cannot detach zone, no zonename defined"
        exit 1
    fi
 
    local TRIES=$(this_or_that "$2" "30")
    local WAIT=$(this_or_that "$3" "1")

    if [ $(zone_status "$ZONENAME") == "configured" ]; then
        return 0
    fi
  
    # TEMPORARY HACK TO GET PAST OS-354
    zoneadm -z $ZONENAME mark -F configured 2>/dev/null &
    #zoneadm -z $ZONENAME detach 2>/dev/null &

    local STATUS= 
    while [[ "$TRIES" > 0 ]]; do
        STATUS=$(zone_status "$ZONENAME")
        
        if [ "$STATUS" == "configured" ]; then
            break
        fi
        
        sleep $WAIT
        let TRIES=$TRIES-1
    done

    if [ "$STATUS" != "configured" ]; then
        echo "ERROR: unable to detach zone '$ZONENAME'"
        return 1
    fi

    return 0
}

# zone_attach <zonename> <number_of_status_checks> <time_between_checks>
#
# This will attempt to attach the zone specified in the background and then
# periodically check the zone status until the zone is attached.
#
# This defaults to checking every second for up to 30 attempts.
function zone_attach {
    local ZONENAME=$1
    if [ -z "$ZONENAME" ]; then
        echo "ERROR: cannot attach zone, no zonename defined"
        exit 1
    fi
 
    local TRIES=$(this_or_that "$2" "30")
    local WAIT=$(this_or_that "$3" "1")

    if [ $(zone_status "$ZONENAME") == "installed" ]; then
        return 0
    fi
    
    # XXX - TEMPORARY HACK TO GET PAST OS-354
    zoneadm -z $ZONENAME mark -F installed 2>/dev/null &
    #zoneadm -z $ZONENAME attach 2>/dev/null &

    local STATUS= 
    while [[ "$TRIES" > 0 ]]; do
        STATUS=$(zone_status "$ZONENAME")
        
        if [ "$STATUS" == "installed" ]; then
            break
        fi
        
        sleep $WAIT
        let TRIES=$TRIES-1
    done

    if [ "$STATUS" != "installed" ]; then
        echo "ERROR: unable to attach zone '$ZONENAME'"
        return 1
    fi

    return 0
}

# this_or_that <variable_that_may_be_null> <fallback_variable>
#
# This function is available to allow easy defaulting on variables for 
# functions
function this_or_that {
    if [ -z "$1" ]; then
      echo $2
    else 
      echo $1
    fi
}


