/*
 * C command
 * written by John F. Reiser
 * July/August 1978
 */
/* Copyright (c) 2011 Joyent, Inc. All rights reserved. */
/*
 * This implementation is based on the UNIX 32V release from 1978
 * with permission from Caldera Inc.
 *
 * Copyright (c) 2010 J. Schilling
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTOR(S) ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTOR(S) BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */
/*
 * Copyright(C) Caldera International Inc. 2001-2002. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 * 1. Redistributions of source code and documentation must retain the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * 3. All advertising materials mentioning features or use of this software
 *    must display the following acknowledgement:  This product includes
 *    software developed or owned by Caldera International, Inc.
 *
 * 4. Neither the name of Caldera International, Inc. nor the names of other
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * USE OF THE SOFTWARE PROVIDED FOR UNDER THIS LICENSE BY CALDERA
 * INTERNATIONAL, INC.  AND CONTRIBUTORS ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL CALDERA INTERNATIONAL, INC. BE LIABLE FOR
 * ANY DIRECT, INDIRECT INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
 * IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <fcntl.h>
#include <string.h>
#include <stdarg.h>

#include "cpp.h"

#define	SYMLEN	128
static	int symlen = SYMLEN;


#define SALT '#'
#ifndef BUFSIZ
#define BUFSIZ 512
#endif

static	char *pbeg;
static	char *pbuf;
static	char *pend;
char *outp,*inp;
char *newp;
static	char cinit;

/* some code depends on whether characters are sign or zero extended */
/*	#if '\377' < 0		not used here, old cpp doesn't understand */
#if pdp11 | vax | '\377' < 0
#define COFF 128
#else
#define COFF 0
#endif

#define ALFSIZ 256	/* alphabet size */
static	char macbit[ALFSIZ+11];
static	char toktyp[ALFSIZ];
#define BLANK 1		/* white space (" \t\v\f\r") */
#define IDENT 2		/* valid char for identifier names */
#define NUMBR 3		/* chars is of "0123456789." */

/*
 * a superimposed code is used to reduce the number of calls to the
 * symbol table lookup routine.  (if the kth character of an identifier
 * is 'a' and there are no macro names whose kth character is 'a'
 * then the identifier cannot be a macro name, hence there is no need
 * to look in the symbol table.)  'scw1' enables the test based on
 * single characters and their position in the identifier.  'scw2'
 * enables the test based on adjacent pairs of characters and their
 * position in the identifier.  scw1 typically costs 1 indexed fetch,
 * an AND, and a jump per character of identifier, until the identifier
 * is known as a non-macro name or until the end of the identifier.
 * scw1 is inexpensive.  scw2 typically costs 4 indexed fetches,
 * an add, an AND, and a jump per character of identifier, but it is also
 * slightly more effective at reducing symbol table searches.
 * scw2 usually costs too much because the symbol table search is
 * usually short; but if symbol table search should become expensive,
 * the code is here.
 * using both scw1 and scw2 is of dubious value.
 */
#define scw1 1
#define scw2 0

#if scw2
char t21[ALFSIZ],t22[ALFSIZ],t23[ALFSIZ+SYMLEN];
#endif

#if scw1
#define b0 1
#define b1 2
#define b2 4
#define b3 8
#define b4 16
#define b5 32
#define b6 64
#define b7 128
#endif

#define IB 1
#define SB 2
#define NB 4
#define CB 8
#define QB 16
#define WB 32
	char fastab[ALFSIZ];
static	char slotab[ALFSIZ];
static	char *ptrtab;

/*
 * Cast the array index to int in order to avoid GCCs warnings:
 * warning: subscript has type `char'
 */
#define isslo (ptrtab==(slotab+COFF))
#define isid(a)  ((fastab+COFF)[(int)a]&IB)
#define isspc(a) (ptrtab[(int)a]&SB)
#define isnum(a) ((fastab+COFF)[(int)a]&NB)
#define iscom(a) ((fastab+COFF)[(int)a]&CB)
#define isquo(a) ((fastab+COFF)[(int)a]&QB)
#define iswarn(a) ((fastab+COFF)[(int)a]&WB)

#define eob(a) ((a)>=pend)
#define bob(a) (pbeg>=(a))

#define	BUFFERSIZ	8192
static	char buffer[SYMLEN+BUFFERSIZ+BUFFERSIZ+SYMLEN];

/*
 * SBSIZE was 12000 in 1978, we need to have a way to
 * malloc more space.
 */
#define SBSIZE 512000
static	char	sbf[SBSIZE];
static	char	*savch	= sbf;

# define DROP 0xFE	/* special character not legal ASCII or EBCDIC */
# define WARN DROP
# define SAME 0
# define MAXINC 16	/* max include nesting depth */
# define MAXIDIRS 20	/* max # of -I directories */
# define MAXFRE 14	/* max buffers of macro pushback */
# define MAXFRM 31	/* max number of formals/actuals to a macro */

static char warnc = (char)WARN;

static	int mactop;
static	int fretop;
static	char *instack[MAXFRE];
static	char *bufstack[MAXFRE];
static	char *endbuf[MAXFRE];

static	int plvl;	/* parenthesis level during scan for macro actuals */
static	int maclin;	/* line number of macro call requiring actuals */
static	char *macfil;	/* file name of macro call requiring actuals */
static	char *macnam;	/* name of macro requiring actuals */
static	int maclvl;	/* # calls since last decrease in nesting level */
static	char *macforw;	/* ptr which must be exceeded to decrease nesting lvl */
static	int macdam;	/* offset to macforw due to buffer shifting */

#if tgp
int tgpscan;	/* flag for dump(); */
#endif

static	int	inctop[MAXINC];
static	char	*fnames[MAXINC];
static	char	*dirnams[MAXINC];	/* actual directory of #include files */
static	int	fins[MAXINC];
static	int	lineno[MAXINC];

/*
 * We need:
 *	"" include dir as dirs[0] +
 *	MAXIDIRS +
 *	system default include dir +
 *	a NULL pointer at the end
 */
