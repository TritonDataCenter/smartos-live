/*
 * sha1num.c --- generate sha1 hash based, pseudo random numbers
 *
 * Copyright (C) 2005 by Olivier Guerrier
 *
 * This file may be distributed under the terms of the GNU Public
 * License.
 */

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include "pwgen.h"
#include "sha1.h"

sha1_context sha1_ctx;
char *sha1_seed;
const char *sha1_magic="pwgen";
unsigned char sha1sum[20];
int sha1sum_idx=20;
	
void pw_sha1_init(char *sha1)
{
        int i = 0;
	char *seed;
	FILE *f;
        unsigned char buf[1024];

	if ((seed = strchr(sha1,'#'))) {
		*(seed++) = 0;
		sha1_seed = malloc(strlen(seed)+1);
	        if (!sha1_seed) {
	                fprintf(stderr, "Couldn't malloc sha1_seed buffer.\n");
	                exit(1);
	        }
		strcpy(sha1_seed, seed);
	}
	else {
		sha1_seed = malloc(strlen(sha1_magic)+1);
	        if (!sha1_seed) {
	                fprintf(stderr, "Couldn't malloc sha1_seed buffer.\n");
	                exit(1);
	        }
		strcpy(sha1_seed, sha1_magic);
	}

	if( ! ( f = fopen( sha1, "rb" ) ) ) {
	        fprintf(stderr, "Couldn't open file: %s.\n", sha1);
		exit(1);
	}

	sha1_starts( &sha1_ctx );                                   
	while( ( i = fread( buf, 1, sizeof( buf ), f ) ) > 0 ) {
		sha1_update( &sha1_ctx, buf, i );
	}

	return;
}


int pw_sha1_number(int max_num)
{
	int val;
	sha1_context ctx;
	
	if (sha1sum_idx>19) {
		sha1sum_idx = 0;
		sha1_update(&sha1_ctx, (unsigned char *) sha1_seed, 
			    strlen(sha1_seed));
		ctx = sha1_ctx;
		sha1_finish(&ctx, sha1sum );
	}
	val = (int) (sha1sum[sha1sum_idx++] / ((float) 256) * max_num);
	return (val);
}
