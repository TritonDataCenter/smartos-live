/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#include <stdlib.h>
#include <stdio.h>
#include <err.h>
#include <string.h>
#include <strings.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <err.h>
#include <errno.h>
#include <termios.h>
#include <sys/socket.h>
#include <sys/un.h>

#include <sys/epoll.h>

#include "common.h"
#include "plat.h"
#include "dynstr.h"
#include "plat/unix_common.h"

#define	SERIAL_DEVICE	"/dev/ttyS1"

typedef struct mdata_plat {
	int mpl_epoll;
	int mpl_conn;
} mdata_plat_t;


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
	for (;;) {
		struct epoll_event event;

		if (epoll_wait(mpl->mpl_epoll, &event, 1, timeout_ms) == -1) {
			fprintf(stderr, "epoll error: %d\n", errno);
			if (errno == EINTR) {
				return (-1);
			}
			err(1, "EPOLL_WAIT ERROR");
		}

		if (event.data.fd == 0 || event.events == 0) {
			fprintf(stderr, "plat_recv timeout\n");
			return (-1);
		}

		if (event.events & EPOLLIN) {
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
		if (event.events & EPOLLERR) {
			fprintf(stderr, "POLLERR\n");
			return (-1);
		}
		if (event.events & EPOLLHUP) {
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
		if (mpl->mpl_epoll != -1)
			(void) close(mpl->mpl_epoll);
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
	mdata_plat_t *mpl = NULL;
	struct epoll_event event;

	if ((mpl = calloc(1, sizeof (*mpl))) == NULL) {
		*errmsg = "Could not allocate memory.";
		*permfail = 1;
		goto bail;
	}
	mpl->mpl_epoll = -1;
	mpl->mpl_conn = -1;

	if ((mpl->mpl_epoll = epoll_create(1)) == -1) {
		*errmsg = "Could not create epoll fd.";
		*permfail = 1;
		goto bail;
	}

	if (unix_open_serial(SERIAL_DEVICE, &mpl->mpl_conn, errmsg,
	    permfail) != 0) {
		goto bail;
	}

	event.data.fd = mpl->mpl_conn;
	event.events = EPOLLIN | EPOLLERR | EPOLLHUP;

	if (epoll_ctl(mpl->mpl_epoll, EPOLL_CTL_ADD, mpl->mpl_conn,
	    &event) == -1) {
		*errmsg = "Could not add conn to epoll context.";
		*permfail = 1;
		goto bail;
	}

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