static	char	*dirs[MAXIDIRS+3];	/* -I and <> directories */
static	int	fin	= STDIN_FILENO;
static	FILE	*fout;			/* Init in main(), Mac OS is nonPOSIX */
static	int	nd	= 1;
static	int	pflag;	/* don't put out lines "# 12 foo.c" */
static	int	passcom;	/* don't delete comments */
static	int rflag;	/* allow macro recursion */
static	int	hflag;	/* Print included filenames */
static	int	nopredef;	/* -undef all */
static	int	ifno;
# define NPREDEF 64
static	char *prespc[NPREDEF];
static	char **predef = prespc;
static	char *punspc[NPREDEF];
static	char **prund = punspc;
static	int	exfail;
static	struct symtab *lastsym;


static	void		sayline(char *);
static	void		dump(void);
static	char		*refill(char *);
static	char		*cotoken(char *);
char		*skipbl(char *);
static	char		*unfill(char *);
static	char		*doincl(char *);
static	int		equfrm(char *, char *, char *);
static	char		*dodef(char *);
static	char		*control(char *);
static	struct symtab	*stsym(char *);
static	struct symtab	*ppsym(char *);
void		pperror(char *fmt, ...);
void		yyerror(char *fmt, ...);
static	void		ppwarn(char *fmt, ...);
struct symtab	*lookup(char *, int);
static	struct symtab	*slookup(char *, char *, int);
static	char		*subst(char *, struct symtab *);
static	char		*trmdir(char *);
static	char		*copy(char *);
static	char		*strdex(char *, int);
int		yywrap(void);
int		main(int argc, char **argav);


#define symsiz 4000
static	struct symtab stab[symsiz];

static	struct symtab *defloc;
static	struct symtab *udfloc;
static	struct symtab *incloc;
static	struct symtab *ifloc;
static	struct symtab *elsloc;
static	struct symtab *eifloc;
static	struct symtab *elifloc;
static	struct symtab *ifdloc;
static	struct symtab *ifnloc;
static	struct symtab *ysysloc;
static	struct symtab *varloc;
static	struct symtab *lneloc;
static	struct symtab *ulnloc;
static	struct symtab *uflloc;
static	struct symtab *idtloc;
static	struct symtab *pragmaloc;
static	struct symtab *errorloc;
static	int	trulvl;
	int	flslvl;
static	int	elflvl;
static	int	elslvl;

/*
 * The sun cpp prints a classification token past the
 * "# linenumber filename" lines:
 */
#define	NOINCLUDE	""	/* Not related to enter/leave incl. file */
#define	ENTERINCLUDE	"1"	/* We are just entering an include file  */
#define	LEAVEINCLUDE	"2"	/* We are just leaving an include file   */

/* ARGSUSED */
static void
sayline(what)
	char	*what;
{
	if (pflag==0)
	    fprintf(fout,"# %d \"%s\" %s\n", lineno[ifno], fnames[ifno], what);
}

/*
 * data structure guide
 *
 * most of the scanning takes place in the buffer:
 *
 *  (low address)                                             (high address)
 *  pbeg                           pbuf                                 pend
 *  |      <-- BUFFERSIZ chars -->   |         <-- BUFFERSIZ chars -->     |
 *  _______________________________________________________________________
 * |_______________________________________________________________________|
 *          |               |               | 
 *          |<-- waiting -->|               |<-- waiting -->
 *          |    to be      |<-- current -->|    to be
 *          |    written    |    token      |    scanned
 *          |               |               |
 *          outp            inp             p
 *
 *  *outp   first char not yet written to output file
 *  *inp    first char of current token
 *  *p      first char not yet scanned
 *
 * macro expansion: write from *outp to *inp (chars waiting to be written),
 * ignore from *inp to *p (chars of the macro call), place generated
 * characters in front of *p (in reverse order), update pointers,
 * resume scanning.
 *
 * symbol table pointers point to just beyond the end of macro definitions;
 * the first preceding character is the number of formal parameters.
 * the appearance of a formal in the body of a definition is marked by
 * 2 chars: the char WARN, and a char containing the parameter number.
 * the first char of a definition is preceded by a zero character.
 *
 * when macro expansion attempts to back up over the beginning of the
 * buffer, some characters preceding *pend are saved in a side buffer,
 * the address of the side buffer is put on 'instack', and the rest
 * of the main buffer is moved to the right.  the end of the saved buffer
 * is kept in 'endbuf' since there may be nulls in the saved buffer.
 *
 * similar action is taken when an 'include' statement is processed,
 * except that the main buffer must be completely emptied.  the array
 * element 'inctop[ifno]' records the last side buffer saved when
 * file 'ifno' was included.  these buffers remain dormant while
 * the file is being read, and are reactivated at end-of-file.
 *
 * instack[0 : mactop] holds the addresses of all pending side buffers.
 * instack[inctop[ifno]+1 : mactop-1] holds the addresses of the side
 * buffers which are "live"; the side buffers instack[0 : inctop[ifno]]
 * are dormant, waiting for end-of-file on the current file.
 *
 * space for side buffers is obtained from 'savch' and is never returned.
 * bufstack[0:fretop-1] holds addresses of side buffers which
 * are available for use.
 */

static void
dump() {
/*
 * write part of buffer which lies between  outp  and  inp .
 * this should be a direct call to 'write', but the system slows to a crawl
 * if it has to do an unaligned copy.  thus we buffer.  this silly loop
 * is 15% of the total time, thus even the 'putc' macro is too slow.
 */
	register char *p1;
#if tgp
	register char *p2;
#endif
	register FILE *f;
	if ((p1=outp)==inp || flslvl!=0) return;
#if tgp
#define MAXOUT 80
	if (!tgpscan) {
		/* scan again to insure <= MAXOUT chars between linefeeds */
		register char c,*pblank; char savc,stopc,brk;
		tgpscan=1; brk=stopc=pblank=0; p2=inp; savc= *p2; *p2='\0';
		while (c= *p1++) {
			if (c=='\\') c= *p1++;
			if (stopc==c) stopc=0;
			else if (c=='"' || c=='\'') stopc=c;
			if (p1-outp>MAXOUT && pblank!=0) {
				*pblank++='\n';
				inp=pblank;
				dump();
				brk=1;
				pblank=0;
			}
			if (c==' ' && stopc==0) pblank=p1-1;
		}
		if (brk) sayline(NOINCLUDE);
		*p2=savc; inp=p2; p1=outp; tgpscan=0;
	}
#endif
	f=fout;
	while (p1<inp)
		putc(*p1++,f);
	outp=p1;
}

