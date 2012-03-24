/* vim: ts=4 sw=4 expandtab
 */
#include <Python.h>

#include <js_operating_system.h>

#include <jsatom.h>
#include <jsapi.h>
#include <jscntxt.h>
#include <jsdbgapi.h>
#include <jsfun.h>
#include <jsinterp.h>
#include <jsparse.h>
#include <jsscan.h>
#include <jsscope.h>
#include <jsstr.h>

#include "nodepos.h"

#define ARRAY_COUNT(a) (sizeof(a) / sizeof(a[0]))

/** CONSTANTS
 */
static const char* tokens[] = {
    #define TOKEN(name) #name,
    #include "tokens.tbl"
    #undef TOKEN
};
JS_STATIC_ASSERT(ARRAY_COUNT(tokens) == TOK_LIMIT);

static const char* opcodes[] = {
    #define OPDEF(op,val,name,token,length,nuses,ndefs,prec,format) #op,
    #include <jsopcode.tbl>
    #undef OPDEF
};
JS_STATIC_ASSERT(ARRAY_COUNT(opcodes) == JSOP_LIMIT);

static const char *error_names[] = {
    #define MSG_DEF(name, number, count, exception, format) #name,
    #include <js.msg>
    #undef MSG_DEF
};
JS_STATIC_ASSERT(ARRAY_COUNT(error_names) == JSErr_Limit);

/* Use different numeric ranges to avoid accidental confusion. */
#define TOK_TO_NUM(tok) (tok+1000)
#define OPCODE_TO_NUM(op) (op+2000)

static jschar*
tojschar(const char* buf) {
    return (jschar*)buf;
}

static int
tojscharlen(int buflen) {
    /* The buffer length shouldn't be an odd number, buf if it is, the buffer
       will be truncated to exclude it.
     */
    JS_STATIC_ASSERT(sizeof(char) == 1);
    JS_STATIC_ASSERT(sizeof(jschar) == 2);
    return buflen / 2;
}

/** MODULE INITIALIZATION
 */

static PyObject*
module_parse(PyObject *self, PyObject *args);

static PyObject*
is_compilable_unit(PyObject *self, PyObject *args);

static PyObject*
is_valid_version(PyObject *self, PyObject *args);

static PyMethodDef module_methods[] = {
     {"parse", module_parse, METH_VARARGS,
      "Parses \"script\" and returns a tree of \"node_class\"."},

     {"is_compilable_unit", is_compilable_unit, METH_VARARGS,
        "Returns True if \"script\" is a compilable unit."},

     {"is_valid_version", is_valid_version, METH_VARARGS,
        "Returns True if \"strversion\" is a valid version."},

     {NULL, NULL, 0, NULL}        /* Sentinel */
};

PyMODINIT_FUNC
initpyspidermonkey(void) {
    PyObject* module;
    PyObject* class;
    PyObject* tok;
    PyObject* op;
    int i;

    module = Py_InitModule("pyspidermonkey", module_methods);
    if (!module)
        return;

    class = PyClass_New(NULL, PyDict_New(), PyString_FromString("spidermonkey_constants"));
    if (!class)
        return;

    /* set up tokens */
    tok = PyInstance_New(class, NULL, NULL);
    if (!tok)
        return;
    if (PyObject_SetAttrString(module, "tok", tok) == -1)
        return;
    for (i = 0; i < ARRAY_COUNT(tokens); i++) {
        if (PyObject_SetAttrString(tok, tokens[i], PyLong_FromLong(TOK_TO_NUM(i))) == -1)
            return;
    }

    /* set up opcodes */
    op = PyInstance_New(class, NULL, NULL);
    if (!op)
        return;
    if (PyObject_SetAttrString(module, "op", op) == -1)
        return;
    for (i = 0; i < ARRAY_COUNT(opcodes); i++) {
        /* yank off the JSOP prefix */
        const char* opcode = opcodes[i];
        if (strlen(opcode) > 5)
            opcode += 5;
        if (PyObject_SetAttrString(op, opcode, PyLong_FromLong(OPCODE_TO_NUM(i))) == -1)
            return;
    }

    RegisterNodePosType(module);
}

