#include <v8.h>
#include <node.h>
#include <string.h>
#include <unistd.h>
#include <node_object_wrap.h>
#include <kstat.h>
#include <errno.h>
#include <string>
#include <vector>
#include <sys/varargs.h>

using namespace v8;
using std::string;
using std::vector;

class KStatReader : node::ObjectWrap {
public:
	static void Initialize(Handle<Object> target);

protected:
	static Persistent<FunctionTemplate> templ;

	KStatReader(string *module, string *classname,
	    string *name, int instance);
	Handle<Value> error(const char *fmt, ...);
	Handle<Value> read(kstat_t *);
	int update();
	~KStatReader();

	static Handle<Value> New(const Arguments& args);
	static Handle<Value> Read(const Arguments& args);
	static Handle<Value> Update(const Arguments& args);


private:
	static string *stringMember(Local<Value>, char *, char *);
	static int64_t intMember(Local<Value>, char *, int64_t);
	Handle<Object> data_named(kstat_t *);
	Handle<Object> data_io(kstat_t *);

	string *ksr_module;
	string *ksr_class;
	string *ksr_name;
	int ksr_instance;
	kid_t ksr_kid;
	kstat_ctl_t *ksr_ctl;
	vector<kstat_t *> ksr_kstats;
};

Persistent<FunctionTemplate> KStatReader::templ;

KStatReader::KStatReader(string *module, string *classname,
    string *name, int instance)
    : node::ObjectWrap(), ksr_module(module), ksr_class(classname),
    ksr_name(name), ksr_instance(instance), ksr_kid(-1)
{
	if ((ksr_ctl = kstat_open()) == NULL)
		throw "could not open kstat";
};

KStatReader::~KStatReader()
{
	delete ksr_module;
	delete ksr_class;
	delete ksr_name;
	kstat_close(ksr_ctl);
}

int
KStatReader::update()
{
	kstat_t *ksp;
	kid_t kid;

	if ((kid = kstat_chain_update(ksr_ctl)) == 0 && ksr_kid != -1)
		return (0);

	if (kid == -1)
		return (-1);

	ksr_kid = kid;
	ksr_kstats.clear();

	for (ksp = ksr_ctl->kc_chain; ksp != NULL; ksp = ksp->ks_next) {
		if (!ksr_module->empty() &&
		    ksr_module->compare(ksp->ks_module) != 0)
			continue;

		if (!ksr_class->empty() &&
		    ksr_class->compare(ksp->ks_class) != 0)
			continue;

		if (!ksr_name->empty() && ksr_name->compare(ksp->ks_name) != 0)
			continue;

		if (ksr_instance != -1 && ksp->ks_instance != ksr_instance)
			continue;

		ksr_kstats.push_back(ksp);
	}

	return (0);
}

void
KStatReader::Initialize(Handle<Object> target)
{
	HandleScope scope;

	Local<FunctionTemplate> k = FunctionTemplate::New(KStatReader::New);

	templ = Persistent<FunctionTemplate>::New(k);
	templ->InstanceTemplate()->SetInternalFieldCount(1);
	templ->SetClassName(String::NewSymbol("Reader"));

	NODE_SET_PROTOTYPE_METHOD(templ, "read", KStatReader::Read);

	target->Set(String::NewSymbol("Reader"), templ->GetFunction());
}

string *
KStatReader::stringMember(Local<Value> value, char *member, char *deflt)
{
	if (!value->IsObject())
		return (new string (deflt));

	Local<Object> o = Local<Object>::Cast(value);
	Local<Value> v = o->Get(String::New(member));

	if (!v->IsString())
		return (new string (deflt));

	String::AsciiValue val(v);
	return (new string(*val));
}

int64_t
KStatReader::intMember(Local<Value> value, char *member, int64_t deflt)
{
	int64_t rval = deflt;

	if (!value->IsObject())
		return (rval);

	Local<Object> o = Local<Object>::Cast(value);
	value = o->Get(String::New(member));

	if (!value->IsNumber())
		return (rval);

	Local<Integer> i = Local<Integer>::Cast(value);

	return (i->Value());
}

Handle<Value>
KStatReader::New(const Arguments& args)
{
	HandleScope scope;

	KStatReader *k = new KStatReader(stringMember(args[0], "module", ""),
	    stringMember(args[0], "class", ""),
	    stringMember(args[0], "name", ""),
	    intMember(args[0], "instance", -1));

	k->Wrap(args.Holder());

	return (args.This());
}

Handle<Value>
KStatReader::error(const char *fmt, ...)
{
	char buf[1024], buf2[1024];
	char *err = buf;
	va_list ap;

	va_start(ap, fmt);
	(void) vsnprintf(buf, sizeof (buf), fmt, ap);

	if (buf[strlen(buf) - 1] != '\n') {
		/*
		 * If our error doesn't end in a new-line, we'll append the
		 * strerror of errno.
		 */
		(void) snprintf(err = buf2, sizeof (buf2),
		    "%s: %s", buf, strerror(errno));
	} else {
		buf[strlen(buf) - 1] = '\0';
	}

	return (ThrowException(Exception::Error(String::New(err))));
}