static char *
refill(p) register char *p; {
/*
 * dump buffer.  save chars from inp to p.  read into buffer at pbuf,
 * contiguous with p.  update pointers, return new p.
 */
	register char *np,*op; register int ninbuf;
	dump(); np=pbuf-(p-inp); op=inp;
	if (bob(np+1)) {pperror("token too long"); np=pbeg; p=inp+BUFFERSIZ;}
	macdam += np-inp; outp=inp=np;
	while (op<p) *np++= *op++;
	p=np;
	for (;;) {
		if (mactop>inctop[ifno]) {
			/* retrieve hunk of pushed-back macro text */
			op=instack[--mactop]; np=pbuf;
			do {
				while ((*np++= *op++) != '\0');
			} while (op<endbuf[mactop]); pend=np-1;
			/* make buffer space avail for 'include' processing */
			if (fretop<MAXFRE) bufstack[fretop++]=instack[mactop];
			return(p);
		} else {/* get more text from file(s) */
			maclvl=0;
			if (0<(ninbuf=read(fin,pbuf,BUFFERSIZ))) {
				pend=pbuf+ninbuf; *pend='\0';
				return(p);
			}
			/* end of #include file */
			if (ifno==0) {/* end of input */
				if (plvl!=0) {
					int n=plvl,tlin=lineno[ifno];
					char *tfil=fnames[ifno];
					lineno[ifno]=maclin;
					fnames[ifno]=macfil;
					pperror("%s: unterminated macro call",
					    macnam);
					lineno[ifno]=tlin; fnames[ifno]=tfil;
					np=p;
					/*
					 * shut off unterminated quoted string
					 */
					*np++='\n';
					/* supply missing parens */
					while (--n>=0) *np++=')';
					pend=np; *np='\0';
					if (plvl<0) plvl=0;
					return(p);
				}
				inp=p; dump(); exit(exfail);
			}
			close(fin);
			fin=fins[--ifno];
			dirs[0]=dirnams[ifno];
			sayline(LEAVEINCLUDE);
		}
	}
}

#define BEG 0
#define LF 1

static char *
cotoken(p) register char *p; {
	register int c,i; char quoc;
	static int state = BEG;

	if (state!=BEG) goto prevlf;
for (;;) {
again:
	while (!isspc(*p++));
	switch (*(inp=p-1)) {
	case 0: {
		if (eob(--p)) {p=refill(p); goto again;}
		else ++p; /* ignore null byte */
	} break;
	case '|': case '&': for (;;) {/* sloscan only */
		if (*p++== *inp) break;
		if (eob(--p)) p=refill(p);
		else break;
	} break;
	case '=': case '!': for (;;) {/* sloscan only */
		if (*p++=='=') break;
		if (eob(--p)) p=refill(p);
		else break;
	} break;
	case '<': case '>': for (;;) {/* sloscan only */
		if (*p++=='=' || p[-2]==p[-1]) break;
		if (eob(--p)) p=refill(p);
		else break;
	} break;
	case '\\': for (;;) {
		if (*p++=='\n') {++lineno[ifno]; break;}
		if (eob(--p)) p=refill(p);
		else {++p; break;}
	} break;
	case '/': for (;;) {
		if (*p++=='*') {/* comment */
			if (!passcom) {inp=p-2; dump(); ++flslvl;}
			for (;;) {
				while (!iscom(*p++));
				if (p[-1]=='*') for (;;) {
					if (*p++=='/') goto endcom;
					if (eob(--p)) {
						if (!passcom) {
							inp=p;
							p=refill(p);
						} else if ((p-inp)>=BUFFERSIZ) {
							/* split long comment */
							inp=p;
							/*
							 * last char written
							 * is '*'
							 */
							p=refill(p);
							/*
							 * terminate first part
							 */
							putc('/',fout);
							/*
							 * and fake start of 2nd
							 */
							outp=inp=p-=3;
							*p++='/';
							*p++='*';
							*p++='*';
						} else {
							p=refill(p);
						}
					} else {
						break;
					}
				} else if (p[-1]=='\n') {
					++lineno[ifno];
					if (!passcom)
						putc('\n',fout);
				} else if (eob(--p)) {
					if (!passcom) {
						inp=p; p=refill(p);
					} else if ((p-inp)>=BUFFERSIZ) {
						/* split long comment */
						inp=p; p=refill(p);
						putc('*',fout); putc('/',fout);
						outp=inp=p-=2;
						*p++='/';
						*p++='*';
					} else {
						p=refill(p);
					}
				} else {
					++p; /* ignore null byte */
				}
			}
		endcom:
			if (!passcom) {outp=inp=p; --flslvl; goto again;}
			break;
		}
		if (eob(--p)) p=refill(p);
		else break;
	} break;
	case '"': case '\'': {
		quoc=p[-1];
		for (;;) {
			while (!isquo(*p++));
			if (p[-1]==quoc)
				break;
			if (p[-1]=='\n') {
				--p;
				break;
			} /* bare \n terminates quotation */
			if (p[-1]=='\\') {
				for (;;) {
					if (*p++=='\n') {
						++lineno[ifno];
						break;
					} /* escaped \n ignored */
					if (eob(--p)) {
						p=refill(p);
					} else {
						++p;
						break;
					}
				}
			} else if (eob(--p)) {
				p=refill(p);
			} else {
				++p;	/* it was a different quote character */
			}
		}
	} break;
	case '\n': {
		++lineno[ifno]; if (isslo) {state=LF; return(p);}
prevlf:
		state=BEG;
		for (;;) {
			if (*p++=='#') return(p);
			if (eob(inp= --p)) p=refill(p);
			else goto again;
		}
	}
	/* NOTREACHED */
	case '0': case '1': case '2': case '3': case '4':
	case '5': case '6': case '7': case '8': case '9':
	for (;;) {
		while (isnum(*p++));
		if (eob(--p)) p=refill(p);
		else break;
	} break;
	case 'A': case 'B': case 'C': case 'D': case 'E':
	case 'F': case 'G': case 'H': case 'I': case 'J':
	case 'K': case 'L': case 'M': case 'N': case 'O':
	case 'P': case 'Q': case 'R': case 'S': case 'T':
	case 'U': case 'V': case 'W': case 'X': case 'Y':
	case 'Z': case '_':
	case 'a': case 'b': case 'c': case 'd': case 'e':
	case 'f': case 'g': case 'h': case 'i': case 'j':
	case 'k': case 'l': case 'm': case 'n': case 'o':
	case 'p': case 'q': case 'r': case 's': case 't':
	case 'u': case 'v': case 'w': case 'x': case 'y':
	case 'z':
#if scw1
#define tmac1(c,bit) if (!xmac1(c,bit,&)) goto nomac
#define xmac1(c,bit,op) ((macbit+COFF)[c] op (bit))
#else
#define tmac1(c,bit)
#define xmac1(c,bit,op)
#endif

#if scw2
#define tmac2(c0,c1,cpos) if (!xmac2(c0,c1,cpos,&)) goto nomac
#define xmac2(c0,c1,cpos,op)\
	((macbit+COFF)[(t21+COFF)[c0]+(t22+COFF)[c1]] op (t23+COFF+cpos)[c0])
#else
#define tmac2(c0,c1,cpos)
#define xmac2(c0,c1,cpos,op)
#endif

	if (flslvl) goto nomac;
	for (;;) {
		c= p[-1];                          tmac1(c,b0);
		i= *p++; if (!isid(i)) goto endid; tmac1(i,b1); tmac2(c,i,0);
		c= *p++; if (!isid(c)) goto endid; tmac1(c,b2); tmac2(i,c,1);
		i= *p++; if (!isid(i)) goto endid; tmac1(i,b3); tmac2(c,i,2);
		c= *p++; if (!isid(c)) goto endid; tmac1(c,b4); tmac2(i,c,3);
		i= *p++; if (!isid(i)) goto endid; tmac1(i,b5); tmac2(c,i,4);
		c= *p++; if (!isid(c)) goto endid; tmac1(c,b6); tmac2(i,c,5);
		i= *p++; if (!isid(i)) goto endid; tmac1(i,b7); tmac2(c,i,6);
		                                                tmac2(i,0,7);
		while (isid(*p++));
		if (eob(--p)) {refill(p); p=inp+1; continue;}
		goto lokid;
	endid:
		if (eob(--p)) {refill(p); p=inp+1; continue;}
		tmac2(p[-1],0,-1+(p-inp));
	lokid:
		slookup(inp,p,0); if (newp) {p=newp; goto again;}
		else break;
	nomac:
		while (isid(*p++));
		if (eob(--p)) {p=refill(p); goto nomac;}
		else break;
	} break;
	} /* end of switch */
	
	if (isslo) return(p);
} /* end of infinite loop */
}