PyMODINIT_FUNC
initpyspidermonkey_d(void) {
    initpyspidermonkey();
}


/** MODULE IMPLEMENTATION
 */

typedef struct JSContextData {
    PyObject* node_class;
    PyObject* error_callback;
    long int first_lineno;
    long int first_index;
} JSContextData;

static long int
to_pyjsl_lineno(JSContextData* data, long int lineno) {
    /* SpiderMonkey uses 1-based line numbers. */
    return lineno + data->first_lineno - 1;
}

static long int
to_pyjsl_index(JSContextData* data, long int lineno, long int index) {
    /* SpiderMonkey uses 1-based line numbers. */
    if (lineno - 1 == 0)
        return index + data->first_index;
    else
        return index;
}

static JSTokenPtr
to_pyjsl_pos(JSContextData* data, JSTokenPtr ptr) {
    JSTokenPtr newptr = ptr;
    newptr.index = to_pyjsl_index(data, ptr.lineno, ptr.index);
    newptr.lineno = to_pyjsl_lineno(data, ptr.lineno);
    return newptr;
}

static void
error_reporter(JSContext* cx, const char* message, JSErrorReport* report)
{
    JSContextData* data = JS_GetContextPrivate(cx);
    long int line = to_pyjsl_lineno(data, report->lineno);
    long int col = -1;

    if (report->uclinebuf) {
        col = report->uctokenptr - report->uclinebuf;
        col = to_pyjsl_index(data, report->lineno, col);
    }

    // TODO: Check return value
    (void)PyObject_CallFunction(data->error_callback, "lls",
        line, col, error_names[report->errorNumber]);
}

static PyObject*
jsstring_to_py(JSString* jsstr) {
    PyObject* pystr;
    size_t i;

    pystr = PyUnicode_FromUnicode(NULL, jsstr->length);
    if (pystr) {
        for (i = 0; i < jsstr->length; i++)
            PyUnicode_AS_UNICODE(pystr)[i] = jsstr->chars[i];
    }

    return pystr;
}

static PyObject*
atom_to_string(JSAtom* atom) {
    if (!ATOM_IS_STRING(atom))
        return NULL;

    return jsstring_to_py(ATOM_TO_STRING(atom));
}

