/*
 * Copyright (c) 2010 Joyent Inc., All rights reserved.
 *
 * Prints system parameters from libdevinfo
 *
 * Compile: gcc -Wall -o bootparams bootparams.c -ldevinfo
 */

#include <err.h>
#include <fcntl.h>
#include <libdevinfo.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>

void raw_cat(int rfd);

/*
 * In this comment typed properties are those of type DI_PROP_TYPE_UNDEF_IT,
 * DI_PROP_TYPE_BOOLEAN, DI_PROP_TYPE_INT, DI_PROP_TYPE_INT64,
 * DI_PROP_TYPE_BYTE, and DI_PROP_TYPE_STRING.
 *
 * The guessing algorithm is:
 * 1. If the property is typed and the type is consistent with the value of
 *    the property, then the property is of that type. If the type is not
 *    consistent with value of the property, then the type is treated as
 *    alien to prtconf.
 * 2. If the property is of type DI_PROP_TYPE_UNKNOWN the following steps
 *    are carried out.
 *    a. If the value of the property is consistent with a string property,
 *       the type of the property is DI_PROP_TYPE_STRING.
 *    b. Otherwise, if the value of the property is consistent with an integer
 *       property, the type of the property is DI_PROP_TYPE_INT.
 *    c. Otherwise, the property type is treated as alien to prtconf.
 * 3. If the property type is alien to prtconf, then the property value is
 *    read by the appropriate routine for untyped properties and the following
 *    steps are carried out.
 *    a. If the length that the property routine returned is zero, the
 *       property is of type DI_PROP_TYPE_BOOLEAN.
 *    b. Otherwise, if the length that the property routine returned is
 *       positive, then the property value is treated as raw data of type
 *       DI_PROP_TYPE_UNKNOWN.
 *    c. Otherwise, if the length that the property routine returned is
 *       negative, then there is some internal inconsistency and this is
 *       treated as an error and no type is determined.
 *
 *
 * Joyent/jwilsdon: This function was taken and modified from:
 *
 *     <illumos>/usr/src/cmd/prtconf/pdevinfo.c
 *
 */
static int
prop_type_guess(di_prop_t prop, void **prop_data, int *prop_type)
{
    int len, type;

    type = di_prop_type(prop);
    switch (type) {
    case DI_PROP_TYPE_UNDEF_IT:
    case DI_PROP_TYPE_BOOLEAN:
        *prop_data = NULL;
        *prop_type = type;
        return (0);
    case DI_PROP_TYPE_INT:
        len = di_prop_ints(prop, (int **)prop_data);
        break;
    case DI_PROP_TYPE_INT64:
        len = di_prop_int64(prop, (int64_t **)prop_data);
        break;
    case DI_PROP_TYPE_BYTE:
        len = di_prop_bytes(prop, (uchar_t **)prop_data);
        break;
    case DI_PROP_TYPE_STRING:
        len = di_prop_strings(prop, (char **)prop_data);
        break;
    case DI_PROP_TYPE_UNKNOWN:
        len = di_prop_strings(prop, (char **)prop_data);
        if ((len > 0) && ((*(char **)prop_data)[0] != 0)) {
            *prop_type = DI_PROP_TYPE_STRING;
            return (len);
        }

        len = di_prop_ints(prop, (int **)prop_data);
        type = DI_PROP_TYPE_INT;

        break;
    default:
        len = -1;
    }

    if (len > 0) {
        *prop_type = type;
        return (len);
    }

    len = di_prop_rawdata(prop, (uchar_t **)prop_data);
    if (len < 0) {
        return (-1);
    } else if (len == 0) {
        *prop_type = DI_PROP_TYPE_BOOLEAN;
        return (0);
    }

    *prop_type = DI_PROP_TYPE_UNKNOWN;
    return (len);
}

void
prt_prop(di_prop_t prop)
{
    int i, prop_type, nitems;
    char *p;
    void *prop_data;

    nitems = prop_type_guess(prop, &prop_data, &prop_type);

    /*
     * XXX: currently we only handle single string properties because those are
     *      all that are needed for showing boot parameters.
     */
    if ((nitems != 1) || (prop_type != DI_PROP_TYPE_STRING))
        return;

    printf("%s=", di_prop_name(prop));
    switch (prop_type) {
        case DI_PROP_TYPE_INT:
            for (i = 0; i < nitems - 1; i++)
                (void) printf("%8.8x.", ((int *)prop_data)[i]);
            (void) printf("%8.8x", ((int *)prop_data)[i]);
            break;
        case DI_PROP_TYPE_INT64:
            for (i = 0; i < nitems - 1; i++)
                (void) printf("%16.16llx.",
                    ((long long *)prop_data)[i]);
            (void) printf("%16.16llx", ((long long *)prop_data)[i]);
            break;
        case DI_PROP_TYPE_STRING:
            p = (char *)prop_data;
            for (i = 0; i < nitems - 1; i++) {
                (void) printf("%s + ", p);
                p += strlen(p) + 1;
            }
            (void) printf("%s", p);
            break;
        default:
            for (i = 0; i < nitems - 1; i++)
                (void) printf("%2.2x.",
                    ((uint8_t *)prop_data)[i]);
            (void) printf("%2.2x", ((uint8_t *)prop_data)[i]);
    }
    printf("\n");
}

int
prt_node(di_node_t node, void *arg)
{
    di_prop_t prop = DI_PROP_NIL;

    if (strcmp(di_node_name(node), "i86pc") == 0) {
        while ((prop = di_prop_next(node, prop)) != DI_PROP_NIL) {
            prt_prop(prop);
        }
        return (DI_WALK_TERMINATE);
    }
    return (DI_WALK_CONTINUE);
}

/*
 * ported from NetBSD's cat rev 1.47
 */
void
raw_cat(int rfd)
{
    static char *buf;
    static char fb_buf[BUFSIZ];
    static size_t bsize;

    ssize_t nr, nw, off;
    int wfd;

    wfd = fileno(stdout);
    if (buf == NULL) {
        struct stat sbuf;

        if (fstat(wfd, &sbuf) == 0 &&
            sbuf.st_blksize > (long) sizeof (fb_buf)) {
            bsize = sbuf.st_blksize;
            buf = malloc(bsize);
        }
        if (buf == NULL) {
            bsize = sizeof (fb_buf);
            buf = fb_buf;
        }
    }
    while ((nr = read(rfd, buf, bsize)) > 0) {
        for (off = 0; nr; nr -= nw, off += nw) {
            if ((nw = write(wfd, buf + off, (size_t)nr)) < 0) {
                err(EXIT_FAILURE, "stdout");
            }
        }
    }
}

int
main()
{
    di_node_t root_node;

    int fd;

    /*
     * If the /tmp/bootparams file exists, then it acts as a replacement for the
     * normal data. Otherwise, if we don't have or can't open the file, then we
     * just get the actual parameters.
     */
    if ((fd = open("/tmp/bootparams", O_RDONLY)) != -1) {
        raw_cat(fd);
        close(fd);
    } else {
        root_node = di_init("/", (DINFOSUBTREE | DINFOPROP));
        if (root_node == DI_NODE_NIL) {
            fprintf(stderr, "di_init() failed\n");
            exit(1);
        }
        di_walk_node(root_node, DI_WALK_CLDFIRST, NULL, prt_node);
        di_fini(root_node);
    }

    exit(EXIT_SUCCESS);
}
