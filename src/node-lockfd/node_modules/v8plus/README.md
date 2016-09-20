# v8+: Node.js addon C++ to C boundary layer

This layer offers a way to write at least simple Node.js addons in C without
all the horrible C++ goop you'd otherwise be expected to use.  That goop
still exists, but you don't have to write it.  More importantly, you can
write your module in a sane programming environment, avoiding the confusing
and error-prone C++ semantics.

## Usage

Unlike most Node.js modules, v8+ does nothing by itself.  It is intended to
be used as a build-time dependency of your native addon, providing you with
an alternate programming environment.

For full docs, read the source code.

## Node.js Support

v8+ works with, and has been tested to some extent with, Node.js 0.6.18,
0.8.1, 0.8.26, 0.10.24, and 0.11.10.  It most likely works with other
micro versions in the 0.6 and 0.8 series as well; if you are using 0.10,
you will need 0.10.24 or later so that you have headers to build
against.  Note that this does not mean you can necessarily expect an
addon built against a particular minor release of Node.js to work with
any other minor release of Node.js.

Node 0.11.10 and later are also supported, and contain a new module API
that v8plus can leverage to provide an entirely new model for building
and using C modules.

## Building and Installing

The v8+ source code is compiled into your module directly along with your
code.  There is no separate v8+ library or node module, so the v8+ source,
tools, and makefiles are required to be present at the time your module is
built.  They are not required at runtime.

Normally, your addon module will depend on the v8plus package and install it
using npm.  The v8+ makefiles are set up to accommodate the installation of
v8+ anywhere `node(1)` would be able to find it using `require()` if it were
a normal JavaScript module, so simply including it as a dependency in your
`package.json` will work correctly.  In addition, you will need to create a
(normally trivial) makefile for your module that includes the makefiles
distributed as part of v8+.  Once you have done so, it is sufficient to run
`gmake` to generate the native loadable module used by Node.js.

The overall outline for creating a v8+ module looks something like this:

1. Write the C code that does whatever your module does.  Be sure to
\#include "v8plus_glue.h".  Do not include any other v8+ headers.

2. Create an appropriate `package.json` file.  See below for details.

3. Create a skeleton makefile.  See below for details.

You should not (and need not) modify either of the delivered makefiles;
override the definitions in Makefile.v8plus.defs in your makefile as
appropriate.

### Packaging Considerations

There are two essential properties your `package.json` must contain in order
to use v8+ with npm:

1. A dependency on `v8plus`.

2. An appropriate script entry for building your module.  It is strongly
   recommended that you use something like the following:

        "postinstall": "gmake $(eval echo ${MAKE_OVERRIDES})"

This will allow someone building your module to set make variables by adding
them to the `MAKE_OVERRIDES` environment variable; e.g.,

        $ MAKE_OVERRIDES="CTFCONVERT=/bin/true CTFMERGE=/bin/true" npm install

### Tying into the Makefiles

The makefiles shipped with v8+ do the great majority of the heavy lifting
for you.  A minimally functional makefile for your addon must contain four
things:

1. Variable definitions for `V8PLUS` and `PREFIX_NODE`.  Alternately, you
   may choose to provide these on the command line or via the environment.
   It is recommended that these assignments be made exactly as follows,
   which will cause the addon to be built against the `node` that is found
   first in your path:

        PREFIX_NODE := $(shell dirname `bash -c 'hash node; hash -t node'`)/..
        V8PLUS :=      $(shell $(PREFIX_NODE)/bin/node -e 'require("v8plus");')

   Note that the mechanism for finding `node` will not work correctly if
   yours is a symlink.  This invocation of node(1) uses a v8+ mechanism to
   locate v8+ sources anywhere that node(1) can find them and should not be
   modified unless you want to test an alternate v8+.

2. The exact line:

        include $(V8PLUS)/Makefile.v8plus.defs

3. Variable assignments specific to your module.  In particular, you must
   define `SRCS` and `MODULE`  Note that `ERRNO_JSON` is no longer required
   nor used in v8plus 0.3 and later.  Additional customisation is optional.

4. The exact line:

        include $(V8PLUS)/Makefile.v8plus.targ

Additional arbitrary customisation is possible using standard makefile
syntax; most things that are useful to change already have variables defined
in `Makefile.v8plus.defs` whose values you may append to or override.  For
example, you may cause additional system libraries to be linked in by
appending `-lname` to the `LIBS` variable.  By default, the makefiles assume
that your sources are located in the `src` subdirectory of your module, and
that you want the sole output of the build process to be called
`$(MODULE).node` and located in the `lib` subdirectory.  This can be changed
by overriding the `MODULE_DIR` variable.