/* returns 0 on success and -1 on failure */
static PyObject*
jsnode_to_pynode(JSContext* context, JSParseNode* jsnode) {
    JSContextData* data = JS_GetContextPrivate(context);
    PyObject* pynode = NULL;
    PyObject* kids = NULL;
    JSTokenPtr tokenptr;

    /* TODO: make sure no tuple item already exists */

    if (!jsnode) {
        Py_INCREF(Py_None);
        return Py_None;
    }

    /* pass in a dictionary of options */
    pynode = PyInstance_New(data->node_class, NULL, NULL);
    if (!pynode)
        goto fail;

    Py_INCREF(Py_None);
    if (PyObject_SetAttrString(pynode, "parent", Py_None) == -1)
        goto fail;
    Py_INCREF(Py_None);
    if (PyObject_SetAttrString(pynode, "node_index", Py_None) == -1)
        goto fail;
    if (PyObject_SetAttrString(pynode, "kind", Py_BuildValue("i", TOK_TO_NUM(jsnode->pn_type))) == -1)
        goto fail;

    /* pass the position */
    tokenptr = to_pyjsl_pos(data, jsnode->pn_pos.begin);
    if (PyObject_SetAttrString(pynode, "_start_line", Py_BuildValue("i", tokenptr.lineno)) == -1)
        goto fail;
    if (PyObject_SetAttrString(pynode, "_start_col", Py_BuildValue("i", tokenptr.index)) == -1)
        goto fail;
    tokenptr = to_pyjsl_pos(data, jsnode->pn_pos.end);
    if (PyObject_SetAttrString(pynode, "_end_line", Py_BuildValue("i", tokenptr.lineno)) == -1)
        goto fail;
    if (PyObject_SetAttrString(pynode, "_end_col", Py_BuildValue("i", tokenptr.index)) == -1)
        goto fail;

    if ((jsnode->pn_type == TOK_NAME || jsnode->pn_type == TOK_DOT ||
        jsnode->pn_type == TOK_STRING) && ATOM_IS_STRING(jsnode->pn_atom)) {
        /* Convert the atom to a string. */
        if (PyObject_SetAttrString(pynode, "atom", atom_to_string(jsnode->pn_atom)) == -1)
            goto fail;
    }

    if (PyObject_SetAttrString(pynode, "opcode", Py_BuildValue("i", OPCODE_TO_NUM(jsnode->pn_op))) == -1)
        goto fail;

    if (jsnode->pn_type == TOK_NUMBER) {
        if (PyObject_SetAttrString(pynode, "dval", Py_BuildValue("d", jsnode->pn_dval)) == -1)
            goto fail;
    }

    if (jsnode->pn_type == TOK_FUNCTION) {
        JSObject* object = ATOM_TO_OBJECT(jsnode->pn_funAtom);
        JSFunction* function = (JSFunction *) JS_GetPrivate(context, object);
        JSScope* scope = OBJ_SCOPE(object);
        JSScopeProperty* scope_property;
        PyObject* fn_name;
        PyObject* fn_args;
        uint32 i;
        JSPropertyDescArray props = {0, NULL};

        /* get the function name */
        if (function->atom) {
            fn_name = atom_to_string(function->atom);
        }
        else {
            Py_INCREF(Py_None);
            fn_name = Py_None;
        }
        if (PyObject_SetAttrString(pynode, "fn_name", fn_name) == -1)
            goto fail;

        /* get the function arguments */
        if (!JS_GetPropertyDescArray(context, object, &props))
            props.length = 0;

        fn_args = PyTuple_New(function->nargs);
        for (i = 0; i < props.length; i++) {
            PyObject* name;
            if ((props.array[i].flags & JSPD_ARGUMENT) == 0)
                continue;
            name = jsstring_to_py(JSVAL_TO_STRING(props.array[i].id));
            PyTuple_SET_ITEM(fn_args, props.array[i].slot, name);
        }

        /* Duplicate parameters are not included in the desc array. Go back and add them in. */
        for (scope_property = SCOPE_LAST_PROP(scope);
            scope_property != NULL;
            scope_property = scope_property->parent) {
            PyObject* name;

            if ((scope_property->flags & SPROP_IS_DUPLICATE) == 0)
                continue;
            if (PyTuple_GET_ITEM(fn_args, scope_property->shortid) != NULL)
                continue;

            name = atom_to_string(JSID_TO_ATOM(scope_property->id));
            PyTuple_SET_ITEM(fn_args, (uint16)scope_property->shortid, name);
        }
        if (PyObject_SetAttrString(pynode, "fn_args", fn_args) == -1)
            goto fail;
    }
    else if (jsnode->pn_type == TOK_RB) {
        PyObject* end_comma = PyBool_FromLong(jsnode->pn_extra & PNX_ENDCOMMA);
        if (PyObject_SetAttrString(pynode, "end_comma", end_comma) == -1)
            goto fail;
    }

    if (PyObject_SetAttrString(pynode, "no_semi", PyBool_FromLong(jsnode->pn_no_semi)) == -1)
        goto fail;

    switch (jsnode->pn_arity) {
    case PN_FUNC:
        kids = PyTuple_New(1);
        PyTuple_SET_ITEM(kids, 0, jsnode_to_pynode(context, jsnode->pn_body));
        break;

    case PN_LIST: {
        JSParseNode* p;
        int i;
        kids = PyTuple_New(jsnode->pn_count);
        for (i = 0, p = jsnode->pn_head; p; p = p->pn_next, i++) {
            PyTuple_SET_ITEM(kids, i, jsnode_to_pynode(context, p));
        }
    }
    break;

    case PN_TERNARY:
        kids = PyTuple_New(3);
        PyTuple_SET_ITEM(kids, 0, jsnode_to_pynode(context, jsnode->pn_kid1));
        PyTuple_SET_ITEM(kids, 1, jsnode_to_pynode(context, jsnode->pn_kid2));
        PyTuple_SET_ITEM(kids, 2, jsnode_to_pynode(context, jsnode->pn_kid3));
        break;

    case PN_BINARY:
        kids = PyTuple_New(2);
        PyTuple_SET_ITEM(kids, 0, jsnode_to_pynode(context, jsnode->pn_left));
        PyTuple_SET_ITEM(kids, 1, jsnode_to_pynode(context, jsnode->pn_right));
        break;

    case PN_UNARY:
        kids = PyTuple_New(1);
        PyTuple_SET_ITEM(kids, 0, jsnode_to_pynode(context, jsnode->pn_kid));
        break;

    case PN_NAME:
        kids = PyTuple_New(1);
        PyTuple_SET_ITEM(kids, 0, jsnode_to_pynode(context, jsnode->pn_expr));
        break;

    case PN_NULLARY:
        kids = PyTuple_New(0);
        break;
    }

    if (!kids)
        goto fail;

    if (PyObject_SetAttrString(pynode, "kids", kids) == -1)
        goto fail;

    {
        int i;
        for (i = 0; i < PyTuple_GET_SIZE(kids); i++) {
            PyObject* kid = PyTuple_GET_ITEM(kids, i);
            if (!kid)
                goto fail;
            if (kid == Py_None)
                continue;

            Py_INCREF(pynode);
            if (PyObject_SetAttrString(kid, "parent", pynode) == -1)
                goto fail;
            if (PyObject_SetAttrString(kid, "node_index", Py_BuildValue("i", i)) == -1)
                goto fail;
        }
    }

    return pynode;

fail:
    if (pynode) {
        Py_XDECREF(pynode);
    }
    return NULL;
}

