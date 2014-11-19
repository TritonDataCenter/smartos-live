/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#include <stdlib.h>
#include <err.h>
#include <smbios.h>
#include <string.h>
#include <strings.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <err.h>
#include <errno.h>
#include <termios.h>
#include <zone.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/filio.h>
#include <port.h>

#include "common.h"
#include "dynstr.h"
#include "plat.h"
#include "plat/unix_common.h"

#define	IN_GLOBAL_DEVICE	"/dev/term/b"

static char *zone_md_socket_paths[] = {
	"/native/.zonecontrol/metadata.sock",		/* SDC7 + LX */
	"/.zonecontrol/metadata.sock",		/* SDC7 */
	"/var/run/smartdc/metadata.sock",	/* SDC6 */
	NULL
};

struct mdata_plat {
	int mpl_port;
	int mpl_conn;
};

static int
find_product(smbios_hdl_t *shp, const smbios_struct_t *sp, void *arg)
{
	char **outputp = arg;
	smbios_info_t info;

	if (sp->smbstr_type != SMB_TYPE_SYSTEM)
		return (0);

	if (smbios_info_common(shp, sp->smbstr_id, &info) != 0)
		return (0);

	if (info.smbi_product[0] != '\0') {
		*outputp = strdup(info.smbi_product);
	}

	return (0);
}

static char *
get_product_string(void)
{
	char *output = NULL;
	int e;
	smbios_hdl_t *shp;

	if ((shp = smbios_open(NULL, SMB_VERSION, 0, &e)) == NULL) {
		return (NULL);
	}

	smbios_iter(shp, find_product, &output);

	smbios_close(shp);

	return (output);
}

static int
find_md_ngz(const char **out, int *permfail)
{
	int i;
	struct stat st;

	/*
	 * The location of the metadata socket has changed between SDC6
	 * and SDC7.  Attempt to locate the one that exists in this instance:
	 */
	for (i = 0; zone_md_socket_paths[i] != NULL; i++) {
		if (lstat(zone_md_socket_paths[i], &st) == 0 &&
		    S_ISSOCK(st.st_mode)) {
			*out = zone_md_socket_paths[i];
			return (0);
		} else {
			/*
			 * If we're not root, and we get an EACCES, it's
			 * often a permissions problem.  Don't retry
			 * forever:
			 */
			if (geteuid() != 0 && (errno == EPERM ||
			    errno == EACCES))
				*permfail = 1;
		}
	}

	return (-1);
}

static int
open_md_ngz(int *outfd, char **errmsg, int *permfail)
{
	/*
	 * We're in a non-global zone, so try and connect to the
	 * metadata socket:
	 */
	long on = 1L;
	int fd;
	const char *sockpath;
	struct sockaddr_un ua;

	/*
	 * This is not always a permanent failure, because the metadata
	 * socket might not exist yet.  Keep trying and wait for it to
	 * appear.
	 */
	if (find_md_ngz(&sockpath, permfail) == -1) {
		*errmsg = "Could not find metadata socket.";
		return (-1);
	}

	if ((fd = socket(AF_UNIX, SOCK_STREAM, 0)) == -1) {
		*errmsg = "Could not open metadata socket.";
		*permfail = 1;
		return (-1);
	}

	/*
	 * Enable non-blocking I/O on the socket so that we can time-out
	 * when we want to:
	 */
	if (ioctl(fd, (int)FIONBIO, &on) != 0) {
		*errmsg = "Could not set non-blocking I/O on socket.";
		(void) close(fd);
		*permfail = 1;
		return (-1);
	}

	bzero(&ua, sizeof (ua));
	ua.sun_family = AF_UNIX;
	strcpy(ua.sun_path, sockpath);

	if (connect(fd, (struct sockaddr *)&ua, sizeof (ua)) == -1) {
		(void) close(fd);
		*errmsg = "Could not connect metadata socket.";
		return (-1);
	}

	*outfd = fd;

	return (0);
}

static int
open_md_gz(int *outfd, char **errmsg, int *permfail)
{
	/*
	 * We're in a global zone in a SmartOS KVM/QEMU instance, so
	 * try to use /dev/term/b for metadata.
	 */

	return (unix_open_serial(IN_GLOBAL_DEVICE, outfd, errmsg, permfail));
}

