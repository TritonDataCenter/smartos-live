/**
 * Syslog Addon for NodeJS.
 * (c) Copyright 2010 Thorcom Systems Ltd.  All Rights Reserved.
 *
 * Author:  Chris Dew
 * Website: http://www.thorcom.co.uk
 * Contact: cmsdew@gmail.com, http://github.com/chrisdew
 * Licence: MIT, BSD and GPLv2.
 */

#include <v8.h>
#include <node.h>
#include <syslog.h>
#include <malloc.h>
#include <string.h>

#define BUF_SIZE 512

using namespace v8;
using namespace node;

// Converts a V8 Utf8Value into a Cstring.
const char* ToCString(const v8::String::Utf8Value& val) {
	return *val ? *val : "<string conversion error>";
}

static Handle<Value>
openlogWrapped(const Arguments& args) {
	static char ident[BUF_SIZE];
	/*
	 * const v8::String::Utf8Value* vals can disappear at runtime.
	 * openlog does not copy the string it is given, instead it expects the
	 * address to be valid until the next call of openlog.
	 *
	 * To make this happen I have made a static declaration of ident.  The
	 * function makes a copy of the string, with which it is called, into
	 * the static buffer so that it is available for the life of the programme.
	 *
	 * In C you do not notice this problem, as the first argument is typically
	 * a string literal, which exists (at the same address) for the life of the
	 * programme.
	 */

	if ( args.Length() == 3
	  && args[0]->IsString()
	  && args[1]->IsInt32()
	  && args[2]->IsInt32()
	   ) {
		// this constructs a variable called 'str' from arg[0]
		String::Utf8Value str(args[0]->ToString());
		strncpy(ident, ToCString(str), BUF_SIZE);
		openlog( ident
			   , (int) args[1]->Int32Value()
			   , (int) args[2]->Int32Value()
			   ) ;
	} else {
		return ThrowException(Exception::Error(
				String::New("Invalid number and/or types of arguments")));
	}
	return Undefined();
}

/*
 * NOTE: this syslog does not accept printf style formatting.
 */
static Handle<Value>
syslogWrapped(const Arguments& args) {

	if ( args.Length() == 2
	  && args[0]->IsInt32()
	  && args[1]->IsString()
	   ) {
		// this constructs a variable called 'str' from arg[0]
		String::Utf8Value str(args[1]->ToString());
		syslog( (int) args[0]->Int32Value()
			  , "%s"
			  ,	ToCString(str)		// as openlog requires

			  ) ;
	} else {
		return ThrowException(Exception::Error(
				String::New("Invalid number and/or types of arguments")));
	}

	return Undefined();
}


static Handle<Value>
closelogWrapped(const Arguments& args) {

	closelog();
	return Undefined();
}


/**
 * This exists only as an example of returning a value from a function.
 */
static Handle<Value>
version(const Arguments& args) {
	HandleScope scope;
	return scope.Close(String::New("0.0.1"));
}

/*
 * Initialisation
 */
#define EXPORT_INT32(x) target->Set(String::New(#x), Int32::New(x));
extern "C" void
init (Handle<Object> target)
{
  HandleScope scope;
  //target->Set(String::New("version"), String::New("0.0.1"));

  NODE_SET_METHOD(target, "version", version);
  NODE_SET_METHOD(target, "openlog", openlogWrapped);
  NODE_SET_METHOD(target, "syslog", syslogWrapped);
  NODE_SET_METHOD(target, "closelog", closelogWrapped);

  // priorities
  EXPORT_INT32(LOG_EMERG);
  EXPORT_INT32(LOG_ALERT);
  EXPORT_INT32(LOG_CRIT);
  EXPORT_INT32(LOG_ERR);
  EXPORT_INT32(LOG_WARNING);
  EXPORT_INT32(LOG_NOTICE);
  EXPORT_INT32(LOG_INFO);
  EXPORT_INT32(LOG_DEBUG);

  EXPORT_INT32(LOG_PRIMASK);

  // facilities
  EXPORT_INT32(LOG_KERN);
  EXPORT_INT32(LOG_USER);
  EXPORT_INT32(LOG_MAIL);
  EXPORT_INT32(LOG_DAEMON);
  EXPORT_INT32(LOG_AUTH);
  EXPORT_INT32(LOG_SYSLOG);
  EXPORT_INT32(LOG_LPR);
  EXPORT_INT32(LOG_NEWS);
  EXPORT_INT32(LOG_UUCP);
  EXPORT_INT32(LOG_CRON);
  EXPORT_INT32(LOG_LOCAL0);
  EXPORT_INT32(LOG_LOCAL1);
  EXPORT_INT32(LOG_LOCAL2);
  EXPORT_INT32(LOG_LOCAL3);
  EXPORT_INT32(LOG_LOCAL4);
  EXPORT_INT32(LOG_LOCAL5);
  EXPORT_INT32(LOG_LOCAL6);
  EXPORT_INT32(LOG_LOCAL7);

  EXPORT_INT32(LOG_NFACILITIES);
  EXPORT_INT32(LOG_FACMASK);

  // options
  EXPORT_INT32(LOG_PID);
  EXPORT_INT32(LOG_CONS);
  EXPORT_INT32(LOG_ODELAY);
  EXPORT_INT32(LOG_NDELAY);
  EXPORT_INT32(LOG_NOWAIT);
}
