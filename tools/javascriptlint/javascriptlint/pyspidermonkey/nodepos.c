/* vim: ts=4 sw=4 expandtab
 */
#include <Python.h>
#include "structmember.h"

#include "nodepos.h"

typedef struct {
    PyObject_HEAD
    int line;
    int col;
} NodePosObject;

static PyObject*
NodePos_new(PyTypeObject* type, PyObject* args, PyObject* kwds)
{
    NodePosObject* self;

    self = (NodePosObject*)type->tp_alloc(type, 0);
    if (self == NULL)
        return NULL;

    self->line = -1;
    self->col = -1;

    return (PyObject*)self;
}

static int
NodePos_init(NodePosObject* self, PyObject* args, PyObject* kwds)
{
    static char* kwlist[] = {"line", "col", NULL};
    if (!PyArg_ParseTupleAndKeywords(args, kwds, "ii", kwlist, &self->line, &self->col))
        return -1;

    return 0;
}

static PyObject*
NodePos_str(NodePosObject* self)
{
    return PyString_FromFormat("(line %i, col %i)", self->line+1, self->col+1);
}

static int
NodePos_compare(NodePosObject* left, NodePosObject* right)
{
    if (left->line < right->line)
        return -1;
    if (left->line > right->line)
        return 1;
    if (left->col < right->col)
        return -1;
    if (left->col > right->col)
        return 1;
    return 0;
}

static PyMemberDef
NodePos_members[] = {
    {"line", T_INT, offsetof(NodePosObject, line), 0, "zero-based line number"},
    {"col", T_INT, offsetof(NodePosObject, col), 0, "zero-based column number"},
    {NULL} /* Sentinel */
};

PyTypeObject NodePosType = {
    PyObject_HEAD_INIT(NULL)
    0,                         /*ob_size*/
    "pyspidermonkey.NodePos",  /*tp_name*/
    sizeof(NodePosObject),     /*tp_basicsize*/
    0,                         /*tp_itemsize*/
    0,                         /*tp_dealloc*/
    0,                         /*tp_print*/
    0,                         /*tp_getattr*/
    0,                         /*tp_setattr*/
    (cmpfunc)NodePos_compare,  /*tp_compare*/
    0,                         /*tp_repr*/
    0,                         /*tp_as_number*/
    0,                         /*tp_as_sequence*/
    0,                         /*tp_as_mapping*/
    0,                         /*tp_hash */
    0,                         /*tp_call*/
    (reprfunc)NodePos_str,     /*tp_str*/
    0,                         /*tp_getattro*/
    0,                         /*tp_setattro*/
    0,                         /*tp_as_buffer*/
    Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, /*tp_flags*/
    "Represents zero-based line and column number.", /* tp_doc */
    0,                         /* tp_traverse */
    0,                         /* tp_clear */
    0,                         /* tp_richcompare */
    0,                         /* tp_weaklistoffset */
    0,                         /* tp_iter */
    0,                         /* tp_iternext */
    0,                         /* tp_methods */
    NodePos_members,           /* tp_members */
    0,                         /* tp_getset */
    0,                         /* tp_base */
    0,                         /* tp_dict */
    0,                         /* tp_descr_get */
    0,                         /* tp_descr_set */
    0,                         /* tp_dictoffset */
    (initproc)NodePos_init,    /* tp_init */
    0,                         /* tp_alloc */
    NodePos_new,               /* tp_new */
};

void
RegisterNodePosType(PyObject* module)
{
    if (PyType_Ready(&NodePosType) < 0)
        return;

    Py_INCREF(&NodePosType);
    PyModule_AddObject(module, "NodePos", (PyObject*)&NodePosType);
}