/* Returns NULL on success. Otherwise, it returns an error.
 * If the error is blank, an exception will be set.
 */
static const char* create_jscontext(const char* strversion, PyObject* is_e4x,
                                    void* ctx_data,
                                    JSRuntime** runtime, JSContext** context,
                                    JSObject** global)
{
    JSVersion jsversion;

    jsversion = JS_StringToVersion(strversion);
    if (jsversion == JSVERSION_UNKNOWN) {
        PyErr_SetString(PyExc_ValueError, "\"version\" is invalid");
        return "";
    }

    *runtime = JS_NewRuntime(8L * 1024L * 1024L);
    if (*runtime == NULL)
        return "cannot create runtime";

    *context = JS_NewContext(*runtime, 8192);
    if (*context == NULL)
        return "cannot create context";

    JS_SetErrorReporter(*context, error_reporter);
    JS_SetContextPrivate(*context, ctx_data);
    JS_ToggleOptions(*context, JSOPTION_STRICT);
    if (is_e4x == Py_True)
        JS_ToggleOptions(*context, JSOPTION_XML);
    else if (is_e4x != Py_False)
        return "e4x is not a boolean";
    JS_SetVersion(*context, jsversion);

    *global = JS_NewObject(*context, NULL, NULL, NULL);
    if (*global == NULL)
        return "cannot create global object";

    if (!JS_InitStandardClasses(*context, *global))
        return "cannot initialize standard classes";

    return NULL;
}


