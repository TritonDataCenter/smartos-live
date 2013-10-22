/*
 * Copyright (c) 2012 Joyent, Inc.  All rights reserved.
 */

#include <sys/ccompile.h>
#include <stdlib.h>
#include <float.h>
#include <errno.h>
#include <libnvpair.h>
#include "example.h"

static nvlist_t *
example_set_impl(example_t *ep, nvpair_t *pp)
{
	double dv;
	const char *sv;
	const char *ev;
	uint64_t v;

	switch (v8plus_typeof(pp)) {
	case V8PLUS_TYPE_NUMBER:
		(void) nvpair_value_double(pp, &dv);
		if (dv > (1ULL << DBL_MANT_DIG) - 1) {
			return (v8plus_error(V8PLUSERR_IMPRECISE,
			    "large number lacks integer precision"));
		}
		ep->e_val = (uint64_t)dv;
		break;
	case V8PLUS_TYPE_STRING:
		(void) nvpair_value_string(pp, (char **)&sv);
		errno = 0;
		v = (uint64_t)strtoull(sv, (char **)&ev, 0);
		if (errno == ERANGE) {
			return (v8plus_error(V8PLUSERR_RANGE,
			    "value '%s' is out of range", sv));
		}
		if (ev != NULL && *ev != '\0') {
			return (v8plus_error(V8PLUSERR_MALFORMED,
			    "value '%s' is malformed", sv));
		}
		ep->e_val = v;
		break;
	case V8PLUS_TYPE_UNDEFINED:
		ep->e_val = 0;
		break;
	default:
		return (v8plus_error(V8PLUSERR_BADARG,
		    "argument 0 is of incorrect type %d", v8plus_typeof(pp)));
	}

	return (v8plus_void());
}

static nvlist_t *
example_ctor(const nvlist_t *ap, void **epp)
{
	nvpair_t *pp;
	example_t *ep;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA, V8PLUS_TYPE_NONE) != 0 &&
	    v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_ANY, &pp, V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	if ((ep = malloc(sizeof (example_t))) == NULL)
		return (v8plus_error(V8PLUSERR_NOMEM, NULL));

	(void) example_set_impl(ep, pp);
	if (_v8plus_errno != V8PLUSERR_NOERROR) {
		free(ep);
		return (NULL);
	}

	*epp = ep;

	return (v8plus_void());
}

static void
example_dtor(void *op)
{
	free(op);
}

static nvlist_t *
example_set(void *op, const nvlist_t *ap)
{
	nvpair_t *pp;
	example_t *ep = op;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_ANY, &pp,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	(void) example_set_impl(ep, pp);
	if (_v8plus_errno != V8PLUSERR_NOERROR)
		return (NULL);

	return (v8plus_void());
}

static nvlist_t *
example_add(void *op, const nvlist_t *ap)
{
	example_t *ep = op;
	example_t ae;
	nvpair_t *pp;
	nvlist_t *eap;
	nvlist_t *erp;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_ANY, &pp, V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	(void) example_set_impl(&ae, pp);
	if (_v8plus_errno != V8PLUSERR_NOERROR)
		return (NULL);

	ep->e_val += ae.e_val;

	eap = v8plus_obj(V8PLUS_TYPE_STRING, "0", "add", V8PLUS_TYPE_NONE);
	if (eap != NULL) {
		erp = v8plus_method_call(op, "__emit", eap);
		nvlist_free(eap);
		nvlist_free(erp);
	}

	return (v8plus_void());
}

static nvlist_t *
example_static_add(const nvlist_t *ap)
{
	example_t ae0, ae1;
	nvpair_t *pp0, *pp1;
	uint64_t rv;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_ANY, &pp0,
	    V8PLUS_TYPE_ANY, &pp1,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	(void) example_set_impl(&ae0, pp0);
	if (_v8plus_errno != V8PLUSERR_NOERROR)
		return (NULL);

	(void) example_set_impl(&ae1, pp1);
	if (_v8plus_errno != V8PLUSERR_NOERROR)
		return (NULL);

	rv = ae0.e_val + ae1.e_val;

	return (v8plus_obj(
	    V8PLUS_TYPE_STRNUMBER64, "res", rv,
	    V8PLUS_TYPE_NONE));
}

static nvlist_t *
example_multiply(void *op, const nvlist_t *ap)
{
	example_t *ep = op;
	example_t ae;
	nvpair_t *pp;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_ANY, &pp, V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	(void) example_set_impl(&ae, pp);
	if (_v8plus_errno != V8PLUSERR_NOERROR)
		return (NULL);

	ep->e_val *= ae.e_val;

	return (v8plus_void());
}

typedef struct async_multiply_ctx {
	example_t amc_operand;
	uint64_t amc_result;
	v8plus_jsfunc_t amc_cb;
} async_multiply_ctx_t;

