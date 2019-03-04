/*
 * Copyright (c) 2019, Joyent, Inc.
 */

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>

#define VMBUNDLE_MAGIC "MAGIC-VMBUNDLE"
#define VMBUNDLE_VERSION "1"
#define VMBUNDLE_NUM_SIZE 32
#define VMBUNDLE_HEADER_SIZE 512

typedef struct {
    unsigned int version;
    const char *checksum;
    const char *name;
    size_t size;
    size_t padded_size;
} header_t;

char *progname;
int get_header(int fd, header_t *header, int fallback_to_raw);
ssize_t read_bytes(int fd, char *data, size_t bytes);
ssize_t write_bytes(int fd, const void *buf, size_t bytes);
size_t zfs_receive(int fd, const char * snapshot);

/*
 * RETURNS
 *
 *  -1 * remaining (unwritten bytes) on failure
 *  # bytes written on succcess
 *
 */
ssize_t
write_bytes(int fd, const void *buf, size_t bytes)
{
    ssize_t numwritten = 0;
    void * ptr;
    size_t remain;

    ptr = (void *) buf;
    remain = bytes;
    while ((remain > 0) && (numwritten = write(fd, ptr, remain))) {
        remain -= numwritten;
        ptr += numwritten;
    }

    if (numwritten < 0) {
        perror("write");
        return ((ssize_t) (remain * -1));
    } else if (remain > 0) {
        return ((ssize_t) (remain * -1));
    }

    return ((ssize_t) bytes);
}

ssize_t
read_bytes(int fd, char *data, size_t bytes)
{
    size_t remain;
    ssize_t numread = 0;
    ssize_t total_read = 0;
    char *ptr;

    remain = bytes;
    ptr = data;
    while (remain > 0 && (numread = read(fd, ptr, remain)) > 0) {
        remain -= numread;
        ptr += numread;
        total_read += numread;
    }

    if (numread < 0) {
        perror("read");
        return ((ssize_t) (remain * -1));
    }

    return (total_read);
}

size_t
zfs_receive(int fd, const char * snapshot)
{
    char *argv[4] = {"/usr/sbin/zfs", "receive", 0, 0};
    char *evp[1] = {0};
    pid_t pid;
    int stat;
    pid_t waitee;

    pid = fork();
    if (pid == 0) {
        argv[2] = (char *)snapshot;
        if (dup2(fd, 0) < 0) {
            perror("dup2()");
            return (1);
        }
        execve("/usr/sbin/zfs", argv, evp);
        perror("execve");
        return (2);
    } else if (pid > 0) {
        while ((waitee = waitpid(pid, &stat, 0)) != pid) {
            if (waitee == -1 && errno != EINTR) {
                perror("waitpid");
                return (3);
            }
        }

        if (!WIFEXITED(stat) || WEXITSTATUS(stat) != 0) {
            fprintf(stderr, "zfs receive barfed on %s\n", snapshot);
            return (4);
        }
    } else {
        perror("fork");
        return (5);
    }

    return (0);
}

int
get_header(int fd, header_t *header, int fallback_to_raw)
{
    char data[VMBUNDLE_HEADER_SIZE] = {0};
    ssize_t data_size = 0;
    int found_magic = 0;
    ssize_t nread;
    size_t offset = 0;
    size_t str_pos = 0;
    char tmp[VMBUNDLE_HEADER_SIZE] = {0};

    fprintf(stderr, "looking for magic...\n");
    if ((nread = read_bytes(fd, (char *)data, VMBUNDLE_HEADER_SIZE)) == 0) {
        fprintf(stderr, "EOF looking for magic (no data)\n");
        return (-3);
    } else if (nread < 0) {
        fprintf(stderr, "Error reading magic\n");
        return (-1);
    } else {
        data_size = nread;
    }

    errno = 0;

    while (found_magic == 0 && data_size == nread &&
        offset < (strlen(VMBUNDLE_MAGIC) + 1)) {

        if (strncmp(data + offset, VMBUNDLE_MAGIC,
            strlen(VMBUNDLE_MAGIC) + 1) == 0) {

            fprintf(stderr, "found magic at offset %zd\n", offset);
            if (offset > 0) {
                (void) memmove(data, data + offset,
                    VMBUNDLE_HEADER_SIZE - offset);
                nread = read_bytes(fd, data + (VMBUNDLE_HEADER_SIZE - offset),
                    offset);
                if (nread == 0) {
                    fprintf(stderr, "EOF while reading header.\n");
                    return (-1);
                } else if (nread < 1) {
                    fprintf(stderr, "Error %d while reading header.\n", nread);
                    return (-1);
                } else if ((size_t) nread != offset) {
                    fprintf(
                        stderr,
                        "ERROR short read reading second header chunk.\n");
                    return (-1);
                }
            }
            str_pos = strlen(VMBUNDLE_MAGIC) + 1;

            /* .version */
            if (strlcpy(tmp, data + str_pos, VMBUNDLE_HEADER_SIZE - str_pos)
                >= (VMBUNDLE_HEADER_SIZE - str_pos)) {

                perror("strlcpy");
                return (-1);
            }
            header->version =
                (unsigned int) strtoul((const char *)tmp, NULL, 10);
            if (errno) {
                perror("strtoul");
                return (-1);
            }
            str_pos += strlen(tmp) + 1;

            /* .checksum */
            if (strlcpy(tmp, data + str_pos, VMBUNDLE_HEADER_SIZE - str_pos)
                >= (VMBUNDLE_HEADER_SIZE - str_pos)) {

                perror("strlcpy");
                return (-1);
            }
            if (strncmp(tmp, "0", strlen(tmp) == 0)) {
                header->checksum = "0";
            }
            str_pos += strlen(tmp) + 1;

            /* .name */
            if (strlcpy(tmp, data + str_pos, VMBUNDLE_HEADER_SIZE - str_pos)
                >= (VMBUNDLE_HEADER_SIZE - str_pos)) {

                perror("strlcpy");
                return (-1);
            }
            /*
             * Note: up to the caller to free this memory, this tool uses name
             * until about the end though so it is not freed.
             */
            header->name = strdup(tmp);
            str_pos += strlen(tmp) + 1;

            /* .size */
            if (strlcpy(tmp, data + str_pos, VMBUNDLE_HEADER_SIZE - str_pos)
                >= (VMBUNDLE_HEADER_SIZE - str_pos)) {

                perror("strlcpy");
                return (-1);
            }
            header->size = (size_t) strtoull((const char *)tmp, NULL, 10);
            if (errno) {
                perror("strtoull");
                return (-1);
            }
            str_pos += strlen(tmp) + 1;

            /* .padded_size */
            if (strlcpy(tmp, data + str_pos, VMBUNDLE_HEADER_SIZE - str_pos)
                >= (VMBUNDLE_HEADER_SIZE - str_pos)) {

                perror("strlcpy");
                return (-1);
            }
            header->padded_size =
                (size_t) strtoull((const char *)tmp, NULL, 10);
            if (errno) {
                perror("strtoull");
                return (-1);
            }
            str_pos += strlen(tmp) + 1;

            found_magic = 1;
        }
        offset++;
    }

    if (!found_magic) {
        if (fallback_to_raw) {
            /*
             * EOF without magic, just dump what we got to stdout.  This
             * handles the case where you just pipe raw JSON to vmadm receive.
             *
             */
            fprintf(stderr, "No magic! Dumping raw JSON.\n");
            (void) write_bytes(1, data, data_size);
            while ((nread = read_bytes(fd, (char *)data,
                VMBUNDLE_HEADER_SIZE)) > 0) {

                fprintf(stderr, "got %d bytes\n", nread);
                (void) write_bytes(1, data, nread);
            }
            if (nread < 0) {
                fprintf(stderr, "Error %d reading raw data\n", nread);
                return (-1);
            }
            return (-2);
        } else {
            fprintf(stderr, "No magic!\n");
        }
        return (1);
    }

    return (0);
}

