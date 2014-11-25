/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#ifndef _DYNSTR_H
#define	_DYNSTR_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct string string_t;

string_t *dynstr_new(void);
void dynstr_free(string_t *str);
void dynstr_append(string_t *, const char *);
void dynstr_appendc(string_t *, char);
void dynstr_reset(string_t *str);
size_t dynstr_len(string_t *str);
const char *dynstr_cstr(string_t *str);

#ifdef __cplusplus
}
#endif

#endif /* _DYNSTR_H */