char *
skipbl(p) register char *p; {/* get next non-blank token */
	do {
		outp=inp=p;
		p=cotoken(p);
	} while ((toktyp+COFF)[(int)*inp]==BLANK);
	return(p);
}

static char *
unfill(p) register char *p; {
/*
 * take <= BUFFERSIZ chars from right end of buffer and put them on instack .
 * slide rest of buffer to the right, update pointers, return new p.
 */
	register char *np,*op; register int d;
	if (mactop>=MAXFRE) {
		pperror("%s: too much pushback",macnam);
		p=inp=pend; dump();	/* begin flushing pushback */
		while (mactop>inctop[ifno]) {p=refill(p); p=inp=pend; dump();}
	}
	if (fretop>0)
		np=bufstack[--fretop];
	else {
		np=savch; savch+=BUFFERSIZ;
		if (savch>=sbf+SBSIZE) {pperror("no space"); exit(exfail);}
		*savch++='\0';
	}
	instack[mactop]=np; op=pend-BUFFERSIZ; if (op<p) op=p;
	for (;;) {
		while ((*np++= *op++) != '\0');
		if (eob(op))
			break;
	} /* out with old */
	endbuf[mactop++]=np;	/* mark end of saved text */
	np=pbuf+BUFFERSIZ;
	op=pend-BUFFERSIZ;
	pend=np;
	if (op<p)
		op=p;
	while (outp<op) *--np= *--op; /* slide over new */
	if (bob(np))
		pperror("token too long");
	d=np-outp; outp+=d; inp+=d; macdam+=d;
	return(p+d);
}

static char *
doincl(p) register char *p; {
	int filok,inctype;
	register char *cp; char **dirp,*nfil; char filname[BUFFERSIZ];

	filname[0] = '\0';	/* Make lint quiet */
	p=skipbl(p); cp=filname;
	if (*inp++=='<') {/* special <> syntax */
		inctype=1;
		for (;;) {
			outp=inp=p; p=cotoken(p);
			if (*inp=='\n') {--p; *cp='\0'; break;}
			if (*inp=='>') {      *cp='\0'; break;}
# ifdef gimpel
			if (*inp=='.' && !intss()) *inp='#';
# endif
			while (inp<p) *cp++= *inp++;
		}
	} else if (inp[-1]=='"') {/* regular "" syntax */
		inctype=0;
# ifdef gimpel
		while (inp<p) {if (*inp=='.' && !intss()) *inp='#'; *cp++= *inp++;}
# else
		while (inp<p) *cp++= *inp++;
# endif
		if (*--cp=='"') *cp='\0';
	} else {pperror("bad include syntax",0); inctype=2;}
	/* flush current file to \n , then write \n */
	++flslvl; do {outp=inp=p; p=cotoken(p);} while (*inp!='\n'); --flslvl;
	inp=p; dump(); if (inctype==2) return(p);
	/* look for included file */
	if (ifno+1 >=MAXINC) {
		pperror("Unreasonable include nesting",0); return(p);
	}
	if ((nfil=savch)>sbf+SBSIZE-BUFFERSIZ) {
		pperror("no space");
		exit(exfail);
	}
	filok=0;
	for (dirp=dirs+inctype; *dirp; ++dirp) {
		if (filname[0]=='/' || **dirp=='\0') {
			strcpy(nfil,filname);
		} else {
			strcpy(nfil,*dirp);
# if unix
			strcat(nfil,"/");
# endif
			strcat(nfil,filname);
		}
		if (0<(fins[ifno+1]=open(nfil, O_RDONLY))) {
			filok=1; fin=fins[++ifno]; break;
		}
	}
	if (filok==0) {
		pperror("Can't find include file %s",filname);
	} else {
		lineno[ifno]=1; fnames[ifno]=cp=nfil; while (*cp++); savch=cp;
		dirnams[ifno]=dirs[0]=trmdir(copy(nfil));
		sayline(ENTERINCLUDE);
		if (hflag)
			fprintf(stderr, "%s\n", nfil);
		/* save current contents of buffer */
		while (!eob(p)) p=unfill(p);
		inctop[ifno]=mactop;
	}
	return(p);
}