A simple example makefile may be found in the `examples/` subdirectory, and
additional examples may be found in existing consumers; see Consumers below.
The GNU people also provide a good manual for make if you get really stuck;
see <http://www.gnu.org/software/make/manual/make.html>.  In general,
writing the necessary makefile fragment is expected to be as easy as or
easier than the equivalent task using `node-waf` or `node-gyp`, so if you're
finding it unexpectedly difficult or complicated there's probably an easier
way.

The makefiles follow GNU make syntax; other makes may not work but patches
that correct this are generally welcome (in particular, Sun make and GNU
make have different and incompatible ways to set a variable from the output
of a shell command, and there is no way I know to accommodate both).

### Binary Interface

By default, the resulting object is linked with the `-zdefs` option, which
will cause the build to fail if any unresolved symbols remain.  In order to
accommodate this, a mapfile specifying the available global symbols in your
`node` binary is automatically generated as part of the build process.  This
makes it much easier to debug missing libraries; otherwise, a module with
unresolved symbols will fail to load at runtime with no useful explanation.
Mapfile generation probably works only on illumos-derived systems.  Patches
that add support for other linkers are welcome.

Your module will have all symbols (other than `init`, which is used directly
by Node.js) reduced to local visibility, which is strongly recommended.  If
for some reason you want your module's symbols to be visible to Node.js or
to other modules, you will have to modify the script that generates the
mapfile.  See the `$(MAPFILE)` target in `Makefile.v8plus.targ`.

## API

Your module is an object factory that instantiates and returns native
objects, to which a fixed set of methods is attached as properties.  The
constructor, destructor, and methods all correspond 1-1 with C functions.
In addition, you may create additional class methods associated with the
native module itself, each of which will also have a 1-1 relationship to a
set of C functions.

This functionality is generally sufficient to interface with the system in
useful ways, but it is by no means exhaustive.  Architectural limitations
are noted throughout the documentation.

Subsequent sections describe the API in greater detail, along with most of
the C functions that v8+ provides.  Some utility functions may not be listed
here; see `v8plus_glue.h` for additional commentary and functions that are
available to you.

### Constructors, Methods, and Functions

The interface between your module and v8+ consists of a handful of objects
with fixed types and names.  These are:

	const v8plus_c_ctor_f v8plus_ctor = my_ctor;
	const v8plus_c_dtor_f v8plus_dtor = my_dtor;
	const char *v8plus_js_factory_name = "_new";
	const char *v8plus_js_class_name = "MyObjectBinding";
	const v8plus_method_descr_t v8plus_methods[] = {
	        {
	                md_name: "_my_method",
	                md_c_func: my_method
	        },
		...
	};
	const uint_t v8plus_method_count =
	    sizeof (v8plus_methods) / sizeof (v8plus_methods[0]);

	const v8plus_static_descr_t v8plus_static_methods[] = {
	        {
	                sd_name: "_my_function",
	                sd_c_func: my_function
	        },
		...
	};
	const uint_t v8plus_static_method_count =
	    sizeof (v8plus_static_methods) / sizeof (v8plus_static_methods[0]);

All of these must be present even if they have zero length or are NULL.  The
prototypes and semantics of each function type are as follows:

### nvlist_t *v8plus_c_ctor_f(const nvlist_t *ap, void **opp)

The constructor is responsible for creating the C object corresponding to
the native JavaScript object being created.  It is not a true constructor in
that you are actually an object factory; the C++ function associated with
the JavaScript constructor is called for you.  Your encoded arguments are in
`ap`.  Allocate and populate a C object, stuff it into `*opp`, and return
`v8plus_void()`.  If you need to throw an exception you can do so by
calling `v8plus_throw_exception()` or any of its wrappers.  As of v8plus
0.3, you may no longer return an nvlist with an `err` member to throw an
exception, and the `_v8plus_errno` global variable is no longer available.

### void v8plus_c_dtor_f(void *op)

Free the C object `op` and anything else associated with it.  Your object is
going away.  This function may be empty if the constructor did not allocate
any memory (i.e., `op` is not a pointer to dynamically allocated memory).

### nvlist_t *v8plus_c_method_f(void *op, const nvlist_t *ap)

When the JavaScript method is called in the context of your object, the
corresponding C function is invoked.  `op` is the C object associated with
the JavaScript object, and `ap` is the encoded list of arguments to the
function.  Return an encoded object with a `res` member, or use one of the
error/exception patterns.

### nvlist_t *v8plus_c_static_method_f(const nvlist_t *ap)

In addition to methods on the native objects returned by your constructor,
you can also provide a set of functions on the native binding object itself.
This may be useful for providing bindings to libraries for which no object
representation makes sense, or that have functions that operate outside the
context of any particular object.  Your arguments are once again encoded in
`ap`, and your return values are an object containing `res` or an error.

### Argument Handling

