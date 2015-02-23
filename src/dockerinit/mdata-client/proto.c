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
#include "reqid.h"
#include "crc32.h"
#include "base64.h"

/*
 * Receive timeout used prior to V2 negotiation:
 */
#define	RECV_TIMEOUT_MS		6000
/*
 * Receive timeout once we've successfully negotiated the V2 protocol with the
 * host.  Some V2 operations, like PUT, can take longer than 6 seconds to
 * complete.
 */
#define	RECV_TIMEOUT_MS_V2	45000

typedef enum mdata_proto_state {
	MDPS_MESSAGE_HEADER = 1,
	MDPS_MESSAGE_DATA,
	MDPS_MESSAGE_V2,
	MDPS_READY,
	MDPS_ERROR
} mdata_proto_state_t;

typedef enum mdata_proto_version {
	MDPV_VERSION_1 = 1,
	MDPV_VERSION_2 = 2
} mdata_proto_version_t;

typedef struct mdata_command {
	char mdc_reqid[REQID_LEN];
	string_t *mdc_request;
	string_t *mdc_response_data;
	mdata_response_t mdc_response;
	int mdc_done;
} mdata_command_t;

struct mdata_proto {
	mdata_plat_t *mdp_plat;
	mdata_command_t *mdp_command;
	mdata_proto_state_t mdp_state;
	mdata_proto_version_t mdp_version;
	boolean_t mdp_in_reset;
	char *mdp_errmsg;
	char *mdp_parse_errmsg;
};

static int proto_send(mdata_proto_t *mdp);
static int proto_recv(mdata_proto_t *mdp);

static int
proto_negotiate(mdata_proto_t *mdp)
{
	mdata_command_t *mdcsave;
	mdata_response_t mdr;
	string_t *rdata = NULL;
	int ret = -1;

	mdcsave = mdp->mdp_command;
	mdp->mdp_command = NULL;

	/*
	 * Assume Protocol Version 1 until we negotiate up to Version 2.
	 */
	mdp->mdp_version = MDPV_VERSION_1;

	if (proto_execute(mdp, "NEGOTIATE", "V2", &mdr, &rdata) == 0) {
		if (mdr == MDR_V2_OK)
			mdp->mdp_version = MDPV_VERSION_2;

		ret = 0;
	}

	mdp->mdp_command = mdcsave;
	if (rdata != NULL)
		dynstr_free(rdata);
	return (ret);
}

static int
proto_reset(mdata_proto_t *mdp)
{
	int permfail = 0;

	/*
	 * Prevent proto_execute() from calling back into proto_reset()
	 * while we're resetting:
	 */
	mdp->mdp_in_reset = B_TRUE;

retry:
	mdp->mdp_errmsg = NULL;

	/*
	 * Close our existing platform-specific code handle if we have
	 * one open:
	 */
	if (mdp->mdp_plat != NULL) {
		plat_fini(mdp->mdp_plat);
		mdp->mdp_plat = NULL;
	}

	mdp->mdp_state = MDPS_READY;

	/*
	 * Initialise the platform-specific code:
	 */
	if (plat_init(&mdp->mdp_plat, &mdp->mdp_errmsg, &permfail) == -1) {
		if (permfail) {
			return (-1);
		} else {
			sleep(1);
			goto retry;
		}
	}

	/*
	 * Determine what protocol our host supports:
	 */
	if (proto_negotiate(mdp) == -1) {
		sleep(1);
		goto retry;
	}

	mdp->mdp_in_reset = B_FALSE;
	mdp->mdp_errmsg = NULL;
	return (0);
}

