/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

#include <stdio.h>
#include <zone.h>
#include <errno.h>

#include <node.h>
#include <nan.h>

using namespace v8;
using namespace node;

static NAN_METHOD(zonename_getzoneid)
{
	zoneid_t zoneid = getzoneid();

	info.GetReturnValue().Set(Nan::New<Number>(zoneid));
}

static NAN_METHOD(zonename_getzoneidbyname)
{
	if (info.Length() < 1 || !info[0]->IsString()) {
		Nan::ThrowTypeError("Bad argument");
		return;
	}

	Nan::Utf8String name(info[0]);

	zoneid_t zoneid = getzoneidbyname(*name);

	if (zoneid < 0) {
		char errbuf[128] = "";

		snprintf(errbuf, sizeof (errbuf),
		    "getzoneidbyname: %s", strerror(errno));

		Nan::ThrowError(errbuf);
		return;
	}

	info.GetReturnValue().Set(Nan::New<Number>(zoneid));
}

static NAN_METHOD(zonename_getzonenamebyid)
{
	if (info.Length() < 1 || !info[0]->IsInt32()) {
		Nan::ThrowTypeError("Bad argument");
		return;
	}

	zoneid_t zoneid = Nan::To<int32_t>(info[0]).FromJust();

	char zonename[ZONENAME_MAX];

	if (getzonenamebyid(zoneid, zonename, sizeof (zonename)) < 0) {
		char errbuf[128] = "";

		snprintf(errbuf, sizeof (errbuf),
		    "getzonenamebyid: %s", strerror(errno));

		Nan::ThrowError(errbuf);
		return;
	}

	info.GetReturnValue().Set(Nan::New<String>(zonename).ToLocalChecked());
}

extern "C"
NAN_MODULE_INIT(init)
{
	//Nan::HandleScope scope;

	Export(target, "getzoneid", zonename_getzoneid);
	Export(target, "getzoneidbyname", zonename_getzoneidbyname);
	Export(target, "getzonenamebyid", zonename_getzonenamebyid);
}

#if NODE_MODULE_VERSION > 1
NODE_MODULE(zonename, init)
#endif
