import os

srcdir = os.path.abspath('.')
blddir = 'build'
target = 'libuuid'
VERSION = '0.0.1'

def set_options(opt):
    opt.tool_options('compiler_cxx')

def configure(conf):
    conf.check_tool('compiler_cxx')
    conf.check_tool('node_addon')
    conf.check_cxx(lib='uuid', mandatory=False, uselib_store='uuid')

def build(context, target=target):
    obj = context.new_task_gen('cxx', 'shlib', 'node_addon')
    
    obj.uselib = 'uuid'
    obj.source = 'src/uuid.cc'
    obj.target = target