static void *
async_multiply_worker(void *op, void *ctx)
{
	example_t *ep = op;
	async_multiply_ctx_t *cp = ctx;
	example_t *ap = &cp->amc_operand;

	cp->amc_result = ep->e_val * ap->e_val;

	return (NULL);
}

static void
async_multiply_done(void *op, void *ctx, void *res __UNUSED)
{
	async_multiply_ctx_t *cp = ctx;
	example_t *ep = op;
	nvlist_t *rp;
	nvlist_t *ap;

	ep->e_val = cp->amc_result;
	ap = v8plus_obj(V8PLUS_TYPE_NONE);
	if (ap != NULL) {
		rp = v8plus_call(cp->amc_cb, ap);
		nvlist_free(ap);
		nvlist_free(rp);
	}

	v8plus_jsfunc_rele(cp->amc_cb);
	free(cp);
}

static nvlist_t *
example_multiplyAsync(void *op, const nvlist_t *ap)
{
	nvpair_t *pp;
	v8plus_jsfunc_t cb;
	async_multiply_ctx_t *cp;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_ANY, &pp,
	    V8PLUS_TYPE_JSFUNC, &cb,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	if ((cp = malloc(sizeof (async_multiply_ctx_t))) == NULL)
		return (v8plus_error(V8PLUSERR_NOMEM, "no memory for context"));

	(void) example_set_impl(&cp->amc_operand, pp);
	if (_v8plus_errno != V8PLUSERR_NOERROR) {
		free(cp);
		return (NULL);
	}

	v8plus_jsfunc_hold(cb);
	cp->amc_cb = cb;

	v8plus_defer(op, cp, async_multiply_worker, async_multiply_done);

	return (v8plus_void());
}

static nvlist_t *
example_toString(void *op, const nvlist_t *ap)
{
	example_t *ep = op;
	nvpair_t *pp;

	/*
	 * Example of decorated exceptions.  Not strictly needed.
	 */
	if (v8plus_args(ap, 0,
	    V8PLUS_TYPE_ANY, &pp, V8PLUS_TYPE_NONE) == 0) {
		(void) v8plus_error(V8PLUSERR_EXTRAARG, NULL);
		return (v8plus_obj(
		    V8PLUS_TYPE_INL_OBJECT, "err",
			V8PLUS_TYPE_NUMBER, "example_argument", (double)0,
			V8PLUS_TYPE_NUMBER, "example_type",
			    (double)v8plus_typeof(pp),
			V8PLUS_TYPE_NONE,
		    V8PLUS_TYPE_NONE));
	}

	return (v8plus_obj(
	    V8PLUS_TYPE_STRNUMBER64, "res", (uint64_t)ep->e_val,
	    V8PLUS_TYPE_NONE));
}

static nvlist_t *
example_static_object(const nvlist_t *ap __UNUSED)
{
	return (v8plus_obj(
	    V8PLUS_TYPE_INL_OBJECT, "res",
		V8PLUS_TYPE_NUMBER, "fred", (double)555.5,
		V8PLUS_TYPE_STRING, "barney", "the sky is blue",
		V8PLUS_TYPE_INL_OBJECT, "betty",
		    V8PLUS_TYPE_STRING, "bert", "ernie",
		    V8PLUS_TYPE_BOOLEAN, "coffeescript_is_a_joke", B_TRUE,
		    V8PLUS_TYPE_NONE,
		V8PLUS_TYPE_NULL, "wilma",
		V8PLUS_TYPE_UNDEFINED, "pebbles",
		V8PLUS_TYPE_NUMBER, "bam-bam", (double)-32,
		V8PLUS_TYPE_STRNUMBER64, "dino", 0x1234567812345678ULL,
		V8PLUS_TYPE_NONE,
	    V8PLUS_TYPE_NONE));
}

/*
 * v8+ boilerplate
 */
const v8plus_c_ctor_f v8plus_ctor = example_ctor;
const v8plus_c_dtor_f v8plus_dtor = example_dtor;
const char *v8plus_js_factory_name = "create";
const char *v8plus_js_class_name = "Example";
const v8plus_method_descr_t v8plus_methods[] = {
	{
		md_name: "set",
		md_c_func: example_set
	},
	{
		md_name: "add",
		md_c_func: example_add
	},
	{
		md_name: "multiply",
		md_c_func: example_multiply
	},
	{
		md_name: "toString",
		md_c_func: example_toString
	},
	{
		md_name: "multiplyAsync",
		md_c_func: example_multiplyAsync
	}
};
const uint_t v8plus_method_count =
    sizeof (v8plus_methods) / sizeof (v8plus_methods[0]);

const v8plus_static_descr_t v8plus_static_methods[] = {
	{
		sd_name: "static_add",
		sd_c_func: example_static_add
	},
	{
		sd_name: "static_object",
		sd_c_func: example_static_object
	}
};
const uint_t v8plus_static_method_count =
    sizeof (v8plus_static_methods) / sizeof (v8plus_static_methods[0]);
