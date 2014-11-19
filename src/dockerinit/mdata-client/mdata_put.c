/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#include <stdlib.h>
#include <stdio.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <err.h>
#include <errno.h>
#include <string.h>
#include <strings.h>

#include "common.h"
#include "dynstr.h"
#include "plat.h"
#include "proto.h"
#include "base64.h"

typedef enum mdata_exit_codes {
	MDEC_SUCCESS = 0,
	MDEC_NOTFOUND = 1,
	MDEC_ERROR = 2,
	MDEC_USAGE_ERROR = 3,
	MDEC_TRY_AGAIN = 10
} mdata_exit_codes_t;

static char *keyname;

static int
print_response(mdata_response_t mdr, string_t *data)
{
	switch (mdr) {
	case MDR_SUCCESS:
		return (MDEC_SUCCESS);
	case MDR_NOTFOUND:
		fprintf(stderr, "No metadata for '%s'\n", keyname);
		return (MDEC_NOTFOUND);
	case MDR_UNKNOWN:
		fprintf(stderr, "Error putting metadata for key '%s': %s\n",
		    keyname, dynstr_cstr(data));
		return (MDEC_ERROR);
	case MDR_INVALID_COMMAND:
		fprintf(stderr, "ERROR: host does not support PUT\n");
		return (MDEC_ERROR);
	default:
		ABORT("print_response: UNKNOWN RESPONSE\n");
		return (MDEC_ERROR);
	}
}

int
main(int argc, char **argv)
{
	mdata_proto_t *mdp;
	mdata_response_t mdr;
	string_t *data;
	char *errmsg = NULL;
	string_t *req = dynstr_new();

	if (argc < 2) {
		errx(MDEC_USAGE_ERROR, "Usage: %s <keyname> [ <value> ]",
		    argv[0]);
	}

	if (proto_init(&mdp, &errmsg) != 0) {
		fprintf(stderr, "ERROR: could not initialise protocol: %s\n",
		    errmsg);
		return (MDEC_ERROR);
	}

	if (proto_version(mdp) < 2) {
		fprintf(stderr, "ERROR: host does not support PUT\n");
		return (MDEC_ERROR);
	}

	keyname = strdup(argv[1]);

	base64_encode(argv[1], strlen(argv[1]), req);
	dynstr_appendc(req, ' ');
	if (argc >= 3) {
		/*
		 * Use second argument as the value to put.
		 */
		base64_encode(argv[2], strlen(argv[2]), req);
	} else {
		int c;
		string_t *stdinstr = dynstr_new();

		dynstr_append(stdinstr, "");

		if (plat_is_interactive()) {
			fprintf(stderr, "ERROR: either specify the metadata "
			    "value as the second command-line argument, or "
			    "pipe content to stdin.\n");
			return (MDEC_ERROR);
		}

		while ((c = fgetc(stdin)) != EOF) {
			dynstr_appendc(stdinstr, (char) c);
		}
		if (ferror(stdin)) {
			fprintf(stderr, "ERROR: could not read from stdin: "
			    "%s\n", strerror(errno));
			return (MDEC_ERROR);
		}

		base64_encode(dynstr_cstr(stdinstr), dynstr_len(stdinstr),
		    req);
		dynstr_free(stdinstr);
	}

	if (proto_execute(mdp, "PUT", dynstr_cstr(req), &mdr, &data) != 0) {
		fprintf(stderr, "ERROR: could not execute GET\n");
		return (MDEC_ERROR);
	}

	dynstr_free(req);

	return (print_response(mdr, data));
}
