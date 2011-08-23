/*
 * Copyright (c) 2011 Joyent Inc., All rights reserved.
 *
 * Receives a single broadcast message on the given interface.  The interface
 * must be plumbed, but does not need to have an IP address.
 *
 * Intended to be used with its counterpart, "marco", which sends the message that will be received here.
 *
 * Compile with: gcc -Wall -o polo polo.c -lsocket
 */
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/socket_impl.h>
#include <arpa/inet.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/sockio.h>
#include <sys/socket.h>
#include <net/if.h>


#define PORT 41234
#define TIMEOUT 30
#define TAG_SIZE 32

int v4_sock_fd = -1;


/*
 * Based on code from dhcpagent
 */
boolean_t
bind_sock(int fd, in_port_t port_hbo, in_addr_t addr_hbo)
{
	struct sockaddr_in	sin;
	int	on = 1;

	(void) memset(&sin, 0, sizeof (struct sockaddr_in));
	sin.sin_family = AF_INET;
	sin.sin_port   = htons(port_hbo);
	sin.sin_addr.s_addr = htonl(addr_hbo);

	if (setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof (int)) == -1) {
		perror("bind_sock: Setting SO_REUSEADDR failed");
		return (B_FALSE);
    }

	return (bind(fd, (struct sockaddr *)&sin, sizeof (sin)) == 0);
}


boolean_t
interface_init(const char *pname)
{
	uint32_t ifindex;
    in_addr_t addr_hbo = INADDR_ANY;
	struct lifreq lifr;

    /* Create datagram socket */
	if ((v4_sock_fd = socket(AF_INET, SOCK_DGRAM, 0)) == -1) {
		perror("interface_init: cannot create socket");
		return (B_FALSE);
	}

    /* Bind it to the port */
	if (!bind_sock(v4_sock_fd, PORT, addr_hbo)) {
		perror("interface_init: cannot bind socket");
        return (B_FALSE);
	}

	(void) strlcpy(lifr.lifr_name, pname, LIFNAMSIZ);
	if (ioctl(v4_sock_fd, SIOCGLIFINDEX, &lifr) == -1) {
        perror("interface_init: cannot get SIOCGLIFINDEX");
        return (B_FALSE);
	}
	ifindex = lifr.lifr_index;

    /* Bind the socket to an interface address */
	if (setsockopt(v4_sock_fd, IPPROTO_IP, IP_BOUND_IF, &ifindex,
	    sizeof (int)) == -1) {
        perror("interface_init: cannot set IP_BOUND_IF");
        return (B_FALSE);
	}

	if (ioctl(v4_sock_fd, SIOCGLIFFLAGS, &lifr) == -1) {
        perror("interface_init: cannot get SIOCGLIFFLAGS");
        return (B_FALSE);
	}

	if (!(lifr.lifr_flags & IFF_UP)) {
		lifr.lifr_flags |= IFF_UP;
		if (ioctl(v4_sock_fd, SIOCSLIFFLAGS, &lifr) == -1) {
            perror("interface_init: cannot bring up interface");
            return (B_FALSE);
		}
	}

    return (B_TRUE);
}


static ssize_t
recv_pkt(void)
{
	struct iovec iov;
	struct msghdr msg;
	ssize_t msglen;
    char pack[TAG_SIZE];
    size_t pack_len = sizeof(pack);

	(void) memset(&pack, 0, pack_len);
	(void) memset(&iov, 0, sizeof (iov));
	(void) memset(&msg, 0, sizeof (msg));

	iov.iov_base = (caddr_t)&pack;
	iov.iov_len = pack_len;
	msg.msg_iov = &iov;
	msg.msg_iovlen = 1;

	if ((msglen = recvmsg(v4_sock_fd, &msg, 0)) != -1) {
        printf("%s\n", pack);
	}
	return (msglen);
}


static void
timeout(int num)
{
    if (v4_sock_fd != -1)
        close(v4_sock_fd);
    _exit(0);
}


int
main(int argc, char **argv)
{
    int secs = TIMEOUT;
    if (argc < 2) {
        fprintf(stderr, "usage: %s device [timeout]\n", argv[0]);
        return (1);
    }
    if (argc >= 3) {
        secs = atoi(argv[2]);
        if (secs == 0) {
            fprintf(stderr, "Invalid timeout value\n");
            return (1);
        }
    }
    signal(SIGALRM, timeout);
    alarm(secs);

    if (interface_init(argv[1]) == B_FALSE)
        return (1);
    recv_pkt();
    close(v4_sock_fd);
    return (0);
}
