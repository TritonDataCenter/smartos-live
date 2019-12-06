#!/bin/sh
#
# CDDL HEADER START
#
# The contents of this file are subject to the terms of the
# Common Development and Distribution License (the "License").
# You may not use this file except in compliance with the License.
#
# You can obtain a copy of the license at usr/src/OPENSOLARIS.LICENSE
# or http://www.opensolaris.org/os/licensing.
# See the License for the specific language governing permissions
# and limitations under the License.
#
# When distributing Covered Code, include this CDDL HEADER in each
# file and include the License file at usr/src/OPENSOLARIS.LICENSE.
# If applicable, add the following below this CDDL HEADER, with the
# fields enclosed by brackets "[]" replaced with your own identifying
# information: Portions Copyright [yyyy] [name of copyright owner]
#
# CDDL HEADER END
#
# Copyright 2016, Joyent, Inc.
#

unset LD_LIBRARY_PATH
PATH=/usr/bin:/usr/sbin
export PATH

sum_proc()
{
	pmap -x $1 2>/dev/null | nawk '{
		if ($1 == "Address") next
		if ($1 == "total") next
		if ($8 == "stack") {
			stk_kb += $2
			if ($3 != "-") stk_rss += $3
			if ($4 != "-") stk_anon += $4
			if ($5 != "-") stk_locked += $5
		} else if ($8 == "heap") {
			heap_kb += $2
			if ($3 != "-") heap_rss += $3
			if ($4 != "-") heap_anon += $4
			if ($5 != "-") heap_locked += $5
		} else if ($8 == "ism") {
			shm_kb += $2
			if ($3 != "-") shm_rss += $3
			if ($4 != "-") shm_anon += $4
			if ($5 != "-") shm_locked += $5
		} else {
			txt_kb += $2
			if ($3 != "-") txt_rss += $3
			if ($4 != "-") txt_anon += $4
			if ($5 != "-") txt_locked += $5
		}
	}
	END {
		printf("stk %d %d %6d %d\n",
		    stk_kb, stk_rss, stk_anon, stk_locked);
		printf("heap %d %d %d %d\n",
		    heap_kb, heap_rss, heap_anon, heap_locked);
		printf("shm %d %d %d %d\n",
		    shm_kb, shm_rss, shm_anon, shm_locked);
		printf("txt %d %d %d %d\n",
		    txt_kb, txt_rss, txt_anon, txt_locked);
	}'
}

sum_zone()
{
	for p in `ls $2/root/proc`
	do
		sum_proc $p
	done
}

do_proc()
{
	printf "    %8s %8s %8s %8s %8s %8s %8s %8s\n" \
	    "txtrss" "stkrss" "stkanon" "heaprss" "heapanon" "heaplck" \
	    "shmrss" "shmlck"
	for z in `zoneadm list`
	do
		[ $z == "global" ] && continue
		[[ "$ZONENAME" != "ALL" && "$ZONENAME" != "$z" ]] && continue
		echo "$z"
		zpath=`zonecfg -z $z info zonepath | cut -d' ' -f2`
		sum_zone $z $zpath | nawk '{
			if ($1 == "stk") {
				stk_kb += $2
				stk_rss += $3
				stk_anon += $4
				stk_locked += $5
			} else if ($1 == "heap") {
				heap_kb += $2
				heap_rss += $3
				heap_anon += $4
				heap_locked += $5
			} else if ($1 == "shm") {
				shm_kb += $2
				shm_rss += $3
				shm_anon += $4
				shm_locked += $5
			} else {
				txt_kb += $2
				txt_rss += $3
				txt_anon += $4
				txt_locked += $5
			}
		}
		END {
			printf("    %8d %8d %8d %8d %8d %8d %8d %8d\n",
			    txt_rss,
			    stk_rss, stk_anon,
			    heap_rss, heap_anon, heap_locked,
			    shm_rss, shm_locked);
		}'
	done

	exit 0;
}