static int
proto_parse_v2(mdata_proto_t *mdp, string_t *input, string_t *request_id,
    string_t *command, string_t *response_data)
{
	const char *endp = dynstr_cstr(input);
	unsigned long clen;
	uint32_t crc32;

	mdp->mdp_parse_errmsg = NULL;

	if (strstr(endp, "V2 ") != endp) {
		mdp->mdp_parse_errmsg = "message did not start with V2";
		return (-1);
	}
	endp += 3;

	/*
	 * Read Content Length:
	 */
	if ((clen = strtoul(endp, (char **) &endp, 10)) == 0) {
		mdp->mdp_parse_errmsg = "invalid content length";
		return (-1);
	}

	/*
	 * Skip whitespace:
	 */
	while (*endp == ' ')
		endp++;

	/*
	 * Read CRC32 checksum:
	 */
	if ((crc32 = strtoul(endp, (char **) &endp, 16)) == 0) {
		mdp->mdp_parse_errmsg = "invalid crc32 in frame";
		return (-1);
	}

	/*
	 * Skip whitespace:
	 */
	while (*endp == ' ')
		endp++;

	/*
	 * Ensure Content Length and CRC32 values from header match
	 * reality:
	 */
	if (strlen(endp) != clen || crc32_calc(endp, clen) != crc32) {
		mdp->mdp_parse_errmsg = "clen/crc32 mismatch";
		return (-1);
	}

	/*
	 * Read Request ID:
	 */
	while (*endp != ' ' && *endp != '\0') {
		dynstr_appendc(request_id, *endp++);
	}
	if (dynstr_len(request_id) == 0) {
		mdp->mdp_parse_errmsg = "missing request id";
		return (-1);
	}

	/*
	 * Skip whitespace:
	 */
	while (*endp == ' ')
		endp++;

	/*
	 * Read Command/Code:
	 */
	while (*endp != ' ' && *endp != '\0') {
		dynstr_appendc(command, *endp++);
	}
	if (dynstr_len(command) == 0) {
		mdp->mdp_parse_errmsg = "missing command/code";
		return (-1);
	}

	/*
	 * Skip Whitespace:
	 */
	while (*endp == ' ')
		endp++;

	/*
	 * Read the Response Data:
	 */
	if (base64_decode(endp, strlen(endp), response_data) == -1) {
		mdp->mdp_parse_errmsg = "base64 error";
		return (-1);
	}

	return (0);
}

static void
process_input(mdata_proto_t *mdp, string_t *input)
{
	const char *cstr = dynstr_cstr(input);
	string_t *command, *request_id;

	switch (mdp->mdp_state) {
	case MDPS_MESSAGE_V2:
		command = dynstr_new();
		request_id = dynstr_new();

		dynstr_reset(mdp->mdp_command->mdc_response_data);

		if (proto_parse_v2(mdp, input, request_id, command,
		    mdp->mdp_command->mdc_response_data) == -1) {
			/*
			 * XXX Presently, drop frames that we can't
			 * parse.
			 */

		} else if (strcmp(dynstr_cstr(request_id),
		    mdp->mdp_command->mdc_reqid) != 0) {
			/*
			 * XXX Presently, drop frames that are not for
			 * the currently outstanding request.
			 */

		} else if (strcmp(dynstr_cstr(command), "NOTFOUND") == 0) {
			mdp->mdp_state = MDPS_READY;
			mdp->mdp_command->mdc_response = MDR_NOTFOUND;
			mdp->mdp_command->mdc_done = 1;

		} else if (strcmp(dynstr_cstr(command), "SUCCESS") == 0) {
			mdp->mdp_state = MDPS_READY;
			mdp->mdp_command->mdc_response = MDR_SUCCESS;
			mdp->mdp_command->mdc_done = 1;

		} else {
			mdp->mdp_state = MDPS_READY;
			mdp->mdp_command->mdc_response = MDR_UNKNOWN;
			mdp->mdp_command->mdc_done = 1;
		}

		dynstr_free(command);
		dynstr_free(request_id);
		break;

	case MDPS_MESSAGE_HEADER:
		if (strcmp(cstr, "NOTFOUND") == 0) {
			mdp->mdp_state = MDPS_READY;
			mdp->mdp_command->mdc_response = MDR_NOTFOUND;
			mdp->mdp_command->mdc_done = 1;

		} else if (strcmp(cstr, "SUCCESS") == 0) {
			mdp->mdp_state = MDPS_MESSAGE_DATA;
			mdp->mdp_command->mdc_response = MDR_SUCCESS;

		} else if (strcmp(cstr, "V2_OK") == 0) {
			mdp->mdp_state = MDPS_READY;
			mdp->mdp_command->mdc_response = MDR_V2_OK;
			mdp->mdp_command->mdc_done = 1;

		} else if (strcmp(cstr, "invalid command") == 0) {
			mdp->mdp_state = MDPS_READY;
			mdp->mdp_command->mdc_response = MDR_INVALID_COMMAND;
			mdp->mdp_command->mdc_done = 1;

		} else {
			mdp->mdp_state = MDPS_READY;
			dynstr_append(mdp->mdp_command->mdc_response_data, cstr);
			mdp->mdp_command->mdc_response = MDR_UNKNOWN;
			mdp->mdp_command->mdc_done = 1;

		}
		break;

	case MDPS_MESSAGE_DATA:
		if (strcmp(cstr, ".") == 0) {
			mdp->mdp_state = MDPS_READY;
			mdp->mdp_command->mdc_done = 1;
		} else {
			string_t *respdata = mdp->mdp_command->mdc_response_data;
			int offs = cstr[0] == '.' ? 1 : 0;
			if (dynstr_len(respdata) > 0)
				dynstr_append(respdata, "\n");
			dynstr_append(respdata, cstr + offs);
		}
		break;

	case MDPS_READY:
	case MDPS_ERROR:
		break;

	default:
		ABORT("process_input: UNKNOWN STATE\n");
	}
}