Handle<Object>
KStatReader::data_named(kstat_t *ksp)
{
	Handle<Object> data = Object::New();
	kstat_named_t *nm = KSTAT_NAMED_PTR(ksp);
	int i;

	assert(ksp->ks_type == KSTAT_TYPE_NAMED);

	for (i = 0; i < ksp->ks_ndata; i++, nm++) {
		Handle<Value> val;

		switch (nm->data_type) {
		case KSTAT_DATA_CHAR:
			val = Number::New(nm->value.c[0]);
			break;

		case KSTAT_DATA_INT32:
			val = Number::New(nm->value.i32);
			break;

		case KSTAT_DATA_UINT32:
			val = Number::New(nm->value.ui32);
			break;

		case KSTAT_DATA_INT64:
			val = Number::New(nm->value.i64);
			break;

		case KSTAT_DATA_UINT64:
			val = Number::New(nm->value.ui64);
			break;

		case KSTAT_DATA_STRING:
			val = String::New(KSTAT_NAMED_STR_PTR(nm));
			break;

		default:
			throw (error("unrecognized data type %d for member "
			    "\"%s\" in instance %d of stat \"%s\" (module "
			    "\"%s\", class \"%s\")\n", nm->data_type,
			    nm->name, ksp->ks_instance, ksp->ks_name,
			    ksp->ks_module, ksp->ks_class));
		}

		data->Set(String::New(nm->name), val);
	}

	return (data);
}

Handle<Object>
KStatReader::data_io(kstat_t *ksp)
{
	Handle<Object> data = Object::New();
	kstat_io_t *io = KSTAT_IO_PTR(ksp);

	assert(ksp->ks_type == KSTAT_TYPE_IO);

	data->Set(String::New("nread"), Number::New(io->nread));
	data->Set(String::New("nwritten"), Number::New(io->nwritten));
	data->Set(String::New("reads"), Integer::New(io->reads));
	data->Set(String::New("writes"), Integer::New(io->writes));

	data->Set(String::New("wtime"), Number::New(io->wtime));
	data->Set(String::New("wlentime"), Number::New(io->wlentime));
	data->Set(String::New("wlastupdate"), Number::New(io->wlastupdate));

	data->Set(String::New("rtime"), Number::New(io->rtime));
	data->Set(String::New("rlentime"), Number::New(io->rlentime));
	data->Set(String::New("rlastupdate"), Number::New(io->rlastupdate));

	data->Set(String::New("wcnt"), Integer::New(io->wcnt));
	data->Set(String::New("rcnt"), Integer::New(io->rcnt));

	return (data);
}

Handle<Value>
KStatReader::read(kstat_t *ksp)
{
	Handle<Object> rval = Object::New();
	Handle<Object> data;

	rval->Set(String::New("class"), String::New(ksp->ks_class));
	rval->Set(String::New("module"), String::New(ksp->ks_module));
	rval->Set(String::New("name"), String::New(ksp->ks_name));
	rval->Set(String::New("instance"), Integer::New(ksp->ks_instance));

	if (kstat_read(ksr_ctl, ksp, NULL) == -1) {
		/*
		 * It is deeply annoying, but some kstats can return errors
		 * under otherwise routine conditions.  (ACPI is one
		 * offender; there are surely others.)  To prevent these
		 * fouled kstats from completely ruining our day, we assign
		 * an "error" member to the return value that consists of
		 * the strerror().
		 */
		rval->Set(String::New("error"), String::New(strerror(errno)));
		return (rval);
	}

	rval->Set(String::New("instance"), Integer::New(ksp->ks_instance));
	rval->Set(String::New("snaptime"), Number::New(ksp->ks_snaptime));
	rval->Set(String::New("crtime"), Number::New(ksp->ks_crtime));

	if (ksp->ks_type == KSTAT_TYPE_NAMED) {
		data = data_named(ksp);
	} else if (ksp->ks_type == KSTAT_TYPE_IO) {
		data = data_io(ksp);
	} else {
		return (rval);
	}

	rval->Set(String::New("data"), data);

	return (rval);
}

Handle<Value>
KStatReader::Read(const Arguments& args)
{
	KStatReader *k = ObjectWrap::Unwrap<KStatReader>(args.Holder());
	Handle<Array> rval;
	HandleScope scope;
	int i;

	if (k->update() == -1)
		return (k->error("failed to update kstat chain"));

	rval = Array::New(k->ksr_kstats.size());

	try {
		for (i = 0; i < k->ksr_kstats.size(); i++)
			rval->Set(i, k->read(k->ksr_kstats[i]));
	} catch (Handle<Value> err) {
		return (err);
	}

	return (rval);
}

extern "C" void
init (Handle<Object> target) 
{
	KStatReader::Initialize(target);
}
