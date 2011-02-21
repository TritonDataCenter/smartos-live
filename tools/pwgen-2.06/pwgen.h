/*
 * pwgen.h --- header file for password generator
 *
 * Copyright (C) 2001,2002 by Theodore Ts'o
 * 
 * This file may be distributed under the terms of the GNU Public
 * License.
 */

struct pw_element {
	const char	*str;
	int		flags;
};

/*
 * Flags for the pw_element
 */
#define CONSONANT	0x0001
#define VOWEL		0x0002
#define DIPTHONG	0x0004
#define NOT_FIRST	0x0008

/*
 * Flags for the pwgen function
 */
#define PW_DIGITS	0x0001	/* At least one digit */
#define PW_UPPERS	0x0002	/* At least one upper letter */
#define PW_SYMBOLS	0x0004
#define PW_AMBIGUOUS	0x0008
#define PW_NO_VOWELS	0x0010

/* pointer to choose between random or sha1 pseudo random number generator */
extern int (*pw_number)(int max_num);

extern const char *pw_symbols;
extern const char *pw_ambiguous;

/* Function prototypes */

/* pw_phonemes.c */
extern void pw_phonemes(char *buf, int size, int pw_flags);

/* pw_rand.c */
extern void pw_rand(char *buf, int size, int pw_flags);

/* randnum.c */
extern int pw_random_number(int max_num);

/* sha1num.c */
extern void pw_sha1_init(char *sha1);
extern int pw_sha1_number(int max_num);
