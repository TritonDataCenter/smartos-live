/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 */

#include <sys/socket.h>
#include <sys/types.h>
#include <arpa/inet.h>
#include <errno.h>
#include <netdb.h>
#include <stdlib.h>
#include <stdio.h>
#include <strings.h>
#include <unistd.h>

/*
 * To match /usr/sbin/zfs, the following exit statuses will be used:
 *
 *  0     Successful completion.
 *  1     An error occurred.
 *  2     Invalid command line options were specified.
 *
 * Diagnostic messages go to stderr.
 * On success a zfs stream will be sent over TCP to zfs_recv on the [host]:port.
 *
 */

int main(int argc, char *argv[]) {
    struct addrinfo hints;
    struct addrinfo *res;
    char *host;
    char *port;
    char rhost[NI_MAXHOST + NI_MAXSERV];
    char rport[NI_MAXSERV];
    int error;
    int sock;

    if (argc < 4) {
        fprintf(stderr, "Usage: %s <host> <port> ['zfs send' args ...]\n",
            argv[0]);
        exit(2);
    }

    host = argv[1];
    port = argv[2];

    bzero((char *)&hints, sizeof (struct addrinfo));
    hints.ai_family = PF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_protocol = IPPROTO_TCP;
    hints.ai_flags |= AI_NUMERICHOST;
    hints.ai_flags |= AI_NUMERICSERV;

    if ((error = getaddrinfo(host, port, &hints, &res))) {
        fprintf(stderr, "zfs_send: getaddrinfo(): %s\n", gai_strerror(error));
        exit(1);
    }

    sock = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (sock < 0) {
        perror("zfs_send: socket()");
        exit(1);
    }

    error = getnameinfo(res->ai_addr, res->ai_addrlen, rhost, sizeof (rhost),
        rport, sizeof (rport), NI_NUMERICHOST|NI_NUMERICSERV);
    if (error != 0) {
        fprintf(stderr, "zfs_send: getnameinfo(): %s\n", gai_strerror(error));
        exit(1);
    }
    fprintf(stderr, "Sending stream to: {'host': '%s', 'port': '%s'}\n",
        rhost, rport);

    if (connect(sock, res->ai_addr, res->ai_addrlen) < 0) {
        perror("zfs_send: connect()");
        exit(1);
    }

    freeaddrinfo(res);

    /* redir stdout to the socket, keep stderr (caller can log it) */
    if (dup2(sock, 1) < 0) {
        perror("zfs_send: dup2(stdout)");
        exit(1);
    }

    /* run the <program> and its args */
    argv++;
    argc--;
    argv[0] = "/usr/sbin/zfs"; // replace host
    argv[1] = "send";         // replace port
    execvp(*argv, argv);      // now: zfs send <args>

    /* if we got here we failed. */
    perror("zfs_send: execvp()");
    exit(1);
}
