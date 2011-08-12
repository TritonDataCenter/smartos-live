%{
/*
 * This implementation is based on the UNIX 32V release from 1978
 * with permission from Caldera Inc.
 *
 * Copyright (c) 2011 Joyent, Inc. All rights reserved.
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
#include "cpp.h"
%}
%term number stop DEFINED
%term EQ NE LE GE LS RS
%term ANDAND OROR
%left ','
%right '='
%right '?' ':'
%left OROR
%left ANDAND
%left '|' '^'
%left '&'
%binary EQ NE
%binary '<' '>' LE GE
%left LS RS
%left '+' '-'
%left '*' '/' '%'
%right '!' '~' UMINUS
%left '(' '.'
%%
S:	e stop	{return($1);}


e:	  e '*' e
		{$$ = $1 * $3;}
	| e '/' e
		{$$ = $1 / $3;}
	| e '%' e
		{$$ = $1 % $3;}
	| e '+' e
		{$$ = $1 + $3;}
	| e '-' e
		{$$ = $1 - $3;}
	| e LS e
		{$$ = $1 << $3;}
	| e RS e
		{$$ = $1 >> $3;}
	| e '<' e
		{$$ = $1 < $3;}
	| e '>' e
		{$$ = $1 > $3;}
	| e LE e
		{$$ = $1 <= $3;}
	| e GE e
		{$$ = $1 >= $3;}
	| e EQ e
		{$$ = $1 == $3;}
	| e NE e
		{$$ = $1 != $3;}
	| e '&' e
		{$$ = $1 & $3;}
	| e '^' e
		{$$ = $1 ^ $3;}
	| e '|' e
		{$$ = $1 | $3;}
	| e ANDAND e
		{$$ = $1 && $3;}
	| e OROR e
		{$$ = $1 || $3;}
	| e '?' e ':' e
		{$$ = $1 ? $3 : $5;}
	| e ',' e
		{$$ = $3;}
	| term
		{$$ = $1;}
term:
	  '-' term %prec UMINUS
		{$$ = -$2;}
	| '!' term
		{$$ = !$2;}
	| '~' term
		{$$ = ~$2;}
	| '(' e ')'
		{$$ = $2;}
	| DEFINED '(' number ')'
		{$$= $3;}
	| DEFINED number
		{$$ = $2;}
	| number
		{$$= $1;}
%%
# include "yylex.c"