static int
proto_send(mdata_proto_t *mdp)
{
	VERIFY(mdp->mdp_command);

	if (plat_send(mdp->mdp_plat, mdp->mdp_command->mdc_request) == -1) {
		mdp->mdp_state = MDPS_ERROR;
		return (-1);
	}

	/*
	 * Wait for response header from remote peer:
	 */
	switch (mdp->mdp_version) {
	case MDPV_VERSION_1:
		mdp->mdp_state = MDPS_MESSAGE_HEADER;
		break;
	case MDPV_VERSION_2:
		mdp->mdp_state = MDPS_MESSAGE_V2;
		break;
	default:
		ABORT("unknown protocol version");
	}

	return (0);
}

static int
proto_recv(mdata_proto_t *mdp)
{
	int ret = -1;
	string_t *line = dynstr_new();

	for (;;) {
		int recv_timeout_ms = mdp->mdp_version == MDPV_VERSION_2 ?
		    RECV_TIMEOUT_MS_V2 : RECV_TIMEOUT_MS;

		if (plat_recv(mdp->mdp_plat, line, recv_timeout_ms) == -1) {
			mdp->mdp_state = MDPS_ERROR;
			goto bail;
		}

		process_input(mdp, line);
		dynstr_reset(line);

		if (mdp->mdp_command->mdc_done)
			break;
	}

	ret = 0;

bail:
	dynstr_free(line);
	return (ret);
}

/*
 * Version 2 of the Metadata Protocol is, after a fashion, a framed
 * protocol.  Each 'frame' is really just a LF-terminated line of
 * text.  Request and Response payloads are BASE64-encoded to allow the
 * transmission of embedded LFs, and other potentially binary data.
 *
 * The line format is as follows:
 *                                            ,- Body (CRC32/Length is of
 *                  _____________________ <--/         this string)
 *   V2 21 265ae1d8 dc4fae17 SUCCESS W10=\n
 *    ^ ^  ^        ^        ^       ^   ^
 *    | |  |        |        |       |   \--- Terminating Linefeed.
 *    | |  |        |        |       \------- BASE64-encoded payload.
 *    | |  |        |        \--------------- Request Command or Response Code
 *    | |  |        \------------------------ Request ID (8 random hex digits)
 *    | |  \--------------------------------- CRC32 of Body as 8 hex digits
 *    | \------------------------------------ Content Length of Body, base 10
 *    \-------------------------------------- So that this can be a V1 command
 *                                            as well, we start with "V2".
 *                                            This will be a FAILURE on a
 *                                            host that only supports the
 *                                            V1 protocol.
 */
static void
proto_make_request_v2(const char *command, const char *argument,
    string_t *output, char *reqidbuf)
{
	char strbuf[23 + 1 + 8 + 1]; /* strlen(UINT64_MAX) + ' ' + %08x + \0 */
	string_t *body = dynstr_new();

	/*
	 * Generate the BODY of the V2 message, which is the portion we
	 * use when generating the Content Length and CRC32 checksum for
	 * the message HEADER.
	 */
	dynstr_append(body, reqid(reqidbuf));
	dynstr_append(body, " ");
	dynstr_append(body, command);
	if (argument != NULL) {
		dynstr_append(body, " ");
		base64_encode(argument, strlen(argument), body);
	}

	/*
	 * Generate the HEADER directly into the output, and then
	 * append the BODY:
	 */
	dynstr_append(output, "V2 ");
	sprintf(strbuf, "%u %08x", (unsigned int) dynstr_len(body), crc32_calc(
	    dynstr_cstr(body), dynstr_len(body)));
	dynstr_append(output, strbuf);
	dynstr_append(output, " ");
	dynstr_append(output, dynstr_cstr(body));
	dynstr_append(output, "\n");

	dynstr_free(body);
}