When JavaScript objects cross the boundary from C++ to C, they are converted
from v8 C++ objects into C nvlists.  This means that they are effectively
passed by value, unlike in JavaScript or in native addons written in C++.
The arguments to the JavaScript function are treated as an array and
marshalled into a single nvlist whose properties are named "0", "1", and so
on.  Each such property is encoded as follows:

- numbers and Number objects (regardless of size): double
- strings and String objects: UTF-8 encoded C string
- booleans and Boolean objects: boolean_value
- undefined: boolean
- null: byte, value 0
- Objects, including Arrays: nvlist with own properties as members and the
member ".__v8plus_type" set to the object's JavaScript type name.  Note
that the member name itself begins with a . to reduce the likelihood of a
collision with an actual JavaScript member name.
- JavaScript Functions are passed in a format suitable for use with
  `nvlist_lookup_jsfunc()` and `v8plus_args()` with the V8PLUS_TYPE_JSFUNC
  token.  This type is restricted; see below.

Because JavaScript arrays may be sparse, we cannot use the libnvpair array
types.  Consider them reserved for internal use.  JavaScript Arrays are
represented as they really are in JavaScript: objects with properties whose
names happen to be integers.

Other data types cannot be represented and will result in a TypeError
being thrown.  If your object has methods that need other argument types,
you cannot use v8+.

Side effects within the VM, including modification of the arguments, are
not supported.  If you need them, you cannot use v8+.

While the standard libnvpair functions may be used to inspect the arguments
to a method or function, v8+ also provides the `v8plus_args()` and
`v8plus_typeof()` convenience functions, which simplify checking the types
and obtaining the values of arguments.

### int v8plus_args(const nvlist_t *lp, uint_t flags, v8plus_type_t t, ...)

This function checks `lp` for the exact sequence of arguments specified by
the list of types provided in the parameter list.  If `V8PLUS_ARG_F_NOEXTRA`
is set in `flags`, the list of arguments must match exactly, with no
additional arguments.  The parameter list must be terminated by
`V8PLUS_TYPE_NONE`.

Following `flags` is a list of argument data types and, for most data types,
pointers to locations at which the native C value of that argument should be
stored.  The following JavaScript argument data types are supported; for
each, the parameter immediately following the data type parameter must be of
the indicated C type.  This parameter may be `NULL`, in which case the value
will not be stored anywhere.

- V8PLUS_TYPE_NONE: used to terminate the parameter list only
- V8PLUS_TYPE_STRING: char **
- V8PLUS_TYPE_NUMBER: double *
- V8PLUS_TYPE_BOOLEAN: boolean_t *
- V8PLUS_TYPE_JSFUNC: v8plus_jsfunc_t *
- V8PLUS_TYPE_OBJECT: nvlist_t **
- V8PLUS_TYPE_NULL: no parameter
- V8PLUS_TYPE_UNDEFINED: no parameter
- V8PLUS_TYPE_INVALID: data_type_t (see below)
- V8PLUS_TYPE_ANY: nvpair_t **
- V8PLUS_TYPE_STRNUMBER64: uint64_t *
- V8PLUS_TYPE_INL_OBJECT: illegal

In most cases, the behaviour is straightforward: the value pointer parameter
provides a location into which the C value of the specified argument should
be stored.  If the entire argument list matches the template, each
argument's C value is stored in its respective location.  If not, no values
are stored, in the return value locations, an exception is set pending, and
-1 is returned.

Three data types warrant further explanation: an argument of type
`V8PLUS_TYPE_INVALID` is any argument that may or may not match one of the
acceptable types.  Its nvpair data type tag is stored and the argument
treated as matching.  The value is ignored.  `V8PLUS_TYPE_STRNUMBER64` is
used with strings that should be interpreted as 64-bit unsigned integers.
If the argument is not a string, or is not parseable as a 64-bit unsigned
integer, the argument will be treated as a mismatch.  Finally,
`V8PLUS_TYPE_INL_OBJECT` is not supported with `v8plus_args()`; JavaScript
objects in the argument list must be individually inspected as nvlists.

A simple example:

	double_t d;
	boolean_t b;
	char *s;
	v8plus_jsfunc_t f;

	/*
	 * This function requires exactly four arguments: a number, a
	 * boolean, a string, and a callback function.  It is not acceptable
	 * to pass superfluous arguments to it.
	 */
	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_NUMBER, &d,
	    V8PLUS_TYPE_BOOLEAN, &b,
	    V8PLUS_TYPE_STRING, &s,
	    V8PLUS_TYPE_JSFUNC, &f,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

### v8plus_type_t v8plus_typeof(const nvpair_t *pp)

This function simply returns the v8+ data type corresponding to the
name/value pair `pp`.  If the value's type does not match the v8+ encoding
rules, `V8PLUS_TYPE_INVALID` is returned.  This function cannot fail and
does not set pending any exceptions.

### Returning Values