static int
equfrm(a,p1,p2) register char *a,*p1,*p2; {
	register char c; int flag;
	c= *p2; *p2='\0';
	flag=strcmp(a,p1); *p2=c; return(flag==SAME);
}

static char *
dodef(p) char *p; {/* process '#define' */
	register char *pin,*psav,*cf;
	char **pf,**qf; int b,c,params; struct symtab *np;
	char *oldval,*oldsavch;
	char *formal[MAXFRM]; /* formal[n] is name of nth formal */
	char formtxt[BUFFERSIZ]; /* space for formal names */

	formtxt[0] = '\0';	/* Make lint quiet */

	if (savch>sbf+SBSIZE-BUFFERSIZ) {
		pperror("too much defining");
		return(p);
	}
	oldsavch=savch; /* to reclaim space if redefinition */
	++flslvl; /* prevent macro expansion during 'define' */
	p=skipbl(p); pin=inp;
	if ((toktyp+COFF)[(int)*pin]!=IDENT) {
		ppwarn("illegal macro name");
		while (*inp!='\n')
			p=skipbl(p);
		return(p);
	}
	np=slookup(pin,p,1);
	if ((oldval=np->value) != NULL)
		savch=oldsavch;	/* was previously defined */
	b=1; cf=pin;
	while (cf<p) {/* update macbit */
		c= *cf++; xmac1(c,b,|=); b=(b+b)&0xFF;
		if (cf!=p) {
			xmac2(c,*cf,-1+(cf-pin),|=);
		} else {
			xmac2(c,0,-1+(cf-pin),|=);
		}
	}
	params=0; outp=inp=p; p=cotoken(p); pin=inp;
	formal[0] = "";	/* Prepare for hack at next line... */
	pf = formal;	/* Make gcc/lint quiet, pf only used with params!=0 */
	if (*pin=='(') {/* with parameters; identify the formals */
		cf=formtxt; pf=formal;
		for (;;) {
			p=skipbl(p); pin=inp;
			if (*pin=='\n') {
				--lineno[ifno];
				--p;
				pperror("%s: missing )",np->name);
				break;
			}
			if (*pin==')') break;
			if (*pin==',') continue;
			if ((toktyp+COFF)[(int)*pin]!=IDENT) {
				c= *p;
				*p='\0';
				pperror("bad formal: %s",pin);
				*p=c;
			} else if (pf>= &formal[MAXFRM]) {
				c= *p;
				*p='\0';
				pperror("too many formals: %s",pin);
				*p=c;
			} else {
				*pf++=cf;
				while (pin<p)
					*cf++= *pin++;
				*cf++='\0';
				++params;
			}
		}
		if (params==0)
			--params; /* #define foo() ... */
	} else if (*pin=='\n') {
		--lineno[ifno];
		--p;
	}
	/*
	 * remember beginning of macro body, so that we can
	 * warn if a redefinition is different from old value.
	 */
	oldsavch=psav=savch;
	for (;;) {/* accumulate definition until linefeed */
		outp=inp=p; p=cotoken(p); pin=inp;
		if (*pin=='\\' && pin[1]=='\n')
			continue;	/* ignore escaped lf */
		if (*pin=='\n') break;
		if (params) {
			/* mark the appearance of formals in the definiton */
			if ((toktyp+COFF)[(int)*pin]==IDENT) {
				for (qf=pf; --qf>=formal; ) {
					if (equfrm(*qf,pin,p)) {
						*psav++=qf-formal+1;
						*psav++=WARN;
						pin=p;
						break;
					}
				}
			} else if (*pin=='"' || *pin=='\'') {
				/* inside quotation marks, too */
				char quoc= *pin;
				for (*psav++= *pin++; pin<p && *pin!=quoc; ) {
					while (pin<p && !isid(*pin))
						*psav++= *pin++;
					cf=pin;
					while (cf<p && isid(*cf))
						++cf;
					for (qf=pf; --qf>=formal; ) {
						if (equfrm(*qf,pin,cf)) {
							*psav++=qf-formal+1;
							*psav++=WARN;
							pin=cf;
							break;
						}
					}
					while (pin<cf)
						*psav++= *pin++;
				}
			}
		}
		while (pin<p) *psav++= *pin++;
	}
	*psav++=params; *psav++='\0';
	if ((cf=oldval)!=NULL) {/* redefinition */
		--cf;	/* skip no. of params, which may be zero */
		while (*--cf);	/* go back to the beginning */
		if (0!=strcmp(++cf,oldsavch)) {
			/* redefinition different from old */
			--lineno[ifno];
			ppwarn("%s redefined",np->name);
			++lineno[ifno];
			np->value=psav-1;
		} else {
			psav=oldsavch; /* identical redef.; reclaim space */
		}
	} else {
		np->value=psav-1;
	}
	--flslvl; inp=pin; savch=psav; return(p);
}

#define fasscan() ptrtab=fastab+COFF
#define sloscan() ptrtab=slotab+COFF

