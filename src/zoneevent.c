#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <unistd.h>
#include <libsysevent.h>
#include <sys/nvpair.h>

void sysev_handler(sysevent_t *ev);
sysevent_handle_t * sysev_register(const char *klass,
    void (*handler)(sysevent_t *));
evchan_t * sysev_register_evc(const char *channel, const char *klass,
    int (*handler)(sysevent_t *, void *));

static void
exit_on_sigpipe(int signo) {
    // no point outputing anything, parent is gone.
    signo = signo; // quiet -Wall
    exit(2);
}

static int
sysev_evc_handler(sysevent_t *ev, void *cookie)
{
    nvlist_t *nvlist;
    nvpair_t *next;
    nvpair_t *curr;
    data_type_t type;
    char *string;
    uint32_t uint32;
    int32_t int32;
    uint64_t uint64;
    int64_t int64;

    if (sysevent_get_attr_list(ev, &nvlist) != 0) {
        // XXX Error
        return (1);
    }

    curr = nvlist_next_nvpair(nvlist, NULL);

    printf("{");
    while (curr != NULL) {
        type = nvpair_type(curr);

        switch (type) {
            case DATA_TYPE_STRING:
                nvpair_value_string(curr, &string);
                printf("\"%s\": \"%s\", ", nvpair_name(curr), string);
                break;
            case DATA_TYPE_UINT32:
                nvpair_value_uint32(curr, &uint32);
                printf("\"%s\": \"%u\", ", nvpair_name(curr), uint32);
                break;
            case DATA_TYPE_INT32:
                nvpair_value_int32(curr, &int32);
                printf("\"%s\": \"%d\", ", nvpair_name(curr), int32);
                break;
            case DATA_TYPE_UINT64:
                nvpair_value_uint64(curr, &uint64);
                printf("\"%s\": \"%llu\", ", nvpair_name(curr), uint64);
                break;
            case DATA_TYPE_INT64:
                nvpair_value_int64(curr, &int64);
                printf("\"%s\": \"%lld\", ", nvpair_name(curr), int64);
                break;
                break;
            default:
                (void) fprintf(stderr,
                    "don't know what to do with '%s', type: %d\n",
                    nvpair_name(curr), type);
                break;
        }
        next = nvlist_next_nvpair(nvlist, curr);
        curr = next;
    }

    printf("\"channel\": \"%s\", \"class\": \"%s\", \"subclass\": \"%s\"}\n",
        (const char *) cookie,
        sysevent_get_class_name(ev),
        sysevent_get_subclass_name(ev));

    fflush(stdout);

    return (0);
}

evchan_t *
sysev_register_evc(const char *channel, const char *klass,
    int (*handler)(sysevent_t *, void *))
{
    int res;
    evchan_t *ch;
    char subid[16];

    if ((res = sysevent_evc_bind(channel, &ch, 0)) != 0) {
        (void) fprintf(stderr, "failed to bind to sysevent channel: %d\n", res);
        return (NULL);
    }

    (void) snprintf(subid, sizeof (subid), "node-%ld", getpid());

    if ((res = sysevent_evc_subscribe(ch, subid, klass, handler,
        (void *)channel, 0)) != 0) {

        (void) fprintf(stderr, "failed to subscribe to channel: %d\n", res);
        return (NULL);
    }

    return (ch);
}

int
main(int argc, char **argv)
{
    evchan_t *ch;

    // quiet -Wall
    argc = argc;
    argv = argv;

    if (signal(SIGPIPE, exit_on_sigpipe) == SIG_ERR) {
        fprintf(stderr, "failed to register SIGPIPE handler: %s\n",
            strerror(errno));
        exit(1);
    }

    ch = sysev_register_evc("com.sun:zones:status", "status",
        sysev_evc_handler);
    if (!ch) {
        fprintf(stderr, "failed to register event handler.\n");
        exit(1);
    }

    for (;;) {
        (void) pause();
    }

    exit(0);
}