char *
read_json(header_t header)
{
    char * json = NULL;
    ssize_t nread;

    json = (char *)malloc(header.padded_size);
    if (json == NULL) {
        perror("malloc");
        exit(1);
    }
    nread = read_bytes(0, (char *)json, header.padded_size);
    if (nread == 0) {
        fprintf(stderr, "EOF reading JSON\n");
        exit(1);
    } else if (nread < 0) {
        fprintf(stderr, "Error %d reading JSON\n", nread);
        exit(1);
    } else if ((size_t) nread != header.padded_size) {
        fprintf(stderr, "JSON truncated: %zu of %zu bytes\n", nread,
            header.padded_size);
        exit(1);
    }

    return (json);
}

void
usage(void)
{
    fprintf(stderr, "Usage: %s [json|dataset]\n", progname);
    exit(1);
}

int
main(int argc, char *argv[])
{
    header_t header;
    char * json = NULL;
    enum {JSON = 0, DATASET} mode = JSON;
    int res;

    progname = argv[0];

    // Ensure correct usage
    if (argc != 2) {
        usage();
        /* NOTREACHED */
    }

    if (strcmp(argv[1], "json") == 0) {
        mode = JSON;
    } else if (strcmp(argv[1], "dataset") == 0) {
        mode = DATASET;
    } else {
        usage();
        /* NOTREACHED */
    }

    res = get_header(0, &header, (mode == JSON) ? 1 : 0);
    if (res == -1 || res > 0) {
        fprintf(stderr, "No header: this doesn't look like a vmbundle.\n");
        exit(1);
    } else if (res == -3) {
        exit(3);
    } else if ((mode == JSON) && (res == -2)) {
        /*
         * We dumped the raw data (passed input through unchanged)
         * This option exists to support the manual receive of JSON then
         * install.
         */
        exit(0);
    } else if ((mode == JSON) && (res != 0)) {
        fprintf(stderr, "Error %d: reading vmbundle header.\n", res);
        exit(1);
    }

    fprintf(stderr, "Version: %zu\n", header.version);
    fprintf(stderr, "Name: [%s]\n", header.name);
    fprintf(stderr, "Size: %zu\n", header.size);
    fprintf(stderr, "Padded Size: %zu\n", header.padded_size);

    if (mode == JSON) {
        if (strcmp("JSON", header.name) == 0) {
            json = read_json(header);
            write_bytes(1, json, header.size);
            if (json != NULL) {
                free(json);
                json = NULL;
            }
            fsync(1);
            fprintf(stderr, "END JSON\n");
        } else {
            fprintf(stderr, "FATAL: expecting JSON, got '%s'\n", header.name);
            exit(1);
        }
    } else if (mode == DATASET) {
        fprintf(stderr, "Attempting zfs receive %s\n", header.name);
        if ((res = zfs_receive(0, header.name)) != 0) {
            fprintf(stderr, "Failed to receive dataset code: %d\n", res);
            exit(1);
        }
        fprintf(stderr, "END DATASET\n");
    } else {
        fprintf(stderr, "Internal error!\n");
        exit(1);
    }

    exit(0);
}
