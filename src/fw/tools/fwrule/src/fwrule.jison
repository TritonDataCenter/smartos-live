/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm: firewall rule parser grammar
 */

%lex

digit                   [0-9]
t                       {digit}{1,3}
T                       [-a-zA-Z0-9_]
H                       [a-f0-9]

%%
\s+                     /* skip whitespace */
<<EOF>>                 return 'EOF';

[Ff][Rr][Oo][Mm]        return 'FROM';
[Tt][Oo]                return 'TO';

"ip"                    return 'IP';
"subnet"                return 'SUBNET';
"any"                   return 'ANY';
"all"                   return 'ALL';
"tag"                   return 'TAG';
[Vv][Mm]                return 'VM';

'('                     return '(';
')'                     return ')';
[Oo][Rr]                return 'OR';
[Aa][Nn][Dd]            return 'AND';

[Bb][Ll][Oo][Cc][Kk]    return 'BLOCK';
[Aa][Ll][Ll][Oo][Ww]    return 'ALLOW';
[Pp][Oo][Rr][Tt]        return 'PORT';
[Tt][Cc][Pp]            return 'TCP';
[Uu][Dd][Pp]            return 'UDP';

{t}'.'{t}'.'{t}'.'{t}   return 'IPADDR';
'/'{digit}{digit}       return 'CIDRSUFFIX'

{T}+                    { return yy.tagOrPortOrUUID(this); }

/lex

%%      /* Language grammar */

start
    : FROM target_list TO target_list action protocol port_list EOF
        { return { 'from': $2, 'to': $4, 'action': $5, 'protocol': $6, ports: $7 }; }
    ;


/* List of targets for 'FROM' and 'TO' */
target_list
    : any
    | all
    | '(' target_or_list ')'
        {$$ = $2;}
    | target
    ;

target_or_list
    : target
    | target_or_list 'OR' target
        { $$ = $1.concat($3); }
    ;

target
    : ip
    | subnet
    | tag
    | vm
    ;


/* Targets for 'FROM' and 'TO' */
all
    : ALL
        { $$ = [ ['wildcard', $1] ]; }
    | '(' ALL ')'
        { $$ = [ ['wildcard', $2] ]; }
    ;

any
    : ANY
        { $$ = [ ['wildcard', $1] ]; }
    | '(' ANY ')'
        { $$ = [ ['wildcard', $2] ]; }
    ;

ip
    : IP IPADDR
        { yy.validateIPv4address($2);
          $$ = [ ['ip', $2] ]; }
    ;

subnet
    : SUBNET IPADDR CIDRSUFFIX
        { yy.validateIPv4subnet($2 + $3);
            $$ = [ ['subnet', $2 + $3] ]; }
    ;

vm
    : VM UUID
        { $$ = [ ['vm', $2] ]; }
    ;

tag
    : TAG TAGTXT
        { $$ = [ ['tag', $2] ]; }
    ;


action
    : BLOCK
        { $$ = $1.toLowerCase() }
    | ALLOW
        { $$ = $1.toLowerCase() }
    ;


protocol
    : TCP
        { $$ = $1.toLowerCase() }
    | UDP
        { $$ = $1.toLowerCase() }
    ;


port_list
    : '(' port_and_list ')'
        {$$ = $2;}
    | port
    ;

port_and_list
    : port
    | port_and_list 'AND' port
        { $$ = $1.concat(Number($3)); }
    ;

port
    : PORT PORTNUM
        { $$ = [ Number($2) ]; }
    ;

