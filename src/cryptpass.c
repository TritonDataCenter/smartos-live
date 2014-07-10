/*
 * Copyright (c) 2010 Joyent Inc., All rights reserved.
 *
 * Summary:
 *
 * Takes plain-text password as cmdline arg and outputs a crypt() version.
 */

#include <crypt.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void
usage(void)
{
	printf("Usage: cryptpass <password>\n");
	exit(1);
}

int
main(int argc, char *argv[])
{
	char *salt, *enc;

	if ((argc != 2) || (strlen(argv[1]) < 1)) {
		usage();
	}

	errno = 0;
	salt = crypt_gensalt(NULL, NULL);
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
