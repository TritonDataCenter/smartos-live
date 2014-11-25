/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 *
 * Portions based on Public Domain work obtained from:
 *  https://shell.franken.de/svn/sky/xmlstorage/trunk/c++/xmlrpc/base64.cpp
 */

#include "stdlib.h"
#include "stdio.h"
#include "dynstr.h"
#include "stdint.h"

static const char base64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz0123456789+/";

void
base64_encode(uint8_t *input, size_t len, string_t *output)
{
	char tmp[5];
	unsigned int i = 0;

	tmp[4] = '\0';
	dynstr_append(output, "");

	while (i < len) {
		uint32_t c = input[i++] << 16;
		if (i < len)
			c |= input[i] << 8;
		i++;
		if (i < len)
			c |= input[i];
		i++;

		tmp[0] = base64[(c & 0x00fc0000) >> 18];
		tmp[1] = base64[(c & 0x0003f000) >> 12];
		tmp[2] = i > len + 1 ? '=' : base64[(c & 0x00000fc0) >> 6];
		tmp[3] = i > len ? '=' : base64[c & 0x0000003f];

		dynstr_append(output, tmp);
	}
}

static int
decode_one(char c)
{
	if (c >= 'A' && c <= 'Z')
		return (c - 'A');
	if (c >= 'a' && c <= 'z')
		return (c - 'a' + 26);
	if (c >= '0' && c <= '9')
		return (c - '0' + 52);
	if (c == '+')
		return (62);
	if (c == '/')
		return (63);
	if (c == '=')
		return (-1);

	return (-2);
}

int
base64_decode(const char *input, size_t len, string_t *output)
{
	int typ[4];
	uint8_t buf[4];
	unsigned int i, j;

	buf[3] = '\0';
	dynstr_append(output, "");

	/*
	 * Valid encoded strings are a multiple of 4 characters long:
	 */
	if (len % 4 != 0)
		return (-1);

	for (i = 0; i < len; i += 4) {
		for (j = 0; j < 4; j++)
			typ[j] = decode_one(input[i + j]);

		/*
		 * Filler must be contiguous on the right of the input
		 * string, and at most two bytes:
		 */
		if (typ[0] == -1 || typ[1] == -1)
			return (-1);
		if (typ[2] == -1 && typ[3] != -1)
			return (-1);

		buf[0] = (typ[0] << 2) | (typ[1] >> 4);
		if (typ[2] != -1)
			buf[1] = ((typ[1] & 0x0f) << 4) | (typ[2] >>2);
		else
			buf[1] = '\0';
		if (typ[3] != -1)
			buf[2] = ((typ[2] & 0x03) << 6) | typ[3];
		else
			buf[2] = '\0';

		dynstr_append(output, (const char *) buf);
	}

	return (0);
}
