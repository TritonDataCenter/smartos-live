
#include <stdlib.h>
#include <stdio.h>
#include <stddef.h>
#include <string.h>
#include <sys/types.h>
#include <sys/avl.h>
#include <sys/debug.h>
#include <errno.h>

#include "common.h"
#include "parser.h"
#include "strlist.h"
#include "users.h"

typedef struct builder_id_ent {
	avl_node_t bie_node;
	const char *bie_name;
	int bie_id;
} builder_id_ent_t;

struct builder_ids {
	char *bid_path_group;
	char *bid_path_passwd;
	avl_tree_t bid_name_to_user;
	avl_tree_t bid_name_to_group;
};

static int
builder_id_ent_comparator(const void *lp, const void *rp)
{
	const builder_id_ent_t *lent = lp;
	const builder_id_ent_t *rent = rp;
	int ret = strcmp(lent->bie_name, rent->bie_name);

	return (ret < 0 ? -1 : ret > 0 ? 1 : 0);
}

int
gid_from_name(builder_ids_t *bid, const char *group, gid_t *gid)
{
	builder_id_ent_t srch;
	builder_id_ent_t *ent;

	VERIFY((srch.bie_name = group) != NULL);

	if ((ent = avl_find(&bid->bid_name_to_group, &srch, NULL)) == NULL) {
		errno = ENOENT;
		return (-1);
	}

	*gid = ent->bie_id;
	return (0);
}

int
uid_from_name(builder_ids_t *bid, const char *user, uid_t *uid)
{
	builder_id_ent_t srch;
	builder_id_ent_t *ent;

	VERIFY((srch.bie_name = user) != NULL);

	if ((ent = avl_find(&bid->bid_name_to_user, &srch, NULL)) == NULL) {
		errno = ENOENT;
		return (-1);
	}

	*uid = ent->bie_id;
	return (0);
}

static int
process_line_common(avl_tree_t *avl, strlist_t *line, unsigned int fcount)
{
	int error = 0;
	builder_id_ent_t *ent;
	avl_index_t where;

	if ((ent = calloc(1, sizeof (*ent))) == NULL) {
		return (-1);
	}

	if (strlist_contig_count(line) != fcount) {
		error = EPROTO;
		goto out;
	}

	ent->bie_name = strlist_adopt(line, 0);
	ent->bie_id = atoi(strlist_get(line, 2));

	if (ent->bie_name == NULL || strlen(ent->bie_name) < 1) {
		error = EPROTO;
		goto out;
	}

	if (avl_find(avl, ent, &where) != NULL) {
		error = EEXIST;
		goto out;
	}

	avl_insert(avl, ent, where);

out:
	if (error != 0) {
		free((void *)ent->bie_name);
		free(ent);
	}
	errno = error;
	return (error == 0 ? 0 : -1);
}

static int
process_line_passwd(builder_ids_t *bid, strlist_t *line)
{
	return (process_line_common(&bid->bid_name_to_user, line, 7));
}

static int
process_line_group(builder_ids_t *bid, strlist_t *line)
{
	return (process_line_common(&bid->bid_name_to_group, line, 4));
}

int
read_nss_file(builder_ids_t *bid, const char *path,
    int (*func)(builder_ids_t *, strlist_t *))
{
	FILE *f;
	strlist_t *sl;
	int error = 0;
	char *line = NULL;
	size_t cap = 0;

	if (strlist_alloc(&sl, 16) != 0) {
		error = errno;
		goto out;
	}

	if ((f = fopen(path, "r")) == NULL) {
		error = errno;
		goto out;
	}

	if (!is_regular_file(f)) {
		fprintf(stderr, "ERROR: %s is not a regular file\n",
		    path);
		error = EINVAL;
		goto out;
	}

	for (;;) {
		errno = 0;
		if (getline(&line, &cap, f) < 0) {
			if (errno == 0) {
				/*
				 * End of file reached.
				 */
				goto out;
			}

			/*
			 * Some other error:
			 */
			error = errno;
			goto out;
		}

		strlist_reset(sl);

		if (split_on(line, ':', sl) != 0) {
			error = errno;
			goto out;
		}

		if (func(bid, sl) != 0) {
			error = errno;
			switch (errno) {
			case EPROTO:
				fprintf(stderr, "ERROR: invalid line: %s\n",
				    line);
				break;
			case EEXIST:
				fprintf(stderr, "ERROR: duplicate name: %s\n",
				    line);
				break;
			}
			goto out;
		}
	}

out:
	if (f != NULL) {
		fclose(f);
	}
	strlist_free(sl);
	errno = error;
	return (error == 0 ? 0 : -1);
}

static void
builder_avl_free(avl_tree_t *avl)
{
	builder_id_ent_t *ent;
	void *cookie = NULL;

	while ((ent = avl_destroy_nodes(avl, &cookie)) != NULL) {
		free((void *)ent->bie_name);
		free(ent);
	}

	avl_destroy(avl);
}

void
builder_ids_fini(builder_ids_t *bid)
{
	if (bid == NULL) {
		return;
	}

	builder_avl_free(&bid->bid_name_to_user);
	builder_avl_free(&bid->bid_name_to_group);

	free(bid->bid_path_group);
	free(bid->bid_path_passwd);
	free(bid);
}

int
builder_ids_init(builder_ids_t **bidp, const char *dir)
{
	int error = 0;
	builder_ids_t *bid;

	if ((bid = calloc(1, sizeof (*bid))) == NULL) {
		return (-1);
	}

	avl_create(&bid->bid_name_to_user, builder_id_ent_comparator,
	    sizeof (builder_id_ent_t), offsetof(builder_id_ent_t, bie_node));
	avl_create(&bid->bid_name_to_group, builder_id_ent_comparator,
	    sizeof (builder_id_ent_t), offsetof(builder_id_ent_t, bie_node));

	if (asprintf(&bid->bid_path_group, "%s/%s", dir, "group") < 0 ||
	    asprintf(&bid->bid_path_passwd, "%s/%s", dir, "passwd") < 0) {
		error = errno;
		goto out;
	}

	if (read_nss_file(bid, bid->bid_path_passwd,
	    process_line_passwd) != 0) {
		error = errno;
		(void) fprintf(stderr, "ERROR: could not read %s\n",
		    bid->bid_path_passwd);
		goto out;
	}

	if (read_nss_file(bid, bid->bid_path_group,
	    process_line_group) != 0) {
		error = errno;
		(void) fprintf(stderr, "ERROR: could not read %s\n",
		    bid->bid_path_group);
		goto out;
	}

	*bidp = bid;
	return (0);

out:
	if (error != 0) {
		builder_ids_fini(bid);
	}
	errno = error;
	return (error == 0 ? 0 : -1);
}