usage() {
	echo 'zonememstat [-athH] [-p | -o] [-z zonename]'
}

HEADER=1
OVER=0
SUMMARY=0
SHOW_ALIAS=0
ZONENAME="ALL"
TOTAL=0

while getopts "aoHhptz:" opt
do
	case "$opt" in
	a)	SHOW_ALIAS=1;;
	H)	HEADER=0;;
	p)	SUMMARY=1;;
	o)	OVER=1;;
	t)	TOTAL=1;;
	z)	ZONENAME=$OPTARG;;
	h)	usage; exit 0;;
	*)	usage; exit 1;;
	esac
done
shift OPTIND-1

[ $SUMMARY == 1 ] && do_proc

kstat -m memory_cap -c zone_memory_cap | nawk \
    -v "show_alias=$SHOW_ALIAS" \
    -v "zname=$ZONENAME" \
    -v "over=$OVER" \
    -v "total=$TOTAL" \
    -v "header=$HEADER" \
    'BEGIN {
	# is gz if cap is UINT64_MAX / 1048576
	maxcap = 2147483000;
	OFMT = "%.2f"
	if (show_alias == 1) {
		alias_len = 12
		while ("vmadm list -o zonename,alias -H" | getline) {
		    zone_alias[$1] = $2
		    if (length($2) > alias_len) {
			alias_len = length($2);
		    }
                }
		if (header)
			printf("%37s %*s %8s %6s %8s %9s %5s\n", \
			    "ZONE", alias_len, "ALIAS", \
			    "RSS(MB)", "CAP(MB)", "NOVER", "POUT(MB)", \
			    "SWAP%");
	} else {
		if (header)
			printf("%37s %8s %8s %6s %9s %5s\n", \
			    "ZONE", "RSS(MB)", "CAP(MB)", "NOVER", "POUT(MB)", \
			    "SWAP%");
	}
    }
    {
	if ($1 == "nover") {
		nover = $2
		nover_t += nover
	} else if ($1 == "pagedout") {
		pout = $2 / 1048576
		pout_t += pout
	} else if ($1 == "physcap") {
		cap = $2 / 1048576
		if (cap < maxcap)
			cap_t += cap
	} else if ($1 == "rss") {
		rss = $2 / 1048576
		rss_t += rss
	} else if ($1 == "swap") {
		swap = $2 / 1048576
	} else if ($1 == "swapcap") {
		swapcap = $2 / 1048576
	} else if ($1 == "zonename") {
		if (zname != "ALL" && zname != $2)
			next
		if (over == 1 && nover == 0)
			next
		alias=zone_alias[$2]
		if (length(alias) == 0)
		    alias = "-"

		if (swapcap >= maxcap) {
			swappct = "-"
		} else {
			swappct = (swap / swapcap) * 100
		}

		# If cap is UINT64_MAX / 1048576
		if (cap >= maxcap) {
			if (show_alias == 1)
				printf("%37s %*s %8u %6s %8s %9s %5s\n",
				    $2, alias_len, alias, rss, "-", "-", "-",
				    swappct);
			else
				printf("%37s %8u %8s %6s %9s %5s\n",
				    $2, rss, "-", "-", "-", swappct);
		} else {
			if (show_alias == 1)
				printf("%37s %*s %8u %6u %8u %9u %5s\n",
				    $2, alias_len, alias, rss, cap, nover,
				    pout, swappct);
			else
				printf("%37s %8u %8u %6u %9u %5s\n",
				    $2, rss, cap, nover, pout, swappct);
		}
	}
    }
    END {
	if (total == 1) {
		if (show_alias == 1)
			printf("%37s %*s %8u %6u %8u %9u %5s\n",
			    "total", alias_len, "-", rss_t, cap_t,
			    nover_t, pout_t, "-");
		else
			printf("%37s %8u %8u %6u %9u %5s\n",
			    "total", rss_t, cap_t, nover_t, pout_t, "-");
	}
    }'