int
plat_send(mdata_plat_t *mpl, string_t *data)
{
	int len = dynstr_len(data);

	if (write(mpl->mpl_conn, dynstr_cstr(data), len) != len)
		return (-1);

	return (0);
}

int
plat_recv(mdata_plat_t *mpl, string_t *data, int timeout_ms)
{
	port_event_t pev;
	timespec_t tv;

	for (;;) {
		if (port_associate(mpl->mpl_port, PORT_SOURCE_FD, mpl->mpl_conn,
		    POLLIN | POLLERR | POLLHUP , NULL) != 0) {
			fprintf(stderr, "port_associate error: %s\n",
			    strerror(errno));
			return (-1);
		}

		tv.tv_sec = timeout_ms / 1000;
		timeout_ms -= tv.tv_sec * 1000;
		tv.tv_nsec = timeout_ms * 1000 * 1000; /* 100ms */

		if (port_get(mpl->mpl_port, &pev, &tv) == -1) {
			if (errno == ETIME) {
				fprintf(stderr, "plat_recv timeout\n");
				return (-1);
			}
			fprintf(stderr, "port_get error: %s\n",
			    strerror(errno));
			return (-1);
		}

		if (pev.portev_events & POLLIN) {
			char buf[2];
			ssize_t sz;

			if ((sz = read(mpl->mpl_conn, buf, 1)) > 0) {
				if (buf[0] == '\n') {
					return (0);
				} else {
					buf[1] = '\0';
					dynstr_append(data, buf);
				}
			}
		}
		if (pev.portev_events & POLLERR) {
			fprintf(stderr, "POLLERR\n");
			return (-1);
		}
		if (pev.portev_events & POLLHUP) {
			fprintf(stderr, "POLLHUP\n");
			return (-1);
		}
	}

	return (-1);
}

void
plat_fini(mdata_plat_t *mpl)
{
	if (mpl != NULL) {
		if (mpl->mpl_port != -1)
			(void) close(mpl->mpl_port);
		if (mpl->mpl_conn != -1)
			(void) close(mpl->mpl_conn);
		free(mpl);
	}
}

static int
plat_send_reset(mdata_plat_t *mpl)
{
	int ret = -1;
	string_t *str = dynstr_new();

	dynstr_append(str, "\n");

	if (plat_send(mpl, str) != 0)
		goto bail;
	dynstr_reset(str);

	if (plat_recv(mpl, str, 2000) != 0)
		goto bail;

	if (strcmp(dynstr_cstr(str), "invalid command") != 0)
		goto bail;

	ret = 0;

bail:
	dynstr_free(str);
	return (ret);
}

int
plat_is_interactive(void)
{
	return (unix_is_interactive());
}

int
plat_init(mdata_plat_t **mplout, char **errmsg, int *permfail)
{
	char *product;
	boolean_t smartdc_hvm_guest = B_FALSE;
	mdata_plat_t *mpl = NULL;

	if ((mpl = calloc(1, sizeof (*mpl))) == NULL) {
		*errmsg = "Could not allocate memory.";
		*permfail = 1;
		goto bail;
	}
	mpl->mpl_port = -1;
	mpl->mpl_conn = -1;

	if ((mpl->mpl_port = port_create()) == -1) {
		*errmsg = "Could not create event port.";
		*permfail = 1;
		goto bail;
	}

	if (getzoneid() != GLOBAL_ZONEID) {
		if (open_md_ngz(&mpl->mpl_conn, errmsg, permfail) != 0)
			goto bail;
		goto wrapfd;
	}

	/*
	 * Interrogate the SMBIOS data from the system to see if we're
	 * in a KVM/QEMU virtual machine:
	 */
	product = get_product_string();
	if (product != NULL && strcmp(product, "SmartDC HVM") == 0)
		smartdc_hvm_guest = B_TRUE;
	free(product);

	if (smartdc_hvm_guest) {
		if (open_md_gz(&mpl->mpl_conn, errmsg, permfail) != 0)
			goto bail;
		goto wrapfd;
	}

	/*
	 * We have no idea.
	 */
	*errmsg = "I don't know how to get metadata on this system.";
	*permfail = 1;
	goto bail;

wrapfd:
	if (plat_send_reset(mpl) == -1) {
		*errmsg = "Could not do active reset.";
		goto bail;
	}

	*mplout = mpl;

	return (0);

bail:
	plat_fini(mpl);
	return (-1);
}