static PyObject*
module_parse(PyObject *self, PyObject *args) {
    struct {
        char* scriptbuf;
        int scriptbuflen;
        const char* jsversion;
        PyObject* is_e4x;
        PyObject* pynode;

        JSRuntime* runtime;
        JSContext* context;
        JSObject* global;
        JSTokenStream* token_stream;
        JSParseNode* jsnode;

        JSContextData ctx_data;
    } m;
    const char* error;

    memset(&m, 0, sizeof(m));
    error = "encountered an unknown error";

    /* validate arguments */
    if (!PyArg_ParseTuple(args, "es#sO!OOll", "utf16", &m.scriptbuf,
        &m.scriptbuflen, &m.jsversion, &PyBool_Type, &m.is_e4x,
        &m.ctx_data.node_class, &m.ctx_data.error_callback,
        &m.ctx_data.first_lineno, &m.ctx_data.first_index)) {
        return NULL;
    }

    if (!PyCallable_Check(m.ctx_data.node_class)) {
        PyErr_SetString(PyExc_ValueError, "\"node_class\" must be callable");
        return NULL;
    }

    if (!PyCallable_Check(m.ctx_data.error_callback)) {
        PyErr_SetString(PyExc_ValueError, "\"error\" must be callable");
        return NULL;
    }

    error = create_jscontext(m.jsversion, m.is_e4x, &m.ctx_data,
                             &m.runtime, &m.context, &m.global);
    if (error)
        goto cleanup;

    m.token_stream = js_NewBufferTokenStream(m.context, tojschar(m.scriptbuf),
                                             tojscharlen(m.scriptbuflen));
    if (!m.token_stream) {
        error = "cannot create token stream";
        goto cleanup;
    }

    m.jsnode = js_ParseTokenStream(m.context, m.global, m.token_stream);
    if (!m.jsnode) {
        if (!JS_ReportPendingException(m.context)) {
            error = "parse error in file";
            goto cleanup;
        }
    }

    m.pynode = jsnode_to_pynode(m.context, m.jsnode);
    if (!m.pynode) {
        error = "";
        goto cleanup;
    }

    error = NULL;

cleanup:
    if (m.context)
        JS_DestroyContext(m.context);
    if (m.runtime)
        JS_DestroyRuntime(m.runtime);
    if (m.scriptbuf)
        PyMem_Free(m.scriptbuf);

    if (error) {
        if (*error) {
            PyErr_SetString(PyExc_StandardError, error);
        }
        return NULL;
    }
    return m.pynode;
}

static PyObject*
is_compilable_unit(PyObject *self, PyObject *args) {
    struct {
        char* scriptbuf;
        int scriptbuflen;
        const char* jsversion;
        PyObject* is_e4x;
        JSRuntime* runtime;
        JSContext* context;
        JSObject* global;
        JSBool is_compilable;
    } m;
    const char* error;

    memset(&m, 0, sizeof(m));
    error = "encountered an unknown error";

    if (!PyArg_ParseTuple(args, "es#sO!", "utf16", &m.scriptbuf,
        &m.scriptbuflen, &m.jsversion, &PyBool_Type, &m.is_e4x)) {
        return NULL;
    }

    error = create_jscontext(m.jsversion, m.is_e4x, NULL,
                             &m.runtime, &m.context, &m.global);
    if (error)
        goto cleanup;

    m.is_compilable = JS_UCBufferIsCompilableUnit(m.context, m.global,
                                                  tojschar(m.scriptbuf),
                                                  tojscharlen(m.scriptbuflen));
    error = NULL;

cleanup:
    if (m.context)
        JS_DestroyContext(m.context);
    if (m.runtime)
        JS_DestroyRuntime(m.runtime);
    if (m.scriptbuf)
        PyMem_Free(m.scriptbuf);

    if (error) {
        if (*error)
            PyErr_SetString(PyExc_StandardError, error);
        return NULL;
    }
    if (m.is_compilable)
        Py_RETURN_TRUE;
    else
        Py_RETURN_FALSE;
}

static PyObject*
is_valid_version(PyObject *self, PyObject *args) {
    const char* strversion = NULL;

    if (!PyArg_ParseTuple(args, "s", &strversion))
        return NULL;

    if (JS_StringToVersion(strversion) != JSVERSION_UNKNOWN)
        Py_RETURN_TRUE;
    else
        Py_RETURN_FALSE;
}

