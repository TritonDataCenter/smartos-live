#!/bin/bash
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
# Copyright 2012, Joyent, Inc.  All rights reserved.
#

PATH=/usr/bin:/usr/sbin
export PATH

count=-1

shift $(( $OPTIND - 1 ))

[[ "$1" > 0 ]] && count=$1

/usr/sbin/dtrace -qn '

inline int COUNTER     = '$count';

dtrace:::BEGIN
{
        maxcnt = COUNTER;
	cnt = 0;
}

fbt::fss_update:entry
{
	/*      pid tid zid prd tks opr npr prn ps% zrt  shu  fssp */
	printf("%5s %6s %3s %3s %3s %3s %3s %3s %3s %5s %12s %14s\n",
	    "pid",
	    "tid",
	    "zid",
	    "prd",
	    "tks",
	    "opr",
	    "npr",
	    "prn",
	    "ps%",
	    "zrtck",
	    "shusage",
	    "prjuse");
        self->t = 1;
	cnt++;
}

fbt::fss_update:return
/cnt == maxcnt/
{
        exit(0);
}

fbt::fss_update:return
{
        self->t = 0;
}

fbt::fss_newpri:entry
/self->t/
{
	self->fpp = (fssproc_t *)arg0;
	self->org_pri = self->fpp->fss_umdpri;
	self->org_ticks = self->fpp->fss_ticks;
}

fbt::fss_newpri:return
/self->t/
{
	/*      pid tid zid prd tks opr npr prn ps% zrt    shu  fssp */
	printf("%5d %6d %3d %3d %3d %3d %3d %3d %3d %5d %12llu %14llu\n",
	    self->fpp->fss_tp->t_procp->p_pidp->pid_id,
	    self->fpp->fss_tp->t_did,
	    self->fpp->fss_proj->fssp_fsszone->fssz_zone->zone_id,
	    self->fpp->fss_proj->fssp_proj->kpj_id,
	    self->org_ticks,
	    self->org_pri,
	    self->fpp->fss_umdpri,
	    self->fpp->fss_proj->fssp_runnable,
	    self->fpp->fss_proj->fssp_shr_pct / 10,
	    self->fpp->fss_proj->fssp_fsszone->fssz_zone->zone_run_ticks,
	    (unsigned long long)self->fpp->fss_proj->fssp_shusage,
	    (unsigned long long)self->fpp->fss_proj->fssp_usage);

	    /* (unsigned long long)self->fpp->fss_fsspri); */

	self->org_pri = 0;
	self->org_ticks = 0;
	self->fpp = 0;
}

sdt:::fss-onproc
{
	this->fpp = (fssproc_t *)arg0;

	/*      pid tid zid prd tks opr npr prn ps% zrt    shu  fssp */
	printf("%5d %6d %3d %3d %3d %3d   * %3d %3d %5d %12llu %14llu\n",
	    this->fpp->fss_tp->t_procp->p_pidp->pid_id,
	    this->fpp->fss_tp->t_did,
	    this->fpp->fss_proj->fssp_fsszone->fssz_zone->zone_id,
	    this->fpp->fss_proj->fssp_proj->kpj_id,
	    this->fpp->fss_ticks,
	    this->fpp->fss_umdpri,
	    this->fpp->fss_proj->fssp_runnable,
	    this->fpp->fss_proj->fssp_shr_pct / 10,
	    this->fpp->fss_proj->fssp_fsszone->fssz_zone->zone_run_ticks,
	    (unsigned long long)this->fpp->fss_proj->fssp_shusage,
	    (unsigned long long)this->fpp->fss_proj->fssp_usage);

	    /* (unsigned long long)this->fpp->fss_fsspri); */
}
'
