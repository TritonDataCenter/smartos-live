/*
* CDDL HEADER START
*
* The contents of this file are subject to the terms of the
* Common Development and Distribution License, Version 1.0 only
* (the "License").  You may not use this file except in compliance
* with the License.
*
* You can obtain a copy of the license at COPYING
* See the License for the specific language governing permissions
* and limitations under the License.
*
* When distributing Covered Code, include this CDDL HEADER in each
* file and include the License file at COPYING.
* If applicable, add the following below this CDDL HEADER, with the
* fields enclosed by brackets "[]" replaced with your own identifying
* information: Portions Copyright [yyyy] [name of copyright owner]
*
* CDDL HEADER END
*
* Copyright (c) 2010,2011 Joyent Inc.
*
*/

/*
 * Summary:
 *
 *  Takes plain-text password as cmdline arg and outputs a crypt() version.
 *
 */

#include <crypt.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void usage()
{
    printf("Usage: cryptpass <password>\n");
    exit(1);
}

int main(int argc, char *argv[])
{
    char *salt, *enc;

    if ((argc != 2) || (strlen(argv[1]) < 1)) {
        usage();
    }

    errno=0;
    salt=crypt_gensalt(NULL, NULL);
    if (salt == NULL) {
        printf("FATAL: crypt_gensalt() errno=%d\n", errno);
        exit(1);
    }

    enc = crypt(argv[1], salt);
    if (enc == NULL) {
        printf("FATAL: crypt() errno=%d\n", errno);
        free(salt);
        exit(1);
    }

    printf("%s\n", enc);

    free(salt);
    exit(0);
}
