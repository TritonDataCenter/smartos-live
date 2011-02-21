/*
 * pwgen.c --- generate secure passwords
 *
 * Copyright (C) 2001,2002 by Theodore Ts'o
 * 
 * This file may be distributed under the terms of the GNU Public
 * License.
 */

#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#ifdef HAVE_GETOPT_H
#include <getopt.h>
#endif

#include "pwgen.h"

/* Globals variables */
int (*pw_number)(int max_num);

/* Program parameters set via getopt */

int	pw_length = 8;
int	num_pw = -1;
int	pwgen_flags = 0;
int	do_columns = 0;

#ifdef HAVE_GETOPT_LONG
struct option pwgen_options[] = {
	{ "alt-phonics", no_argument, 0, 'a' },
	{ "capitalize", no_argument, 0, 'c' },
	{ "numerals", no_argument, 0, 'n'},
	{ "symbols", no_argument, 0, 'y'},
	{ "num-passwords", required_argument, 0, 'N'},
	{ "secure", no_argument, 0, 's' },
	{ "help", no_argument, 0, 'h'},
	{ "no-numerals", no_argument, 0, '0' },
	{ "no-capitalize", no_argument, 0, 'A' },
	{ "sha1", required_argument, 0, 'H' },
	{ "ambiguous", no_argument, 0, 'B' },
	{ "no-vowels", no_argument, 0, 'v' },
	{ 0, 0, 0, 0}
};
#endif

const char *pw_options = "01AaBCcnN:shH:vy";

static void usage(void)
{
	fputs("Usage: pwgen [ OPTIONS ] [ pw_length ] [ num_pw ]\n\n", stderr);
	fputs("Options supported by pwgen:\n", stderr);
	fputs("  -c or --capitalize\n", stderr);
	fputs("\tInclude at least one capital letter in the password\n", 
	      stderr);
	fputs("  -A or --no-capitalize\n", stderr);
	fputs("\tDon't include capital letters in the password\n", 
	      stderr);
	fputs("  -n or --numerals\n", stderr);
	fputs("\tInclude at least one number in the password\n", stderr);
	fputs("  -0 or --no-numerals\n", stderr);
	fputs("\tDon't include numbers in the password\n", 
	      stderr);
	fputs("  -y or --symbols\n", stderr);
	fputs("\tInclude at least one special symbol in the password\n", 
	      stderr);
	fputs("  -s or --secure\n", stderr);
	fputs("\tGenerate completely random passwords\n", stderr);
	fputs("  -B or --ambiguous\n", stderr);
	fputs("\tDon't include ambiguous characters in the password\n", 
	      stderr);
	fputs("  -h or --help\n", stderr);
	fputs("\tPrint a help message\n", stderr);
	fputs("  -H or --sha1=path/to/file[#seed]\n", stderr);
	fputs("\tUse sha1 hash of given file as a (not so) random generator\n",
	      stderr);
	fputs("  -C\n\tPrint the generated passwords in columns\n", stderr);
	fputs("  -1\n\tDon't print the generated passwords in columns\n", 
	      stderr);
	fputs("  -v or --no-vowels\n", stderr);
	fputs("\tDo not use any vowels so as to avoid accidental nasty words\n",
	      stderr);
	exit(1);
}


int main(int argc, char **argv)
{
	int	term_width = 80;
	int	c, i;
	int	num_cols = -1;
	char	*buf, *tmp;
	void	(*pwgen)(char *inbuf, int size, int pw_flags);

	pwgen = pw_phonemes;
	pw_number = pw_random_number;
	if (isatty(1)) {
		do_columns = 1;
		pwgen_flags |= PW_DIGITS | PW_UPPERS;
	}

	while (1) {
#ifdef HAVE_GETOPT_LONG
		c = getopt_long(argc, argv, pw_options, pwgen_options, 0);
#else
		c = getopt(argc, argv, pw_options);
#endif
		if (c == -1)
			break;
		switch (c) {
		case '0':
			pwgen_flags &= ~PW_DIGITS;
			break;
		case 'A':
			pwgen_flags &= ~PW_UPPERS;
			break;
		case 'a':
			break;
		case 'B':
			pwgen_flags |= PW_AMBIGUOUS;
			break;
		case 'c':
			pwgen_flags |= PW_UPPERS;
			break;
		case 'n':
			pwgen_flags |= PW_DIGITS;
			break;
		case 'N':
			num_pw = strtol(optarg, &tmp, 0);
			if (*tmp) {
				fprintf(stderr,
					"Invalid number of passwords: %s\n",
					optarg);
				exit(1);
			}
			break;
		case 's':
			pwgen = pw_rand;
			pwgen_flags = PW_DIGITS | PW_UPPERS;
			break;
		case 'C':
			do_columns = 1;
			break;
		case '1':
			do_columns = 0;
			break;
		case 'H': 
			pw_sha1_init(optarg);
			pw_number = pw_sha1_number;
			break;
		case 'y':
			pwgen_flags |= PW_SYMBOLS;
			break;
		case 'v':
			pwgen = pw_rand;
			pwgen_flags |= PW_NO_VOWELS | PW_DIGITS | PW_UPPERS;
			break;
		case 'h':
		case '?':
			usage();
			break;
		}
	}
	if (optind < argc) {
		pw_length = strtol(argv[optind], &tmp, 0);
		if (pw_length < 5)
			pwgen = pw_rand;
		if (pw_length <= 2)
			pwgen_flags &= ~PW_UPPERS;
		if (pw_length <= 1)
			pwgen_flags &= ~PW_DIGITS;
		if (*tmp) {
			fprintf(stderr, "Invalid password length: %s\n",
				argv[optind]);
			exit(1);
		}
		optind++;
	}

	if (optind < argc) {
		num_pw = strtol(argv[optind], &tmp, 0);
		if (*tmp) {
			fprintf(stderr, "Invalid number of passwords: %s\n",
				argv[optind]);
			exit(1);
		}
	}
	
	if (do_columns) {
		num_cols = term_width / (pw_length+1);
		if (num_cols == 0)
			num_cols = 1;
	}
	if (num_pw < 0)
		num_pw = do_columns ? num_cols * 20 : 1;
	
	buf = malloc(pw_length+1);
	if (!buf) {
		fprintf(stderr, "Couldn't malloc password buffer.\n");
		exit(1);
	}
	for (i=0; i < num_pw; i++) {
		pwgen(buf, pw_length, pwgen_flags);
		if (!do_columns || ((i % num_cols) == (num_cols-1)))
			printf("%s\n", buf);
		else
			printf("%s ", buf);
	}
	if ((num_cols > 1) && ((i % num_cols) != 0))
		fputc('\n', stdout);
	free(buf);
	return 0;
}