Similarly, when returning data across the boundary from C to C++, a
pointer to an nvlist must be returned.  This object will be decoded in
the same manner as described above and returned to the JavaScript caller
of your method.  Note that booleans, strings, and numbers will be encoded
as their primitive types, not objects.  If you need to return something
containing these object types, you cannot use v8+.  Other data types
cannot be represented.  If you need to return them, you cannot use v8+.

The nvlist being returned must have a single member named: "res", an nvpair
containing the result of the call to be returned.  The use of "err" to
decorate an exception is no longer supported as of v8plus 0.3.  You may
return a value of any decodable type.

For convenience, you may return v8plus_void() instead of an nvlist,
which indicates successful execution of a function that returns nothing.

In addition, the `v8plus_obj()` routine is available for instantiating
JavaScript objects to return.

### nvlist_t *v8plus_void(void)

This function clears any pending exception and returns NULL.  This is used
to indicate to internal v8+ code that the method or function should not
return a value.

### nvlist_t *v8plus_obj(v8plus_type_t t, ...)

This function creates and populates an nvlist conforming to the encoding
rules of v8+ for returning a value or creating an exception.  It can be used
to create anything from a single encoded value to arbitrarily nested
objects.  It is essentially the inverse of `v8plus_args()` above, with a few
differences:

- It cannot be used to encode invalid or illegal data types.
- It accepts native C values, not pointers to them.
- Each value must be named.
- It can be used to encode nested objects inline using
  `V8PLUS_TYPE_INL_OBJECT`, followed by type, name, value triples,
  terminated with `V8PLUS_TYPE_NONE`.

This function can fail due to out-of-memory conditions, invalid or
unsupported data types, or, most commonly, programmer error in casting the
arguments to the correct type.  *It is extremely important that data values,
particularly integers, be cast to the appropriate type (double) when passed
into this function!*

Following is a list of types and the C data types corresponding to their
values:

- V8PLUS_TYPE_NONE: used to terminate the parameter list only
- V8PLUS_TYPE_STRING: char *
- V8PLUS_TYPE_NUMBER: double
- V8PLUS_TYPE_BOOLEAN: boolean_t
- V8PLUS_TYPE_JSFUNC: v8plus_jsfunc_t
- V8PLUS_TYPE_OBJECT: nvlist_t *
- V8PLUS_TYPE_NULL: no parameter
- V8PLUS_TYPE_UNDEFINED: no parameter
- V8PLUS_TYPE_ANY: nvpair_t *
- V8PLUS_TYPE_STRNUMBER64: uint64_t
- V8PLUS_TYPE_INL_OBJECT: NONE-terminated type/value list

A simple example, in which we return a JavaScript object with two members,
one number and one embedded object with a 64-bit integer property.  Note
that if this function fails, we will return `NULL` with an exception
pending.

	int x;
	const char *s;

	...
	return (v8plus_obj(
	    V8PLUS_TYPE_INL_OBJECT, "res",
		V8PLUS_TYPE_NUMBER, "value", (double)x,
		V8PLUS_TYPE_INL_OBJECT, "detail",
		    V8PLUS_TYPE_STRNUMBER64, "value64", s,
		    V8PLUS_TYPE_NONE,
		V8PLUS_TYPE_NONE,
	    V8PLUS_TYPE_NONE));

The JSON representation of this object would be:

	{
		"res": {
			"value": <x>,
			"detail": {
				"value64": "<s>"
			}
		}
	}

### v8plus_obj_setprops(nvlist_t *lp, v8plus_type_t t, ...)

You can also add or replace the values of properties in an existing nvlist,
whether created using `nvlist_alloc()` directly or via `v8plus_obj()`.  The
effect is very similar to `nvlist_merge()`, where the second list is created
on the fly from your argument list.  The interpretation of the argument list
is the same as for `v8plus_obj()`, and the two functions are implemented
using the same logic.

## Exceptions and Errors

Prior to v8plus 0.3.0, the v8plus_errno_t enumerated type was controlled by
a consumer-supplied JSON file, allowing the consumer to specify the set of
error values.  In v8plus 0.3.0 and newer, this type is fixed and contains
only a small set of basic errors that can be used with the `v8plus_error()`
routine for compatibility with previous versions.  In v8plus 0.3.0 and
later, consumers should explicitly throw exceptions instead.

In v8plus 0.3.0 and later, the `_v8plus_errno` global no longer exists.  If
your code examined this variable, there are two alternatives:

- If you were comparing against V8PLUSERR_NOERROR, instead use
  `v8plus_exception_pending() to determine whether a previously invoked
  function failed.
- If you wish to inspect the previous error state,
  `v8plus_pending_exception()` will provide an nvlist-encoded representation
  of the pending exception object.

A survey of consumers indicated that custom error codes, `_v8plus_errno`,
and nontrivial uses of `_v8plus_error()` did not exist in consumers;
therefore this functionality has been removed.

All exceptions are generated and made pending by `v8plus_throw_exception()`
or its wrappers, identified below.  Only one exception may be pending at one
time, and a call to `v8plus_throw_exception()` or its wrappers with an
exception already pending has no effect.  Functions are provided for
clearing any pending exceptions, testing for the existence of a pending
exception, and obtaining (to inspect or modify) the current pending
exception; see API details below.

A pending exception will be ignored and will not be thrown if any of the
following occurs prior to your C function (method, static method, or
constructor) returning:

- `v8plus_clear_exception()` is invoked, or
- You return `v8plus_void()`, or
- Your method or static method routine returns non-NULL, or
- Your constructor sets its object pointer to a non-NULL value

It is programmer error for a constructor to set its object pointer to NULL
(or to not set it at all) and return without an exception pending.

Because a common source of exceptions is out-of-memory conditions, the space
used by exceptions is obtained statically and is limited in size.  This
allows for exceptions to be thrown into V8 reliably, with enough information
to debug the original failure even if that failure was, or was caused by, an
out of memory condition.  V8 may or may not provide a similar mechanism for
ensuring that the C++ representation of exceptions is reliable.

Exceptions may be raised in any context; however, raising an exception in a
context other than the V8 event thread will not by itself cause any
JavaScript exception to be thrown; it is the consumer's responsibility to
provide for an exception to be set pending in the event thread if it is to
be made visible from JavaScript.  Functions used to inspect or alter the
state of the pending exception, if any, also work in any context.

### nvlist_t *v8plus_error(v8plus_errno_t e, const char *fmt, ...)

This function generates and makes pending a default exception based on the
value of `e` and a message based on the formatted string `fmt` using the
argument list that follows.  The format string and arguments are interpreted
as by `vsnprintf(3c)`.  NULL is returned, suitable for returning directly
from a C function that provides a method if no exception decoration is
required.

If `fmt` is NULL, a generic default message is used.

This function is a wrapper for `v8plus_throw_exception()`.

### nvlist_t *v8plus_nverr(int err, const char *propname)

This function generates and makes pending an exception based on the system
error code `err` and sets the error message to a non-localised explanation
of the problem.  The string `propname`, if non-NULL, is indicated in the
message as the name of the nvlist property being manipulated when the error
occurred.  NULL is returned.

This function is a wrapper for `v8plus_throw_exception()`.

### nvlist_t *v8plus_syserr(int err, const char *fmt, ...)

Analogous to `v8plus_error()`, this function instead generates and sets
pending an exception derived from the system error code `err`.  Not all
error codes can be mapped; those that are not known are mapped onto an
unknown error string.  The generated exception will contain additional
properties similar to those provided by node.js's `ErrnoException()`
routine.  See also `v8plus_throw_errno_exception()`.

This function is a wrapper for `v8plus_throw_exception()`.

### nvlist_t *v8plus_throw_exception(const char *type, const char *msg, v8plus_type_t t, ...)

Generate and set pending an exception whose JavaScript type is `type`, with
message `msg` (or the empty string, if `msg` is NULL), and optionally
additional properties as specified by a series type, name, value triples.
These triples have the same syntax as the arguments to `v8plus_obj()` and
are likewise terminated by V8PLUS_TYPE_NONE.

The generated JavaScript exception will be thrown upon return from the
current constructor or method, unless `v8plus_clear_exception()` is invoked
first, or `v8plus_void()` is returned.  The exception may be obtained via
`v8plus_pending_exception()` and its presence or absence tested via
`v8plus_exception_pending()`.

### nvlist_t *v8plus_throw_errno_exception(int err, const char *syscall, const char *msg, const char *path, v8plus_type_t t, ...)

Generate and set pending an exception with type `Error` and message `msg`
(if `msg` is NULL, the message will be automatically generated from your
system's `strerror()` value for this error number).  The exception will
further be decorated with properties indicating the relevant system call and
path, if the `syscall` and `path` arguments, respectively, are non-NULL, and
any additional properties specified as in `v8plus_throw_exception()`.

This function is a wrapper for `v8plus_throw_exception()`.

### boolean_t v8plus_exception_pending(void)

This function returns B_TRUE if and only if an exception is pending.

### nvlist_t *v8plus_pending_exception(void)

This function returns a pointer to the nvlist-encoded pending exception, if
any exists; NULL, otherwise.  This object may be inspected and properties
added to or removed from it.

### void v8plus_clear_exception(void)

Clear the pending exception, if any.

### void v8plus_rethrow_pending_exception(void)

Immediately throw the pending exception.  This is appropriate only in
the context of an asynchronous callback, in which there is no return
value; in all other cases, return the exception as the `err` member of
the function's return value.  Note that this is slightly different from
`node::FatalException()` in that it is still possible for a JavaScript
caller to catch and handle it.  If it is absolutely essential that the
process terminate immediately, use `v8plus_panic()` instead.

The main purpose of this facility is to allow re-throwing an exception
generated by a JavaScript callback invoked from an asynchronous
completion routine.  The completion routine has no way to return a
value, so this is the only way to propagate the exception out of the
native completion routine.

This function may be called only on the main event loop thread.

### void v8plus_panic(const char *fmt, ...) __NORETURN

This function indicates a fatal runtime error.  The format string `fmt` and
subsequent arguments are interpreted as by `vsnprintf(3c)` and written to
standard error, which is then flushed.  `abort(3c)` or similar is then
invoked to terminate the Node.js process in which the addon is running.  Use
of this function should be limited to those circumstances in which an
internal inconsistency has been detected that renders further progress
hazardous to user data or impossible.

### Asynchrony

There are two main types of asynchrony supported by v8+.  The first is the
deferred work model (using `uv_queue_work()` or the deprecated
`eio_custom()` mechanisms) frequently written about and demonstrated by
various practitioners around the world.  In this model, your method or
function takes a callback argument and returns immediately after enqueuing a
task to run on one of the threads in the Node.js worker thread pool.  That
task consists of a C function to be run on the worker thread, which may not
use any V8 (or v8+) state, and a function to be run in the main event loop
thread when that task has completed.  The latter function is normally
expected to invoke the caller's original callback.  In v8+, this takes the
following form:

	void *
	async_worker(void *cop, void *ctxp)
	{
		my_object_t *op = cop;
		my_context_t *cp = ctxp;
		my_result_t *rp = ...;

		/*
		 * In thread pool context -- do not call any of the
		 * following functions:
		 * v8plus_obj_hold()
		 * v8plus_obj_rele_direct()
		 * v8plus_jsfunc_hold()
		 * v8plus_jsfunc_rele_direct()
		 * v8plus_call_direct()
		 * v8plus_method_call_direct()
		 * v8plus_defer()
		 *
		 * If you touch anything inside op, you may need locking to
		 * protect against functions called in the main thread.
		 */
		...

		return (rp);
	}

	void
	async_completion(void *cop, void *ctxp, void *resp)
	{
		my_object_t *op = cop;
		my_context_t *cp = ctxp;
		my_result_t *rp = resp;
		nvlist_t *cbap;
		nvlist_t *cbrp;

		...
		cbap = v8plus_obj(
		    V8PLUS_TYPE_WHATEVER, "0", rp->mr_value,
		    V8PLUS_TYPE_NONE);

		if (cbap != NULL) {
			cbrp = v8plus_call(cp->mc_callback, cbap);
			nvlist_free(cbap);
			nvlist_free(cbrp);
		}

		v8plus_jsfunc_rele(cp->mc_callback);
		free(cp);
		free(rp);
	}

	nvlist_t *
	async(void *cop, const nvlist_t *ap)
	{
		my_object_t *op = cop;
		v8plus_jsfunc_t cb;
		my_context_t *cp = malloc(sizeof (my_context_t));
		...
		if (v8plus_args(ap, 0, V8PLUS_TYPE_JSFUNC, &cb,
		    V8PLUS_TYPE_NONE) != 0) {
			free(cp);
			return (NULL);
		}

		v8plus_jsfunc_hold(cb);
		cp->mc_callback = cb;
		v8plus_defer(op, cp, async_worker, async_completion);

		return (v8plus_void());
	}

This mechanism uses `uv_queue_work()` and as such will tie up one of the
worker threads in the pool for as long as `async_worker` is running.

The other asynchronous mechanism is the Node.js `EventEmitter` model.  This
model requires some assistance from JavaScript code, because v8+ native
objects do not inherit from `EventEmitter`.  To make this work, you will
need to create a JavaScript object (the object your consumers actually use)
that inherits from `EventEmitter`, hang your native object off this object,
and populate the native object with an appropriate method that will cause
the JavaScript object to emit events when the native object invokes that
method.  A simple example might look like this:

	var util = require('util');
	var binding = require('./native_binding');
	var events = require('events');

	function
	MyObjectWrapper()
	{
		var self = this;

		events.EventEmitter.call(this);
		this._native = binding._create.apply(this,
		    Array.prototype.slice.call(arguments));
		this._native._emit = function () {
			var args = Array.prototype.slice.call(arguments);
			self.emit.apply(self, args);
		};
	}
	util.inherits(MyObjectWrapper, events.EventEmitter);

Then, in C code, you must arrange for libuv to call a C function in the
context of the main event loop.  The function `v8plus_method_call()` is safe
to call from any thread: depending on the context in which it is invoked, it
will either make the call directly or queue the call in the main event loop
and block on a reply.  Simply arrange to call back into your JavaScript
object when you wish to post an event:

	nvlist_t *eap;
	nvlist_t *erp;
	my_object_t *op = ...;
	...
	eap = v8plus_obj(
	    V8PLUS_TYPE_STRING, "0", "my_event",
	    ...,
	    V8PLUS_TYPE_NONE);

	if (eap != NULL) {
		erp = v8plus_method_call(op, "_emit", eap);
		nvlist_free(eap);
		nvlist_free(erp);
	}

This example will generate an event named "my_event" and propagate it to
listeners registered with the `MyObjectWrapper` instance.  If additional
arguments are associated with the event, they may be added to `eap` and will
also be passed along to listeners as arguments to their callbacks.

### void v8plus_obj_hold(const void *op)

Places a hold on the V8 representation of the specified C object.  This is
rarely necessary; `v8plus_defer()` performs this action for you, but other
asynchronous mechanisms may require it.  If you are returning from a method
call but have stashed a reference to the object somewhere and are not
calling `v8plus_defer()`, you must call this first.  Holds and releases must
be balanced.  Use of the object within a thread after releasing is a bug.
This hold includes an implicit event loop hold, as if `v8plus_eventloop_hold()`
was called.

### void v8plus_obj_rele(const void *op)

Releases a hold placed by `v8plus_obj_hold()`.  This function may be called
safely from any thread; releases from threads other than the main event loop
are non-blocking and will occur some time in the future.  Releases the
implicit event loop hold obtained by `v8plus_obj_hold()`.

### void v8plus_jsfunc_hold(v8plus_jsfunc_t f)

Places a hold on the V8 representation of the specified JavaScript function.
This is required when returning from a C function that has stashed a
reference to the function, typically to use it asynchronously as a callback.
All holds must be balanced with a release.  Because a single hold is placed
on such objects when passed to you in an argument list (and released for you
when you return), it is legal to reference and even to invoke such a
function without first placing an additional hold on it.  This hold includes
an implicit event loop hold, as if `v8plus_eventloop_hold()` was called.

### void v8plus_jsfunc_rele(v8plus_jsfunc_t f)

Releases a hold placed by `v8plus_jsfunc_hold()`.  This function may be called
safely from any thread; releases from threads other than the main event loop
thread are non-blocking and will occur some time in the future.  Releases
the implicit event loop hold obtained by `v8plus_jsfunc_hold()`.

### void v8plus_defer(void *op, void *ctx, worker, completion)

Enqueues work to be performed in the Node.js shared thread pool.  The object
`op` and context `ctx` are passed as arguments to `worker` executing in a
thread from that pool.  The same two arguments, along with the worker's
return value, are passed to `completion` executing in the main event loop
thread.  See example above.

### void v8plus_eventloop_hold(void)

Places a hold on the V8 event loop.  V8 will terminate when it detects that
there is no more work to do.  This liveliness check includes things like open
sockets or file descriptors, but only if they are tracked by the event loop
itself.  If you are using multiple threads, some of which may blocking waiting
for input (e.g. a message subscription thread) then you will need to prevent V8
from terminating prematurely.  This function must be called from within the
main event loop thread.  Each hold must be balanced with a release.  Note that
holds on objects or functions obtained via `v8plus_obj_hold()` or
`v8plus_jsfunc_hold()` will implicitly hold the event loop for you.

### void v8plus_eventloop_rele(void)

Release a hold on the V8 event loop.  If there are no more pending events or
input sources, then V8 will generally terminate the process shortly afterward.
This function may be called safely from any thread; releases from threads other
than the main event loop thread are non-blocking and will occur some time in
the future.

### nvlist_t *v8plus_call(v8plus_jsfunc_t f, const nvlist_t *ap)

Calls the JavaScript function referred to by `f` with encoded arguments
`ap`.  The return value is the encoded return value of the function.  The
argument and return value encoding match the encodings that are used by C
functions that provide methods.

As JavaScript functions must be called from the event loop thread,
`v8plus_call()` contains logic to determine whether we are in the
correct context or not.  If we are running on some other thread we will
queue the request and sleep, waiting for the event loop thread to make the
call.  In the simple case, where we are already in the correct thread, we
make the call directly.

Note that when passing JavaScript functions around as callbacks, you must use
first use `v8plus_jsfunc_hold()` from within the main event loop thread.  Once
finished with the function, you may pass it to `v8plus_jsfunc_rele()` from any
thread to clean up.

### nvlist_t *v8plus_method_call(void *op, const char *name, const nvlist_t *ap)

Calls the method named by `name` in the native object `op` with encoded
argument list `ap`.  The method must exist and must be a JavaScript
function.  Such functions may be attached by JavaScript code as in the event
emitter example above.  The effects of using this function to call a native
method are undefined.

When called from threads other than the main event loop thread,
`v8plus_method_call()` uses the same queue-and-block logic as described above
in `v8plus_call()`.

## FAQ

- Why?

Because C++ is garbage.  Writing good software is challenging enough without
trying to understand a bunch of implicit side effects or typing templated
identifiers that can't fit in 80 columns without falling afoul of the
language's ambiguous grammar.  Don't get me started.

- Why not use [FFI](https://github.com/rbranson/node-ffi)?

FFI is really cool; it offers us the ability to use C libraries without
writing bindings at all.  However, it also exposes a lot of C nastiness to
JavaScript code, essentially placing the interface boundary in consuming
code itself.  This pretty much breaks the JavaScript interface model --
for example, you can't really have a function that inspects the types of its
arguments -- and requires you to write an additional C library anyway if you
want or need to do something natively that's not quite what the C library
already does.  Of course, one could use it to write "bindings" in JavaScript
that actually look like a JavaScript interface, which may end up being the
best answer, especially if those are autogenerated from CTF!  In short, v8+
and FFI are different approaches to the problem.  Use whichever fits your
need, and note that they're not mutually exclusive, either.

- What systems can I use this on?

[illumos](http://illumos.org) distributions, or possibly other platforms
with a working libnvpair.  I'm sorry if your system doesn't have it; it's
open source and pretty easy to port.

There is an OSX port; see [the ZFS port's
implementation](http://code.google.com/p/maczfs/source/browse/#git%2Fusr%2Fsrc%2Flib%2Flibnvpair).
Unfortunately this port lacks the requisite support for floating-point data
(DATA_TYPE_DOUBLE) but you could easily add that from the illumos sources.

- What about node-waf and node-gyp?

Fuck python, fuck WAF, and fuck all the hipster douchebags for whom make is
too hard, too old, or "too Unixy".  Make is simple, easy to use, and
extremely reliable.  It was building big, important pieces of software when
your parents were young, and it Just Works.  If you don't like using make
here, you probably don't want to use v8+ either, so just go away.  Write
your CoffeeScript VM in something else, and gyp-scons-waf-rake your way to
an Instagram retirement in Bali with all your hipster douchebag friends.
Just don't bother me about it, because I don't care.

- Why is Node failing in dlopen()?

Most likely, your module has a typo or needs to be linked with a library.
Normally, shared objects like Node addons should be linked with -zdefs so that
these problems are found at build time, but Node doesn't deliver a mapfile
specifying its API so you're left with a bunch of undefined symbols you just
have to hope are defined somewhere in your node process's address space.  If
they aren't, you're boned.  LD_DEBUG=all will help you find the missing
symbol(s).

As of 0.0.2, v8+ builds a mapfile for your node binary at the time you build
your addon.  It does not attempt to restrict the visibility of any symbols,
so you will not be warned if your addon is using private or deprecated
functionality in V8 or Node.js.  Your build will, however, fail if you've
neglected to link in any required libraries, typo'd a symbol name, etc.

- Why can't I see my exception's decorative properties in JavaScript?

Be careful when decorating exceptions.  There are several built-in hidden
properties; if you decorate the exception with a property with the same
name, you will change the hidden property's value but it will still be
hidden.  This almost certainly is not what you want, so you should prefix
the decorative property names with something unique to your module to avoid
stepping on V8's (or JavaScript's) property namespace.

- What if the factory model doesn't work for me?

See "License" below.  Note also that one can export plain functions as well.

- Why do I always die with "invalid property type -3621" (or other garbage)?

You are passing an object with the wrong C type to `v8plus_obj()`.  Like
all varargs functions, it cannot tell the correct size or type of the
objects you have passed it; they must match the preceding type argument or
it will not work correctly.  In this particular case, you've most likely
done something like:

	int foo = 0xdead;

	v8plus_obj(V8PLUS_TYPE_NUMBER, "foo", foo, V8PLUS_TYPE_NONE);

An 'int' is 4 bytes in size, and the compiler reserves 4 bytes on the stack
and sticks the value of foo there.  When `v8plus_obj` goes to read it, it
sees that the type is V8PLUS_TYPE_NUMBER, casts the address of the next
argument slot to a `double *`, and dereferences it, then moves the argument
list pointer ahead by the size of a double.  Unfortunately, a double
is usually 8 bytes long, meaning that (a) the value of the property is going
to be comprised of the integer-encoded foo appended to the next data type,
and (b) the next data type is going to be read from either undefined memory
or from part of the address of the name of the next property.  To cure this,
always make sure that you cast your integral arguments properly when using
V8PLUS_TYPE_NUMBER:

	v8plus_obj(V8PLUS_TYPE_NUMBER, "foo", (double)foo, V8PLUS_TYPE_NONE);

## License

MIT.

## Bugs

See <https://github.com/joyent/v8plus/issues>.

## Consumers

This is an incomplete list of native addons known to be using v8+.  If your
addon uses v8+, please let me know and I will include it here.

- <https://github.com/joyent/node-contract>
