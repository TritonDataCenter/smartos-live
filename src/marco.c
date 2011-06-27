/*
 * Copyright (c) 2011 Joyent Inc., All rights reserved.
 *
 * Sends a broadcast message on the given interface.  The interface must be
 * plumbed, but does not need to have an IP address.
 *
 * Intended to be used with its counterpart, "polo"
 *
 * Compile with: gcc -Wall -o marco marco.c -lsocket
 */

#include <sys/types.h>
#include <stdio.h>
#include <arpa/inet.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <net/if.h>
#include <sys/sockio.h>

#define PORT 41234
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

	if(setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof (int)) == -1) {
		perror("bind_sock: Setting SO_REUSEADDR failed");
		return (B_FALSE);
    }

	return (bind(fd, (struct sockaddr *)&sin, sizeof (sin)) == 0);
}


boolean_t
interface_init(const char *pname)
{
	int on = 1;
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

	/*
	 * Enable IP_UNSPEC_SRC so that we can send packets with an unspecified
     * (0.0.0.0) address.  Also, enable IP_DHCPINIT_IF so that
	 * the IP module will accept unicast DHCP traffic regardless of the IP
	 */
    if (setsockopt(v4_sock_fd, IPPROTO_IP, IP_UNSPEC_SRC,
        &on, sizeof (int)) == -1) {
        perror("interface_init: cannot set IP_UNSPEC_SRC");
        return (B_FALSE);
    }

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


boolean_t
send_packet(const char * msg)
{
    in_addr_t dest = htonl(INADDR_BROADCAST);
	ssize_t		n_bytes;
    struct sockaddr_in v4;
    int msg_len = strlen(msg);

	/* XXX: apparently packets under a certain size may be dropped
     * by routers (sizeof(PKT)).  Should pad out the packet if this
     * turns out to be the case.
	 */

	(void) memset(&v4, 0, sizeof (v4));
	v4.sin_addr.s_addr	= dest;
	v4.sin_family	= AF_INET;
	v4.sin_port		= htons(PORT);

    n_bytes = sendto(v4_sock_fd,
        msg,
        msg_len, 0,
        (struct sockaddr *)&v4,
        sizeof (struct sockaddr_in));

    if (n_bytes == -1) {
        perror("send_packet: sendto");
    }
    //printf("Sent %d/%d bytes\n", n_bytes, msg_len);
    return (B_TRUE);
}


int
main(int argc, char **argv)
{
    if (argc != 3) {
        fprintf(stderr, "usage: %s device msg\n", argv[0]);
        return (1);
    }
    if (interface_init(argv[1]) == B_FALSE)
    {
        return (1);
    }
    send_packet(argv[2]);
    return (0);
}
