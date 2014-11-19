/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#ifndef _CRC32_H
#define	_CRC32_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

uint32_t crc32_calc(const char *, int);

#ifdef __cplusplus
}
#endif

#endif /* _CRC32_H */