static char *
control(p) register char *p; {/* find and handle preprocessor control lines */
	register struct symtab *np;
for (;;) {
	fasscan(); p=cotoken(p); if (*inp=='\n') ++inp; dump();
	sloscan(); p=skipbl(p);
	*--inp=SALT; outp=inp; ++flslvl; np=slookup(inp,p,0); --flslvl;
	if (np==defloc) {/* define */
		if (flslvl==0) {p=dodef(p); continue;}
	} else if (np==incloc) {/* include */
		if (flslvl==0) {p=doincl(p); continue;}
	} else if (np==ifnloc) {/* ifndef */
		++flslvl; p=skipbl(p); np=slookup(inp,p,0); --flslvl;
		if (flslvl==0 && np->value==0) ++trulvl;
		else ++flslvl;
	} else if (np==ifdloc) {/* ifdef */
		++flslvl; p=skipbl(p); np=slookup(inp,p,0); --flslvl;
		if (flslvl==0 && np->value!=0) ++trulvl;
		else ++flslvl;
	} else if (np==eifloc) {/* endif */
		if (flslvl) {if (--flslvl==0) sayline(NOINCLUDE);}
		else if (trulvl) --trulvl;
		else pperror("If-less endif",0);

		if (flslvl == 0)
			elflvl = 0;
		elslvl = 0;
	} else if (np==elifloc) {/* elif */
		if (flslvl == 0)
			elflvl = trulvl;
		if (flslvl) {
			if (elflvl > trulvl) {
				;
			} else if (--flslvl != 0) {
				++flslvl;
			} else {
				newp = p;
				if (yyparse()) {
					++trulvl;
					sayline(NOINCLUDE);
				} else {
					++flslvl;
				}
				p = newp;
			}
		} else if (trulvl) {
			++flslvl;
			--trulvl;
		} else
			pperror("If-less elif");

	} else if (np==elsloc) {/* else */
		if (flslvl) {
			if (elflvl > trulvl)
				;
			else if (--flslvl!=0) ++flslvl;
			else {++trulvl; sayline(NOINCLUDE);}
		}
		else if (trulvl) {++flslvl; --trulvl;}
		else pperror("If-less else",0);

		if (elslvl==trulvl+flslvl) 
			pperror("Too many #else's"); 
		elslvl=trulvl+flslvl; 

	} else if (np==udfloc) {/* undefine */
		if (flslvl==0) {
			++flslvl; p=skipbl(p); slookup(inp,p,DROP); --flslvl;
		}
	} else if (np==ifloc) {/* if */
#if tgp
		pperror(" IF not implemented, true assumed", 0);
		if (flslvl==0) ++trulvl; else ++flslvl;
#else
		newp=p;
		if (flslvl==0 && yyparse()) ++trulvl; else ++flslvl;
		p=newp;
#endif
	} else if (np == idtloc) {		/* ident */
		if (pflag == 0)
			while (*inp != '\n')	/* pass text */
				p = cotoken(p);
	} else if (np == pragmaloc) {		/* pragma */
		while (*inp != '\n')		/* pass text */
			p = cotoken(p);
	} else if (np == errorloc) {		/* error */
#ifdef	EXIT_ON_ERROR
		if (trulvl > 0) {
			char ebuf[BUFFERSIZ];

			p = ebuf;
			while (*inp != '\n') {
				if (*inp == '\0')
					if (eob(--inp)) {
						inp = refill(inp);
						continue;
					}
				*p++ = *inp++;
				if (p >= &ebuf[BUFFERSIZ-1])
					break;
			}
			*p = '\0';
			pperror(ebuf);
			exit(exfail);
		}
#else
		while (*inp != '\n')		/* pass text */
			p = cotoken(p);
#endif
	} else if (np==lneloc) {/* line */
		if (flslvl==0 && pflag==0) {
			outp=inp=p;
			*--outp='#';
			while (*inp!='\n')
				p=cotoken(p);
			continue;
		}
	} else if (*++inp=='\n') {
		outp=inp;	/* allows blank line after # */
	} else {
		pperror("undefined control",0);
	}
	/* flush to lf */
	++flslvl;
	while (*inp!='\n') {
		outp=inp=p;
		p=cotoken(p);
	}
	--flslvl;
}
}

static struct symtab *
stsym(s) register char *s; {
	char buf[BUFFERSIZ]; register char *p;

	/* make definition look exactly like end of #define line */
	/* copy to avoid running off end of world when param list is at end */
	p=buf; while ((*p++= *s++) != '\0');
	p=buf; while (isid(*p++)); /* skip first identifier */
	if (*--p=='=') {*p++=' '; while (*p++);}
	else {s=" 1"; while ((*p++= *s++) != '\0');}
	pend=p; *--p='\n';
	sloscan(); dodef(buf); return(lastsym);
}

static struct symtab *
ppsym(s) char *s; {/* kluge */
	register struct symtab *sp;
	cinit=SALT; *savch++=SALT; sp=stsym(s); --sp->name; cinit=0; return(sp);
}

void
verror(char *fmt, va_list args)
{
	if (fnames[ifno][0])
		fprintf(stderr, "%s: ", fnames[ifno]);
	fprintf(stderr, "%d: ",lineno[ifno]);

	(void)vfprintf(stderr, fmt, args);
	fputc('\n', stderr);
}

/* VARARGS1 */
void
pperror(char *fmt, ...)
{
	va_list	args;

	va_start(args, fmt);
	verror(fmt, args);
	va_end(args);

	++exfail;
}

/* VARARGS1 */
void
yyerror(char *fmt, ...)
{
	va_list	args;

	va_start(args, fmt);
	verror(fmt, args);
	va_end(args);
}

/* VARARGS1 */
static void
ppwarn(char *fmt, ...)
{
	va_list	args;
	int fail = exfail;
	exfail = -1;

	va_start(args, fmt);
	verror(fmt, args);
	va_end(args);

	exfail = fail;
}

struct symtab *
lookup(namep, enterf)
char *namep;
int enterf;
{
	register char *np, *snp;
	register int c, i; int around;
	register struct symtab *sp;

	/* namep had better not be too long (currently, <=symlen chars) */
	np=namep; around=0; i=cinit;
	while ((c = *np++) != '\0')
		i += i+c;
	c=i;	/* c=i for register usage on pdp11 */
	c %= symsiz;
	if (c<0)
		c += symsiz;
	sp = &stab[c];
	while ((snp=sp->name) != NULL) {
		np = namep;
		while (*snp++ == *np)
			if (*np++ == '\0') {
				if (enterf==DROP) {
					sp->name[0]= DROP;
					sp->value=0;
				}
				return(lastsym=sp);
			}
		if (--sp < &stab[0]) {
			if (around) {
				pperror("too many defines", 0);
				exit(exfail);
			} else {
				++around;
				sp = &stab[symsiz-1];
			}
		}
	}
	if (enterf>0)
		sp->name=namep;
	return (lastsym=sp);
}

static struct symtab *
slookup(p1,p2,enterf) register char *p1,*p2; int enterf;{
	register char *p3; char c2,c3; struct symtab *np;
	c2= *p2; *p2='\0';	/* mark end of token */
	if ((p2-p1)>symlen)
		p3=p1+symlen;
	else
		p3=p2;
	c3= *p3; *p3='\0';	/* truncate to symlen chars or less */
	if (enterf==1)
		p1=copy(p1);
	np=lookup(p1,enterf); *p3=c3; *p2=c2;
	if (np->value!=0 && flslvl==0)
		newp=subst(p2,np);
	else
		newp=0;
	return(np);
}

