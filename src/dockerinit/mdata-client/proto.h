/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#ifndef _PROTO_H
#define	_PROTO_H

#ifdef __cplusplus
extern "C" {
#endif

typedef enum mdata_response {
	MDR_UNKNOWN = 1,
	MDR_NOTFOUND,
	MDR_SUCCESS,
	MDR_INVALID_COMMAND,
	MDR_PENDING,
	MDR_V2_OK
} mdata_response_t;

typedef struct mdata_proto mdata_proto_t;

int proto_init(mdata_proto_t **, char **);
int proto_version(mdata_proto_t *);
int proto_execute(mdata_proto_t *, const char *, const char *, mdata_response_t *,
    string_t **);

#ifdef __cplusplus
}
#endif

#endif /* _PROTO_H */