static void
proto_make_request_v1(const char *command, const char *argument,
    string_t *output)
{
	dynstr_append(output, command);
	if (argument != NULL) {
		dynstr_append(output, " ");
		dynstr_append(output, argument);
	}
	dynstr_append(output, "\n");
}

int
proto_execute(mdata_proto_t *mdp, const char *command, const char *argument,
    mdata_response_t *response, string_t **response_data)
{
	mdata_command_t mdc;

	/*
	 * Initialise new command structure:
	 */
	bzero(&mdc, sizeof (mdc));
	mdc.mdc_request = dynstr_new();
	mdc.mdc_response_data = dynstr_new();
	mdc.mdc_response = MDR_PENDING;
	mdc.mdc_done = 0;

	VERIFY0(mdp->mdp_command);
	mdp->mdp_command = &mdc;

retry:
	/*
	 * (Re-)generate request string to send to remote peer:
	 */
	dynstr_reset(mdc.mdc_request);
	switch (mdp->mdp_version) {
	case MDPV_VERSION_1:
		proto_make_request_v1(command, argument, mdc.mdc_request);
		break;
	case MDPV_VERSION_2:
		proto_make_request_v2(command, argument, mdc.mdc_request,
		    mdc.mdc_reqid);
		break;
	default:
		ABORT("unknown protocol version");
	}

	/*
	 * Attempt to send the request to the remote peer:
	 */
	if (mdp->mdp_state == MDPS_ERROR || proto_send(mdp) != 0 ||
	    proto_recv(mdp) != 0) {
		/*
		 * Discard existing response data and reset the command
		 * state:
		 */
		dynstr_reset(mdp->mdp_command->mdc_response_data);
		mdc.mdc_response = MDR_PENDING;

		/*
		 * If the command we're trying to send is part of a
		 * protocol reset sequence, just fail immediately:
		 */
		if (mdp->mdp_in_reset)
			goto bail;

		/*
		 * We could not send the request, so reset the stream
		 * and try again:
		 */
		/* XXX disabled for use as library
		 * fprintf(stderr, "receive timeout, resetting "
		 *   "protocol...\n");
		.*/
		if (proto_reset(mdp) == -1) {
			/*
			 * We could not do a reset, so abort the whole
			 * thing.
			 */
			/* XXX disabled for use as library
			 * fprintf(stderr, "ERROR: while resetting connection: "
			 *    "%s\n", mdp->mdp_errmsg);
			 */
			goto bail;
		} else {
			/*
			 * We were able to reset OK, so keep trying.
			 */
			goto retry;
		}
	}

	if (mdp->mdp_state != MDPS_READY)
		ABORT("proto state not MDPS_READY\n");

	/*
	 * We were able to send a command and receive a response.
	 * Examine the response and decide what to do:
	 */
	*response = mdc.mdc_response;
	*response_data = mdc.mdc_response_data;
	dynstr_free(mdc.mdc_request);
	mdp->mdp_command = NULL;
	return (0);

bail:
	dynstr_free(mdc.mdc_request);
	dynstr_free(mdc.mdc_response_data);
	mdp->mdp_command = NULL;
	return (-1);
}

int
proto_version(mdata_proto_t *mdp)
{
	return (mdp->mdp_version);
}

int
proto_init(mdata_proto_t **out, char **errmsg)
{
	mdata_proto_t *mdp;

	reqid_init();

	if ((mdp = calloc(1, sizeof (*mdp))) == NULL)
		return (-1);

	if (proto_reset(mdp) == -1) {
		*errmsg = mdp->mdp_errmsg;
		free(mdp);
		return (-1);
	}

	*out = mdp;

	return (0);
}