static char *
subst(p,sp) register char *p; struct symtab *sp; {
	static char match[]="%s: argument mismatch";
	register char *ca,*vp; int params;
	char *actual[MAXFRM]; /* actual[n] is text of nth actual */
	char acttxt[BUFFERSIZ]; /* space for actuals */

	if (0==(vp=sp->value)) return(p);
	if ((p-macforw)<=macdam) {
		if (++maclvl>symsiz && !rflag) {
			pperror("%s: macro recursion",sp->name);
			return(p);
		}
	} else {
		maclvl=0;	/* level decreased */
	}
	macforw=p; macdam=0;	/* new target for decrease in level */
	macnam=sp->name;
	dump();
	if (sp==ulnloc) {
		vp=acttxt; *vp++='\0';
		sprintf(vp,"%d",lineno[ifno]); while (*vp++);
	} else if (sp==uflloc) {
		vp=acttxt; *vp++='\0';
		sprintf(vp,"\"%s\"",fnames[ifno]); while (*vp++);
	}
	if (0!=(params= *--vp&0xFF)) {/* definition calls for params */
		register char **pa;
		ca=acttxt; pa=actual;
		if (params==0xFF)
			params=1;	/* #define foo() ... */
		sloscan();
		++flslvl; /* no expansion during search for actuals */
		plvl= -1;
		do p=skipbl(p); while (*inp=='\n');	/* skip \n too */
		if (*inp=='(') {
			maclin=lineno[ifno]; macfil=fnames[ifno];
			for (plvl=1; plvl!=0; ) {
				*ca++='\0';
				for (;;) {
					outp=inp=p; p=cotoken(p);
					if (*inp=='(') ++plvl;
					if (*inp==')' && --plvl==0) {
						--params;
						break;
					}
					if (plvl==1 && *inp==',') {
						--params;
						break;
					}
					while (inp<p) {
						/*
						 * Sun cpp compatibility.
						 * Needed for kernel assembler
						 * preprocessing.
						 * Replace newlines in actual
						 * macro parameters by spaces.
						 * Keep escaped newlines, they
						 * are assumed to be inside a
						 * string.
						 */
						if (*inp == '\n' &&
						    inp[-1] != '\\')
							*inp = ' ';
						*ca++= *inp++;
					}
					if (ca> &acttxt[BUFFERSIZ])
						pperror("%s: actuals too long",
						    sp->name);
				}
				if (pa>= &actual[MAXFRM])
					ppwarn(match,sp->name);
				else
					*pa++=ca;
			}
		}
		if (params!=0)
			ppwarn(match,sp->name);
		while (--params>=0)
			*pa++=""+1;	/* null string for missing actuals */
		--flslvl; fasscan();
	}
	for (;;) {/* push definition onto front of input stack */
		while (!iswarn(*--vp)) {
			if (bob(p)) {outp=inp=p; p=unfill(p);}
			*--p= *vp;
		}
		if (*vp==warnc) {/* insert actual param */
			ca=actual[*--vp-1];
			while (*--ca) {
				if (bob(p)) {outp=inp=p; p=unfill(p);}
				*--p= *ca;
			}
		} else break;
	}
	outp=inp=p;
	return(p);
}

static char *
trmdir(s) register char *s; {
	register char *p = s;
	while (*p++); --p; while (p>s && *--p!='/');
# if unix
	if (p==s) *p++='.';
# endif
	*p='\0';
	return(s);
}

static char *
copy(s) register char *s; {
	register char *old;

	old = savch; while ((*savch++ = *s++) != '\0');
	return(old);
}

static char *
strdex(s,c) char *s,c; {
	while (*s) if (*s++==c) return(--s);
	return(0);
}

int
yywrap() {
	return(1);
}

