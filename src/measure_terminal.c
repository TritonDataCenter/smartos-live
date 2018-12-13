/*
 * This file and its contents are supplied under the terms of the
 * Common Development and Distribution License ("CDDL"), version 1.0.
 * You may only use this file in accordance with the terms of version
 * 1.0 of the CDDL.
 *
 * A full copy of the text of the CDDL should have accompanied this
 * source.  A copy of the CDDL is also available via the Internet at
 * http://www.illumos.org/license/CDDL.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * This tool uses terminal control sequences to attempt to measure the size
 * of the controlling terminal.  Either the tool will fail with a non-zero
 * exit status, or it will output bourne shell code to set COLUMNS and LINES
 * appropriately and exit zero.
 *
 *   $ measure_terminal
 *   export COLUMNS=80; export LINES=25;
 *
 */

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <strings.h>
#include <termios.h>

#define	__UNUSED	__attribute__((__unused__))

#define	PREAMBLE	"\x1b[8;"
#define	PREAMBLE_LENGTH	(sizeof (PREAMBLE) - 1)

#define	REQUEST		"\x1b[18t" "\x1b[0c"
#define	REQUEST_LENGTH	(sizeof (REQUEST) - 1)

#define	SHELL_OUTPUT	"export COLUMNS=%d; export LINES=%d;\n"

static int term_fd = -1;
static struct termios orig_tios;

static int
reset_mode()
{
	if (tcsetattr(term_fd, TCSAFLUSH, &orig_tios) == -1)
		return (-1);

	return (0);
}

static int
raw_mode()
{
	struct termios raw;

	raw = orig_tios;

	/*
	 * Various raw-mode settings:
	 */
	raw.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
	raw.c_oflag &= ~(OPOST);
	raw.c_cflag |= (CS8);
	raw.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);

	/*
	 * Return after 5 seconds pass without data:
	 */
	raw.c_cc[VMIN] = 0;
	raw.c_cc[VTIME] = 50;

	if (tcsetattr(term_fd, TCSAFLUSH, &raw) == -1)
		return (-1);

	return (0);
}

typedef enum cseq_state {
	CSEQ_ESCAPE = 1,
	CSEQ_BRACKET,
	CSEQ_QMARK,
	CSEQ_NUMBER
} cseq_state_t;

static char *
read_cseq()
{
	cseq_state_t cs = CSEQ_ESCAPE;
	char buf[64];
	char *pos = buf;

	while (pos < buf + 64) {
		if (read(term_fd, pos, 1) != 1)
			return (NULL);

		switch (cs) {
		case CSEQ_ESCAPE:
			if (*pos != '\x1b')
				return (NULL);
			cs = CSEQ_BRACKET;
			break;
		case CSEQ_BRACKET:
			if (*pos != '[')
				return (NULL);
			cs = CSEQ_QMARK;
			break;
		case CSEQ_QMARK:
			if ((*pos >= '0' && *pos <= '9') || *pos == '?' ||
			    *pos == ';') {
				cs = CSEQ_NUMBER;
				break;
			}
			return (NULL);
		case CSEQ_NUMBER:
			if ((*pos >= '0' && *pos <= '9') || *pos == ';')
				break;
			/*
			 * We have the trailing character now, as well.
			 */
			pos++;
			*pos = '\0';
			return (strdup(buf));
		default:
			abort();
		}

		pos++;
	}

	return (NULL);
}

static int
process_size(char *buf)
{
	char *rows, *cols, *t;
	int rowsi, colsi;

	/*
	 * Check for the expected preamble in the response from the terminal.
	 */
	if (strlen(buf) <= PREAMBLE_LENGTH || strncmp(buf, PREAMBLE,
	    PREAMBLE_LENGTH) != 0) {
		return (-1);
	}

	/*
	 * Split out row and column dimensions:
	 */
	rows = buf + PREAMBLE_LENGTH;
	if ((t = strchr(rows, ';')) == NULL)
		return (-1);
	*t = '\0';
	cols = t + 1;
	if ((t = strchr(cols, 't')) == NULL)
		return (-1);
	*t = '\0';

	rowsi = atoi(rows);
	colsi = atoi(cols);

	if (rowsi < 1 || colsi < 1)
		return (-1);

	printf(SHELL_OUTPUT, colsi, rowsi);

	return (0);
}

int
main(int argc __UNUSED, char **argv __UNUSED)
{
	char *buf0 = NULL;
	boolean_t is_match = B_FALSE;
	char *term = getenv("TERM");

	/*
	 * We don't want to run on the VGA console, as it's entirely
	 * braindead.
	 */
	if (term != NULL && (strcmp(term, "sun") == 0 ||
	    strcmp(term, "sun-color") == 0)) {
		return (1);
	}

	/*
	 * Attempt to open our controlling terminal:
	 */
	if ((term_fd = open("/dev/tty", O_RDWR | O_NOCTTY)) == -1 ||
	    !isatty(term_fd)) {
		return (1);
	}

	/*
	 * Preserve original terminal settings:
	 */
	if (tcgetattr(term_fd, &orig_tios) == -1)
		return (1);

	if (raw_mode() == -1)
		return (1);

	/*
	 * In order to determine the size of a terminal that behaves like
	 * an xterm, we can send a control sequence requesting that information:
	 *
	 *    ESC [ 18 t
	 *
	 * A sufficiently advanced terminal emulator, e.g. xterm or iTerm, will
	 * respond with a size we can parse:
	 *
	 *    ESC [  8 ; ROWS ; COLUMNS t
	 *
	 * Unfortunately, not every terminal supports this control sequence
	 * and most terminals will not generate any data.  It's hard to detect
	 * the _absence_ of data without using an arbitrary timeout, which may
	 * be incorrect for some terminals or some high-latency connections,
	 * so we immediately send a second control sequence which just about
	 * everything since the VT100 _does_ support.  The response to the
	 * second escape sequence is easily distinguishable from the first,
	 * and so we can quickly determine if the terminal supported our query.
	 */
	if (write(term_fd, REQUEST, REQUEST_LENGTH) != REQUEST_LENGTH) {
		reset_mode();
		return (1);
	}

	/*
	 * Read back an entire control sequence:
	 */
	if ((buf0 = read_cseq()) != NULL) {
		/*
		 * Check to see if what we read back is the desired response
		 * to the _first_ request:
		 */
		if (strncmp(buf0, PREAMBLE, PREAMBLE_LENGTH) == 0) {
			/*
			 * The terminal understood our first request and
			 * responded with a preamble we recognise. Consume
			 * the second escape sequence which we know to be
			 * enroute.
			 */
			is_match = B_TRUE;
			free(read_cseq());
		}
	}

	reset_mode();

	if (!is_match)
		return (1);

	/*
	 * Process the response:
	 */
	return (process_size(buf0));
}
