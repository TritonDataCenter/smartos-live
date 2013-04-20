/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm: firewall rule parser grammar
 */

%lex

digit                   [0-9]
esc                     "\\"
t                       {digit}{1,3}

%%

\s+                     /* skip whitespace */
<<EOF>>                 return 'EOF';

"FROM"                  return 'FROM';
"from"                  return 'FROM';
"TO"                    return 'TO';
"to"                    return 'TO';

"IP"                    return 'IP';
"ip"                    return 'IP';
"SUBNET"                return 'SUBNET';
"subnet"                return 'SUBNET';
"ANY"                   return 'ANY';
"any"                   return 'ANY';
"ALL"                   return 'ALL';
"all"                   return 'ALL';
"TAG"                   return 'TAG';
"tag"                   return 'TAG';
"VM"                    return 'VM';
"vm"                    return 'VM';
"VMS"                   return 'VMS';
"vms"                   return 'VMS';

'='                     return '=';
'('                     return '(';
')'                     return ')';
"OR"                    return 'OR';
"or"                    return 'OR';
"AND"                   return 'AND';
"and"                   return 'AND';

"BLOCK"                 return 'BLOCK';
"block"                 return 'BLOCK';
"ALLOW"                 return 'ALLOW';
"allow"                 return 'ALLOW';
"PORT"                  return 'PORT';
"port"                  return 'PORT';
"TCP"                   return 'TCP';
"tcp"                   return 'TCP';
"UDP"                   return 'UDP';
"udp"                   return 'UDP';
"ICMP"                  return 'ICMP';
"icmp"                  return 'ICMP';
"TYPE"                  return 'TYPE';
"type"                  return 'TYPE';
"CODE"                  return 'CODE';
"code"                  return 'CODE';

\"(?:{esc}["bfnrt/{esc}]|{esc}"u"[a-fA-F0-9]{4}|[^"{esc}])*\"  yytext = yytext.substr(1,yyleng-2); return 'STRING';
{t}'.'{t}'.'{t}'.'{t}   return 'IPADDR';
'/'{digit}{digit}       return 'CIDRSUFFIX'

[-a-zA-Z0-9_]+          return 'WORD'

/lex

%%      /* Language grammar */

start
    : FROM target_list TO target_list action protocol EOF
        { return { 'from': $2, 'to': $4, 'action': $5, 'protocol': $6 }; }
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
    : ALL VMS
        { $$ = [ ['wildcard', 'vmall'] ]; }
    | '(' ALL VMS ')'
        { $$ = [ ['wildcard', 'vmall'] ]; }
    ;

any
    : ANY
        { $$ = [ ['wildcard', 'any'] ]; }
    | '(' ANY ')'
        { $$ = [ ['wildcard', 'any'] ]; }
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
    : VM uuid
        { $$ = [ ['vm', $2] ]; }
    ;

uuid
    : WORD
        { yy.validateUUID($1);
          $$ = $1; }
    ;

tag
    : TAG tag_string
        { $$ = [ ['tag', $2] ]; }
    | TAG tag_string '=' tag_string
        { $$ = [ ['tag', [ $2, $4 ] ] ]; }
    ;

tag_string
    : STRING
        { $$ = yytext; }
    | WORD
        { $$ = $1; }
    ;

action
    : BLOCK
        { $$ = $1.toLowerCase() }
    | ALLOW
        { $$ = $1.toLowerCase() }
    ;


protocol
    : TCP port_list
        { $$ = { 'name': $1.toLowerCase(), 'targets': $2 } }
    | UDP port_list
        { $$ = { 'name': $1.toLowerCase(), 'targets': $2 } }
    | ICMP type_list
        { $$ = { 'name': $1.toLowerCase(), 'targets': $2 } }
    ;


/* TCP / UDP port list */
port_list
    : '(' port_and_list ')'
        { $$ = $2; }
    | port
    | '(' port_all ')'
    | port_all
    ;

port_and_list
    : port
    | port_and_list AND port
        { $$ = $1.concat(Number($3)); }
    ;

port
    : PORT portnumber
        { $$ = [ $2 ]; }
    ;

port_all
    : PORT ALL
        { $$ = [ $2.toLowerCase() ]; }
    ;

portnumber
    : WORD
        { yy.validatePortNumber($1);
          $$ = Number($1); }
    ;

type_list
    : '(' type_and_list ')'
        { $$ = $2; }
    | type
    ;

type_and_list
    : type
    | type_and_list AND type
        { $$ = $1.concat($3); }
    ;

type
    : TYPE icmptype CODE icmpcode
        { $$ = [ $2 + ':' + $4 ]; }
    | TYPE icmptype
        { $$ = [ $2 ]; }
    ;

icmptype
    : WORD
        { yy.validateICMPtype($1);
          $$ = Number($1); }
    ;

icmpcode
    : WORD
        { yy.validateICMPcode($1);
          $$ = Number($1); }
    ;