int
main(argc,argv)
	char *argv[];
	int  argc;
{
	register int i,c;
	register char *p;
	char *tf,**cp2;
	char *sysdir = NULL;

	fout = stdout;	/* Mac OS X is not POSIX compliant (stdout nonconst.) */

	p="_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	i=0;
	while ((c= *p++) != '\0') {
		(fastab+COFF)[c] |= IB|NB|SB;
		(toktyp+COFF)[c]=IDENT;
#if scw2
		/*
		 * 53 == 63-10; digits rarely appear in identifiers,
		 * and can never be the first char of an identifier.
		 * 11 == 53*53/sizeof(macbit) .
		 */
		++i; (t21+COFF)[c]=(53*i)/11; (t22+COFF)[c]=i%11;
#endif
	}
	p="0123456789.";
	while ((c = *p++) != '\0') {
		(fastab+COFF)[c] |= NB|SB;
		(toktyp+COFF)[c]=NUMBR;
	}
	p="\n\"'/\\";
	while ((c = *p++) != '\0')
		(fastab+COFF)[c] |= SB;
	p="\n\"'\\";
	while ((c = *p++) != '\0')
		(fastab+COFF)[c] |= QB;
	p="*\n";
	while ((c = *p++)!= '\0')
		(fastab+COFF)[c] |= CB;
	(fastab+COFF)[(int)warnc] |= WB;
	(fastab+COFF)['\0'] |= CB|QB|SB|WB;
	for (i=ALFSIZ; --i>=0; )
		slotab[i]=fastab[i]|SB;
	p=" \t\013\f\r";	/* note no \n; \v not legal for vertical tab? */
	while ((c = *p++) != '\0')
		(toktyp+COFF)[c]=BLANK;
#if scw2
	for ((t23+COFF)[i=ALFSIZ+7-COFF]=1; --i>=-COFF; )
		if (((t23+COFF)[i]=(t23+COFF+1)[i]<<1)==0)
			(t23+COFF)[i]=1;
#endif

# if unix
	fnames[ifno=0] = "";
	dirs[0]=dirnams[0]= ".";
# endif
# if ibm
	fnames[ifno=0] = "";
# endif
# if gimpel
	fnames[ifno=0] = (char *)inquire(stdin, _FILENAME);
	dirnams[0] = dirs[0] = trmdir(copy(fnames[0]));
# endif
	for (i=1; i<argc; i++) {
		switch(argv[i][0]) {
		case '-':
			switch(argv[i][1]) {
			case 'P':
				pflag++;
				continue;
			case 'E':
				continue;
			case 'R':
				++rflag;
				continue;
			case 'C':
				passcom++;
				continue;
			case 'D':
				if (predef>prespc+NPREDEF) {
					pperror("too many -D options, "
					    "ignoring %s", argv[i]);
					continue;
				}
				/* ignore plain "-D" (no argument) */
				if (*(argv[i]+2))
					*predef++ = argv[i]+2;
				continue;
			case 'U':
				if (prund>punspc+NPREDEF) {
					pperror("too many -U options, "
					    "ignoring %s", argv[i]);
					continue;
				}
				*prund++ = argv[i]+2;
				continue;
			case 'u':
				if (strcmp(argv[i], "-undef") == 0)
					nopredef = 1;
				else
					goto unknown;
				continue;
			case 'I':
				if (nd>=MAXIDIRS)
					pperror("excessive -I file "
					    "(%s) ignored", argv[i]);
				else
					dirs[nd++] = argv[i]+2;
				continue;
			case 'T':
				symlen = 8;
				/* Compatibility with V7 */
				continue;
			case 'H':
				/* Print included filenames */
				hflag++;
				continue;
			case 'Y':
				/* Replace system include dir */
				sysdir = argv[i]+2;
				continue;
			case '\0': continue;
			default:
			unknown:
				pperror("unknown flag %s", argv[i]);
				continue;
			}
		default:
			if (fin == STDIN_FILENO) {
				if (0>(fin=open(argv[i], O_RDONLY))) {
					pperror("No source file %s",
					    argv[i]);
					exit(8);
				}
				fnames[ifno]=copy(argv[i]);
				dirs[0]=dirnams[ifno]=trmdir(argv[i]);
/* too dangerous to have file name in same syntactic position
   be input or output file depending on file redirections,
   so force output to stdout, willy-nilly
	[i don't see what the problem is.  jfr]
*/
			} else if (fout==stdout) {
				static char _sobuff[BUFSIZ];
				if (NULL==(fout=fopen(argv[i], "w"))) {
					pperror("Can't create %s",
					    argv[i]);
					exit(8);
				} else {
					fclose(stdout);
					setbuf(fout,_sobuff);
				}
			} else {
				pperror("extraneous name %s", argv[i]);
			}
		}
	}

	fins[ifno]=fin;
	exfail = 0;
	/* after user -I files here are the standard include libraries */
	if (sysdir != NULL) {
		dirs[nd++] = sysdir;
	} else {
# if unix
	dirs[nd++] = "/usr/include";
# endif
# if gcos
	dirs[nd++] = "cc/include";
# endif
# if ibm
# ifndef gimpel
	dirs[nd++] = "BTL$CLIB";
# endif
# endif
# ifdef gimpel
	dirs[nd++] = intss() ?  "SYS3.C." : "" ;
# endif
	/* dirs[nd++] = "/compool"; */
	}
	dirs[nd++] = 0;
	defloc=ppsym("define");
	udfloc=ppsym("undef");
	incloc=ppsym("include");
	elsloc=ppsym("else");
	eifloc=ppsym("endif");
	elifloc=ppsym("elif");
	ifdloc=ppsym("ifdef");
	ifnloc=ppsym("ifndef");
	ifloc=ppsym("if");
	lneloc=ppsym("line");
	idtloc=ppsym("ident");
	pragmaloc=ppsym("pragma");
	errorloc=ppsym("error");
	for (i=sizeof(macbit)/sizeof(macbit[0]); --i>=0; )
		macbit[i]=0;

	if (! nopredef) {
# if unix
	ysysloc=stsym("unix");
# endif
# if gcos
	ysysloc=stsym ("gcos");
# endif
# if ibm
	ysysloc=stsym ("ibm");
# endif
# if pdp11
	varloc=stsym("pdp11");
# endif
# if vax
	varloc=stsym("vax");
# endif
# if interdata
	varloc=stsym ("interdata");
# endif
# if tss
	varloc=stsym ("tss");
# endif
# if os
	varloc=stsym ("os");
# endif
# if mert
	varloc=stsym ("mert");
# endif
# if sun
	varloc=stsym ("sun");
# endif
# if __NeXT__
	varloc=stsym ("__NeXT__");
# endif
# if __APPLE__
	varloc=stsym ("__APPLE__");
# endif
# if __MACH__
	varloc=stsym ("__MACH__");
# endif
# if sparc
	varloc=stsym ("sparc");
# endif
# if i386
	varloc=stsym ("i386");
# endif
# if __i386__
	varloc=stsym ("__i386__");
# endif
# if __amd64
	varloc=stsym ("__amd64");
# endif
# if __amd64__
	varloc=stsym ("__amd64__");
# endif
# if __x86_64
	varloc=stsym ("__x86_64");
# endif
# if __x86_64__
	varloc=stsym ("__x86_64__");
# endif
# if mc68000
	varloc=stsym ("mc68000");
# endif
# if __ppc__
	varloc=stsym ("__ppc__");
# endif
# if __ppc64__
	varloc=stsym ("__ppc64__");
# endif
# if __arm__
	varloc=stsym ("__arm__");
# endif
	}
	ulnloc=stsym ("__LINE__");
	uflloc=stsym ("__FILE__");
	varloc=stsym ("__BUILTIN_VA_ARG_INCR");

	tf=fnames[ifno]; fnames[ifno]="command line"; lineno[ifno]=1;
	cp2=prespc;
	while (cp2<predef) stsym(*cp2++);
	cp2=punspc;
	while (cp2<prund) {
		if ((p=strdex(*cp2, '=')) != NULL) *p++='\0';
		if (strlen(*cp2) > symlen)
			(*cp2)[symlen] = '\0';
		lookup(*cp2++, DROP);
	}
	fnames[ifno]=tf;
	pbeg=buffer+symlen; pbuf=pbeg+BUFFERSIZ; pend=pbuf+BUFFERSIZ;

	trulvl = 0; flslvl = 0;
	lineno[0] = 1; sayline(NOINCLUDE);
	outp=inp=pend;
	control(pend);
	return (exfail);
}
