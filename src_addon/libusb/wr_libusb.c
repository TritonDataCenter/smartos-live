/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License (the "License").
 * You may not use this file except in compliance with the License.
 *
 * You can obtain a copy of the license at usr/src/OPENSOLARIS.LICENSE
 * or http://www.opensolaris.org/os/licensing.
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file and include the License file at usr/src/OPENSOLARIS.LICENSE.
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 */
/*
 * Copyright (c) 2004, 2010, Oracle and/or its affiliates. All rights reserved.
 */

#pragma ident	"@(#)wr_libusb.c	1.6	10/12/20 SMI"

#include <stdlib.h>
#include <stdio.h>
#include <sys/types.h>
#include <dirent.h>
#include <errno.h>
#include <strings.h>
#include <dlfcn.h>
#include <thread.h>
#include <synch.h>
#include <stdarg.h>
#include "usb.h"
#include "wr_libusb.h"

/*
 * libusb wrapper library
 *
 * Implements the libusb specification and calls into platform dependent
 * library implementations of sunray and solaris.
 *
 * Loads the .so's found in the default directory or pointed
 * to by the environment variable SUN_LIBUSBPLUGIN_DIR
 * If there are problems with the module then unload
 * the module and continue
 *
 * Reads plugin versions from the libusb_version variable
 * Reads plugin prefixes from libusb_prefix variable
 * Calls libusb_init implementation of the plugin to determine whether
 * the plugin bus is supported, unsupported, or exclusive.
 * This is from the return values 0, -1, 2
 *
 * In the exclusive case all others plugins will be disabled
 * Case1: ret = PLUGIN_EXCLUSIVE [2]:
 *		Sun Ray Environment where server bus is not requested
 *		via an environment variable
 * Case2: ret = FAILURE [-1]
 *		In the failure case the scenario is an app running
 *		in a workstation where the sunray bus cannot be made available.
 * Case3: ret = SUCCESS [0]:
 *		All busses are supported
 *
 * The plugins implement certain policies to determine whether access
 * to their bus will be granted and how.
 * These policies are internal to the plugin and not relevant to the wrapper
 * The wrapper merely supports the implementation of these  policies
 * via environment variables and init return values.
 *
 * Loads all the symbols of the plugins and maps apps calls -> plugin
 *
 * The wrapper library maintains the open device handle states to be
 * able to map the device handle to the correct plugin. As such each
 * open and close results in updates to the dev handle list.
 *
 */


static int  read_plugin_entries(void);
static int  load_plugin_syms(plugin_info_t *, void *, int);
static void wusb_symbol(char **, int, char *, char *);
static int  get_pindex(struct usb_dev_handle *, const char *);
static void unload_plugin(int);
static int  load_plugins();
static int  get_index_devicep(struct usb_device *);
static int  get_index_devhdl(struct usb_dev_handle *);
static int  usb_add_dev(struct usb_dev_handle *, struct usb_device *, int);
static void usb_del_dev(struct usb_dev_handle *, int);
static int  check_sym_hdl(int, int);
static void *lookup_sym_hdl(usb_dev_handle *, int, const char *);
static void  usb_dprintf(int level, char *format, ...);
static int  is_libusb_plugin(char *);

static int		libusb_debug = DEBUG_NONE;
struct usb_bus		*usb_busses;
static mutex_t		bus_lock = DEFAULTMUTEX;
static wrapper_info_t	winfo;
static plugin_info_t	p_info[MAX_PLUGINS];

#ifdef	_LP64

#define	PLUGIN_PREFIX		"/64/"

#else	/* _LP64 */

#define	PLUGIN_PREFIX		""

#endif	/* _LP64 */


/*
 * Reads the plugin libraries from the specified dir
 * or the user supplied SUN_LIBUSBPLUGIN_DIR
 * populates the p_name and p_path fields of the array of plugin_info structs
 * increments the array index pindex after each .so is read
 * returns -1(FAILURE) on error
 */
static int
read_plugin_entries()
{
	int	pindex = 0;
	int	plugin_found = 0;
	char	*alt_dir;
	DIR	*dirp;
	struct	dirent *dp;
	char	*tmpplugindir = PLUGIN_DIR;
	char	*suffix;
	char	modpath[PATH_MAX + 1];
	char	plugindir[PATH_MAX + 1];

	if ((alt_dir = getenv("SUN_LIBUSBPLUGIN_DIR")) != NULL) {
		tmpplugindir = alt_dir;
	}

	if (strnlen(tmpplugindir, PATH_MAX) >
	    (PATH_MAX - sizeof (PLUGIN_PREFIX))) {
		usb_dprintf(DEBUG_FUNCTIONS,
		    "Invalid plugin directory: %s\n", tmpplugindir);

		return (FAILURE);
	}

	/*
	 * Construct the plugin directory
	 * Default plugin for 32 bit: /usr/lib/libusb_plugins/
	 *		  for 64 bit: /usr/lib/libusb_plugins/64/
	 *
	 * If SUN_LIBUSBPLUGIN_DIR is set, the plugin is:
	 *	32bit: SUN_LIBUSBPLUGIN_DIR/
	 *	64bit: SUN_LIBUSBPLUGIN_DIR/64/
	 */
	snprintf(plugindir, PATH_MAX, "%s%s", tmpplugindir,
	    PLUGIN_PREFIX);

	usb_dprintf(DEBUG_FUNCTIONS, "plugins dir: %s\n", plugindir);

	if ((dirp = opendir(plugindir)) == NULL) {
		usb_dprintf(DEBUG_ERRORS, "%s: %s \n",
		    plugindir, strerror(errno));
		return (FAILURE);
	}
	while (dirp) {
		errno = 0;
		if ((dp = readdir(dirp)) != NULL) {
			usb_dprintf(DEBUG_FUNCTIONS,
			    "reading entry %s\n", dp->d_name);

			/* skip . and .. entries */
			if (strncmp(dp->d_name,	".", 1) == 0) {
				continue;
			}
			if (strncmp(dp->d_name, "..", 2) == 0) {
				continue;
			}

			/*
			 * Ignore files that are not *.so.X
			 * this ensures that libusb.so.1 and plugins.so.1
			 * and libusb.so.2 and plugin.so.2 can both be
			 * supported
			 */
			if ((suffix = strstr(dp->d_name, MOD_SUFFIX)) == NULL) {
				continue;
			} else if (suffix[strlen(MOD_SUFFIX)] != '.') {
				usb_dprintf(DEBUG_RECOVERABLE,
				    "did not load %s:%s\n",
				    plugindir, dp->d_name);
				continue;
			}
			usb_dprintf(DEBUG_FUNCTIONS,
			    "reading .so file %s:%s\n", plugindir, dp->d_name);
			p_info[pindex].p_name = strdup(dp->d_name);

			/*
			 * using PATH_MAX len here
			 */
			if (strlen(p_info[pindex].p_name) > PATH_MAX) {
				usb_dprintf(DEBUG_RECOVERABLE,
				    "pathname > PATH_MAX %s",
				    p_info[pindex].p_name);
				/* go on to try read next module */
				free(p_info[pindex].p_name);
				continue;
			}
			(void) strncpy(modpath, plugindir, PATH_MAX);
			(void) strncat(modpath, "/", 1);
			(void) strncat(modpath,
			    p_info[pindex].p_name, PATH_MAX);
			p_info[pindex].p_path = strdup(modpath);
			usb_dprintf(DEBUG_FUNCTIONS,
			    "Path is %s\n", p_info[pindex].p_path);

			/*
			 * If we do not detect a valid libusb plugin
			 * then let's skip and continue
			 * do not update pindex if we want to continue
			 * we will dlopen and dlclose in this check
			 */
			if (is_libusb_plugin(p_info[pindex].p_path) !=
			    SUCCESS) {
				free(p_info[pindex].p_path);
				free(p_info[pindex].p_name);
				continue;
			}
			plugin_found = 1;
			if (++pindex == MAX_PLUGINS) {
				usb_dprintf(DEBUG_FUNCTIONS,
				    "Max plugins read %d\n", pindex);
				break;
			}
		} else {
			if (errno == 0) {
				(void) closedir(dirp);
				if (!plugin_found) {
					usb_dprintf(DEBUG_ERRORS,
					    "No plugin found \n");
					return (FAILURE);
				} else {
					/* end of dir stream */
					return (SUCCESS);
				}
			} else {
				(void) closedir(dirp);
				return (FAILURE);
			}
		}
	}
	return (SUCCESS);
}

/*
 * In a directory crowded with a lot of .so's
 * filter out potential libusb plugins - helps
 * the plugin loader to only load valid plugins
 * uses the libusb_version symbol as a filter
 */
static int
is_libusb_plugin(char *modname)
{
	void	*hdl;
	void	*hdl_sym1;
	void	*hdl_sym2;
	char	*symbol1 = "usb_init";
	char	*symbol2 = "libusb_prefix";

	hdl = dlopen(modname, RTLD_NOW);
	if (hdl == NULL) {
		usb_dprintf(DEBUG_RECOVERABLE,
		    "%s could not be loaded \n", modname);
		return (FAILURE);
	}
	hdl_sym1 = (void *)(dlsym(hdl, symbol1));
	hdl_sym2 = (void *)(dlsym(hdl, symbol2));
	(void) dlclose(hdl);
	if ((hdl_sym1 == NULL) && (hdl_sym2 == NULL)) {
		usb_dprintf(DEBUG_FUNCTIONS,
		    "%s not a libusb plugin: unload\n", modname);
		return (FAILURE);
	} else {
		return (SUCCESS);
	}
}

/*
 * Read the plugin entry names
 * Load the plugins and populate the proper data structures
 * this includes things like bus/dev ptr mappings, handles, etc.
 * Also loads all the symbols also and store the handles
 * Lock: called with bus_lock held
 * called from usb_init
 */
static int
load_plugins()
{
	int	pindex = 0;
	void	*handle;
	int	module_loaded = 0;

	if (read_plugin_entries() != SUCCESS) {
		usb_dprintf(DEBUG_FUNCTIONS,
		    "Failed to load libusb plugins \n");
		return (FAILURE);
	}
	usb_dprintf(DEBUG_FUNCTIONS,
	    "load_plugin: modname is %s\n", p_info[pindex].p_name);
	/*
	 * Will load at most MAX_PLUGINS
	 */
	while (pindex < MAX_PLUGINS) {
		/* reached the end of modules read into the array */
		if (p_info[pindex].p_name == NULL) {
			break;
		}
		usb_dprintf(DEBUG_FUNCTIONS, "loading:%s pindex:%d\n",
		    p_info[pindex].p_name, pindex);
		handle = dlopen(p_info[pindex].p_path,	RTLD_NOW);
		if (handle == NULL) {
			usb_dprintf(DEBUG_RECOVERABLE,
			    "handle for %s is null\n", p_info[pindex].p_name);
			usb_dprintf(DEBUG_RECOVERABLE, dlerror());
			p_info[pindex].p_handle = NULL;
			free(p_info[pindex].p_name);
			free(p_info[pindex].p_path);
			/* just try to load the next one */
			pindex += 1;
			continue;
		} else {
			p_info[pindex].p_handle = handle;
		}
		if (load_plugin_syms(p_info, handle, pindex) != SUCCESS) {
			usb_dprintf(DEBUG_FUNCTIONS, "Failed to load"
			    "symbols for plugin %s\n",
			    p_info[pindex].p_name);
			unload_plugin(pindex);
			pindex += 1;
			/* try the next plugin */
			continue;
		}
		module_loaded = 1;
		pindex += 1;
	}
	if (!module_loaded) {
		usb_dprintf(DEBUG_FUNCTIONS, "No module could be loaded \n");
		return (FAILURE);
	} else {
		/* ploaded is the highest index that had a module entry */
		winfo.ploaded = pindex;
		return (SUCCESS);
	}
}

/*
 * For debugging of bus pointers
 */
static void
dump_busses()
{
	struct usb_bus	*busp;

	for (busp = usb_busses; busp != NULL; busp = busp->next) {
		usb_dprintf(DEBUG_DETAILED, "busp is 0x%x\n", busp);
	}
}

/*
 * Used to unload plugin
 * calling libusb_fini
 */
static void
unload_plugin(int pindex)
{
	int	sym_idx;
	int	(*hdl_libusb_fini)(void);

	free(p_info[pindex].p_name);
	free(p_info[pindex].p_path);
	p_info[pindex].p_name = NULL;

	/* call the plugins libusb_fini here */
	if (check_sym_hdl(pindex, LIBUSB_FINI) < 0) {
		(void) usb_dprintf(DEBUG_RECOVERABLE,
		    "hdl_libusb_fini is NULL \n");
	} else {
		hdl_libusb_fini =
		    LIBUSB_FINI_CAST(p_info[pindex].sym_hdl[LIBUSB_FINI]);
		(*hdl_libusb_fini)();
	}
	if (p_info[pindex].p_handle != NULL) {
		(void) dlclose(p_info[pindex].p_handle);
		p_info[pindex].exclusive_flag = 0;
		p_info[pindex].active_flag = 0;
		p_info[pindex].p_handle = NULL;
	}
	for (sym_idx = 0; sym_idx < NUM_SYMS; sym_idx ++) {
		p_info[pindex].sym_hdl[sym_idx] = NULL;
	}
}

/*
 * In trying to map the device handle to a bus
 * walk through the dev handle pointers added
 * during open and find the matching dev handle
 * that exists for that bus. On no match return
 * FAILURE on match return the bus index for this
 * dev handle
 */
static int
get_index_devhdl(struct usb_dev_handle *dev)
{
	int		pindex;
	dev_handles_t	*devh;

	for (pindex = 0; pindex < winfo.ploaded; pindex ++) {
		for (devh = p_info[pindex].dev_handles; devh != NULL;
		    devh = devh->next) {
			if (dev == devh->dev) {
				return (pindex);
			}
		}
	}
	return (FAILURE);
}

/*
 * upon a call to open adds the device handle to the
 * list of handles the wrapper will maintain
 * so that it can map device handles to bus
 * holds bus_lock
 * This is needed simply because we want to able
 * to map the device handles to the plugin module
 */
static int
usb_add_dev(struct usb_dev_handle *dev, struct usb_device *device,
	int pindex)
{
	dev_handles_t	*devh, *curr_devh;

	(void) mutex_lock(&bus_lock);

	/* first device handle to be added */
	if (p_info[pindex].dev_handles == NULL) {
		devh = (dev_handles_t *)malloc(sizeof (dev_handles_t));
		if (devh == NULL) {
			usb_dprintf(DEBUG_FUNCTIONS,
			    "Error adding device to list \n");
			(void) mutex_unlock(&bus_lock);
			return (FAILURE);
		}
		p_info[pindex].dev_handles = devh;
		devh->prev = NULL;
		devh->next = NULL;
	} else {
		curr_devh = p_info[pindex].dev_handles;
		while (curr_devh->next != NULL) {
			curr_devh = curr_devh->next;
		}
		/* curr_devh points to last devh handle */
		curr_devh->next = (dev_handles_t *)
		    malloc(sizeof (dev_handles_t));
		if (curr_devh->next == NULL) {
			usb_dprintf(DEBUG_FUNCTIONS,
			    "Error adding device to list \n");
			(void) mutex_unlock(&bus_lock);
			return (FAILURE);
		}
		devh = curr_devh->next;
		devh->next = NULL;
		devh->prev = curr_devh;
	}
	devh->device = device;
	devh->dev = dev;
	(void) mutex_unlock(&bus_lock);

	return (SUCCESS);
}

/*
 * upon a call to usb_close removes the device handle from the
 * list of handles the wrapper will maintain
 * entries do not get removed on a device removal only on close
 * holds bus_lock
 */
static void
usb_del_dev(struct usb_dev_handle *dev, int pindex)
{
	dev_handles_t	*d_dev;

	(void) mutex_lock(&bus_lock);
	d_dev = p_info[pindex].dev_handles;

	while (d_dev != NULL) {
		if (d_dev->dev == dev) {
			/* Not the last dev hdl */
			if (d_dev->next != NULL) {
				usb_dprintf(DEBUG_DETAILED,
				    "d_dev->next != NULL\n");
				d_dev->next->prev = d_dev->prev;
			}
			/* Not the first dev hdl */
			if (d_dev->prev != NULL) {
				usb_dprintf(DEBUG_DETAILED,
				    "d_dev->prev != NULL\n");
				d_dev->prev->next = d_dev->next;
			} else {
				/*
				 * first dev hdl on list
				 * if only handle then point to NULL
				 */
				p_info[pindex].dev_handles = d_dev->next;
				if (d_dev->next != NULL) {
					usb_dprintf(DEBUG_DETAILED,
					    "d_dev->next != NULL\n");
					d_dev->next->prev = NULL;
				}
			}
			free(d_dev);
			break;
		}
		d_dev = d_dev->next;
	}

	(void) mutex_unlock(&bus_lock);
}

/*
 * checks if a function has a valid symbol handle
 * there also needs to be a valid dlopen hdl for the plugin
 */
static int
check_sym_hdl(int pindex, int sym_index)
{
	if (p_info[pindex].p_handle == NULL) {
		return (FAILURE);
	} else if (p_info[pindex].sym_hdl[sym_index] == NULL) {
		usb_dprintf(DEBUG_FUNCTIONS,
		    "sym_hdl[%d] is null \n", sym_index);
		return (FAILURE);
	} else {
		return (SUCCESS);
	}
}

/*
 * returns a  valid symbol handle or NULL
 */
static void *
lookup_sym_hdl(usb_dev_handle *dev, int sym_index, const char *func)
{
	int	pindex;

	if ((pindex = get_pindex(dev, func)) < 0) {
		return (NULL);
	}
	if (p_info[pindex].p_handle == NULL) {
		return (NULL);
	} else if (p_info[pindex].sym_hdl[sym_index] == NULL) {
		usb_dprintf(DEBUG_FUNCTIONS,
		    "sym_hdl[%d] is null \n", sym_index);
		return (NULL);
	} else {
		/* this is needed to support strerror() of last call */
		(void) mutex_lock(&bus_lock);
		winfo.last_pindex = pindex;
		(void) mutex_unlock(&bus_lock);
		return (p_info[pindex].sym_hdl[sym_index]);
	}
}

/*
 * Used to find the plugin whose bus links this device ptr
 * We will walk the bus list and then traverse the device list
 * of each bus to find the matching device
 * Once we have a match we know the bus that this device hangs off of
 * so we do backtrack and find a match for this bus and plugins.
 * A match means we have a plugin index which essentially tells us
 * the plugin to use
 */
static int
get_index_devicep(struct usb_device *device)
{
	int			pindex = 0;
	struct usb_device	*devicep;
	struct usb_bus		*busp;

	busp = usb_busses;
	while (busp != NULL) {
		usb_dprintf(DEBUG_DETAILED,
		    "get_index_: busp is 0x%x\n", busp);
		for (devicep = busp->devices; devicep != NULL;
		    devicep = devicep->next) {
			usb_dprintf(DEBUG_DETAILED,
			    "devicep = 0x%x\n", devicep);
			if (devicep == device) {
				for (pindex = 0; pindex <
				    winfo.ploaded; pindex ++) {
					if (p_info[pindex].busp == busp) {
						usb_dprintf(DEBUG_DETAILED,
						    "devicep: pindex = %d\n",
						    pindex);
						return (pindex);
					}
				}
			}
		}
		busp = busp->next;
	}
	return (FAILURE);
}

static int
load_plugin_syms(plugin_info_t *p_info, void *handle, int pindex)
{
	char	*symbol;
	char	*prefix;
	int	prefix_len = 0;
	int	sym_len;
	int	sym_idx;
	char	**handle_libusb_prefix;

	handle_libusb_prefix = (char **)(dlsym(handle, "libusb_prefix"));

	/* can have a valid handle but a null prefix */
	if ((handle_libusb_prefix != NULL) &&
	    (*handle_libusb_prefix != NULL)) {
		prefix_len = (int)strlen(*handle_libusb_prefix);
		p_info[pindex].prefix = *handle_libusb_prefix;
	} else {
		p_info[pindex].prefix = NULL;
	}

	prefix = p_info[pindex].prefix;
	if (prefix != NULL) {
		usb_dprintf(DEBUG_FUNCTIONS,
		    "load_plugin_syms():prefix is %s\n", prefix);
	}
	usb_dprintf(DEBUG_DETAILED, "NUM_SYMS is %d\n", NUM_SYMS);
	for (sym_idx = 0; sym_idx < NUM_SYMS; sym_idx ++) {
		sym_len = (int)strlen(sym_names[sym_idx]) + prefix_len + 2;
		symbol = (char *)malloc(sym_len);
		if (symbol == NULL) {
			usb_dprintf(DEBUG_FUNCTIONS,
			    "could not alloc space for prefix\n");
			return (FAILURE);
		}
		wusb_symbol(&symbol, sym_len, prefix, sym_names[sym_idx]);
		p_info[pindex].sym_hdl[sym_idx] =
		    (void *)dlsym(handle, symbol);
		usb_dprintf(DEBUG_DETAILED, "handle[%d]=0x%x, name = %s\n",
		    sym_idx, p_info[pindex].sym_hdl[sym_idx], symbol);
		free(symbol);
	}

	return (SUCCESS);
}

/*
 * Used to form prefixed interface symbols for plugins
 */
static void
wusb_symbol(char **init_str, int len, char *prefix, char *func_name)
{
	if (prefix != NULL) {
		(void) snprintf(*init_str, len, "%s", prefix);
	} else {
		(void) memset(*init_str, 0, len);
	}
	(void) strncat(*init_str, func_name, len);
}

/*
 * Given a device handle map it to a bus
 * if active_index = -1 it means more than
 * a single plugin bus is active so we need
 * walk the dev handles lists. Else active
 * index simply points to the index of the
 * single bus that is active and so we use that
 */
int
get_pindex(struct usb_dev_handle *dev, const char *func)
{
	int	pindex;

	if (dev == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "%s: Invalid device handle \n", func);
		return (-EINVAL);
	}
	if (winfo.active_index == -1) {
		pindex = get_index_devhdl(dev);
		if (pindex < 0) {
			usb_dprintf(DEBUG_FUNCTIONS,
			    "%s: device handle not found\n", func);
			return (-ENODEV);
		}
	} else {
		pindex = winfo.active_index;
	}

	return (pindex);
}

/*
 * Entry points for standard libusb interfaces
 * Given a device handle, device pointer
 * map the device to the bus and call into
 * the loaded module. For calls without
 * arguments - cycle through all modules
 * that are active (per some policies implemented by plugin)
 * and make calls into the implementation specific
 * functions.
 */

/*
 * usb_init() entry point:
 *
 * This will call the libusb-init implementation of each plugin
 * loaded and will determine which busses will be supported.
 * For the plugin busses that are supported usb_init
 * of those plugins will be called. This routine will also
 * invalidate plugin entries that are not supported
 */
void
usb_init(void)
{
	int		pindex;
	boolean_t	exclusive = 0;
	int		(*hdl_libusb_init)(void);
	void		(*hdl_usb_init)(void);
	char		**hdl_libusb_version;
	int		ret;
	char		*func = "usb_init";
	char		*version;
	char		version_store[MAX_VERSION_LEN + 1];
	char		wr_version_store[sizeof (LIBUSB_WRAPPER_VERSION)];
	char		*token;
	char		*wr_token;
	char		*debug_str;
	int		active_count = 0;

	/*
	 * If usb_init() already called then do not reinit
	 */
	if (winfo.head_busp != NULL) {
		return;
	}

	(void) mutex_lock(&bus_lock);

	if ((debug_str = getenv("SUN_LIBUSB_DEBUG")) != NULL) {
		libusb_debug = atoi(debug_str);
	}
	usb_dprintf(DEBUG_FUNCTIONS, "the wrapper's debug level is %d\n",
	    libusb_debug);

	ret = load_plugins();
	if (ret < 0) {
		usb_dprintf(DEBUG_ERRORS,
		    "%s: could not load plugin modules\n", func);
		(void) mutex_unlock(&bus_lock);
		return;
	}

	winfo.exclusive_index = -1;
	winfo.active_index = -1;
	winfo.head_busp = NULL;

	for (pindex = 0; pindex < winfo.ploaded; pindex ++) {
		if (p_info[pindex].p_handle == NULL) {
			continue;
		}
		/* condition for libusb_init not implemented */
		if (check_sym_hdl(pindex, LIBUSB_INIT) < 0) {
			(void) usb_dprintf(DEBUG_RECOVERABLE,
			    "hdl_libusb_init is NULL \n");
			p_info[pindex].exclusive_flag = 0;
			p_info[pindex].active_flag = 1;
			active_count += 1;
			continue;
		}
		hdl_libusb_init =
		    LIBUSB_INIT_CAST(p_info[pindex].sym_hdl[LIBUSB_INIT]);
		ret = (*hdl_libusb_init)();

		(void) usb_dprintf(DEBUG_DETAILED,
		    "%s: libusb_init() returned %d\n",
		    p_info[pindex].p_name, ret);

		switch (ret) {
		case SUCCESS:
			p_info[pindex].exclusive_flag = 0;
			p_info[pindex].active_flag = 1;
			active_count += 1;
			winfo.active_index = pindex;
			break;
		case FAILURE:
			usb_dprintf(DEBUG_FUNCTIONS, "unloading plugin %s\n",
			    p_info[pindex].p_name);
			unload_plugin(pindex);
			continue;
		case PLUGIN_EXCLUSIVE:
			/* first plugin to set exclusive */
			if (exclusive != 1) {
				p_info[pindex].exclusive_flag = 1;
				exclusive = 1;
				winfo.exclusive_index = pindex;
			}
			p_info[pindex].active_flag = 1;
			active_count += 1;
			break;
		default:
			usb_dprintf(DEBUG_RECOVERABLE, "unsupported return"
			    "value for libusb_init\n");
		}

		/*
		 * If there is no version defined we accept it
		 * but if there is a version mismatch we will skip
		 */
		if (check_sym_hdl(pindex, LIBUSB_VERSION) < 0) {
			usb_dprintf(DEBUG_RECOVERABLE,
			    "No Version number for plugin found \n");
		} else {
			hdl_libusb_version = (char **)
			    (p_info[pindex].sym_hdl[LIBUSB_VERSION]);
			if ((version = *hdl_libusb_version) != NULL) {
				if (strlen(version) >  MAX_VERSION_LEN) {
					usb_dprintf(DEBUG_RECOVERABLE,
					    "version string exceeds max"
					    "characters, truncating\n");
				}
				(void) strncpy(version_store, version,
				    MAX_VERSION_LEN);
				token = strtok(version_store, ".");
				(void) strncpy(wr_version_store,
				    LIBUSB_WRAPPER_VERSION,
				    sizeof (wr_version_store));
				wr_token = strtok(wr_version_store, ".");

				/*
				 * Initial wrapper version is 1.1
				 * if plugin major_rev is != wrapper major_rev
				 * then do not load.  If the version is not
				 * supported set active to FALSE
				 */
				usb_dprintf(DEBUG_DETAILED,
				    "plugin rev is %d\n", atoi(token));
				usb_dprintf(DEBUG_DETAILED,
				    "wrapper rev is %d\n", atoi(wr_token));
				if (atoi(token) != atoi(wr_token)) {
					usb_dprintf(DEBUG_ERRORS,
					    "plugin version %s not supported\n",
					    version);
					unload_plugin(pindex);
				}
			}
			winfo.last_pindex = pindex;
		}
		if (active_count != 1) {
			winfo.active_index = -1;
		}
	}
	(void) usb_dprintf(DEBUG_DETAILED,
	    "winfo.ploaded is %d\n", winfo.ploaded);
	for (pindex = 0; pindex < winfo.ploaded; pindex ++) {
		if (p_info[pindex].p_handle == NULL) {
			continue;
		}
		if (exclusive && p_info[pindex].exclusive_flag == 1) {
			winfo.exclusive_index = pindex;
			winfo.active_index = pindex;
		}
		if (exclusive && p_info[pindex].exclusive_flag != 1) {
			unload_plugin(pindex);
		}
		if (p_info[pindex].active_flag) {
			if (check_sym_hdl(pindex, USB_INIT) < 0) {
				usb_dprintf(DEBUG_ERRORS,
				    "could not get symbol for %s\n", func);
			}
			hdl_usb_init = USB_INIT_CAST(p_info[pindex].
			    sym_hdl[USB_INIT]);
			(*hdl_usb_init)();
		}
	}
	(void) mutex_unlock(&bus_lock);
	usb_dprintf(DEBUG_DETAILED, "completed usb init()\n");
}

void
usb_set_debug(int level)
{
	int	pindex;
	char	*func = "usb_set_debug";
	void	(*hdl)(int);
	char	*debug_str;

	/* env debug variables override completely what the app sets */
	if ((debug_str = getenv("SUN_LIBUSB_DEBUG")) != NULL) {
		libusb_debug = atoi(debug_str);

	} else {

		if (level < 0)
			return;

		libusb_debug = level;
	}

	usb_dprintf(DEBUG_FUNCTIONS, "libusb debug level is %d\n",
	    libusb_debug);

	for (pindex = 0; pindex < winfo.ploaded; pindex ++) {
		if (check_sym_hdl(pindex, USB_SET_DEBUG) < 0) {
			usb_dprintf(DEBUG_ERRORS,
			    "could not find symbol for %s\n", func);
			continue;
		}
		hdl = USB_SET_DEBUG_CAST
		    (p_info[pindex].sym_hdl[USB_SET_DEBUG]);
		(*hdl)(libusb_debug);
	}
}

/*
 * This will manage the usb_busses pointer for each plugin
 * The wrapper library will expose its own usb_busses pointer
 * This will be built by loading the plugin usb_busses pointer
 * and linking all the bussses. The wrapper libraries usb_bus
 * pointer will in sync every time usb_find_busses is called.
 * Applications are shielded from the underlying plugin usb_busses
 * pointers.
 * ret_bus is supposed to be the number of busses changed
 * since last call
 */
int
usb_find_busses(void)
{
	int			pindex;
	char			*func = "usb_find_busses";
	int			(*hdl_usb_find_busses)(void);
	struct			usb_bus **hdl_usb_busses;
	int			ret_find_busses[MAX_PLUGINS];
	struct usb_bus		*tmp_usb_busses = NULL;
	struct usb_bus		*mv_usb_busses = NULL;
	struct usb_bus		*last_usb_busses = NULL;
	int			ret_bus = 0;
	int			found_bus = 0;

	(void) mutex_lock(&bus_lock);

	for (pindex = 0; pindex < winfo.ploaded; pindex ++) {
		if (check_sym_hdl(pindex, USB_FIND_BUSSES) < 0) {
			usb_dprintf(DEBUG_ERRORS,
			    "could not get symbol for %s\n", func);
			continue;
		}
		hdl_usb_find_busses =
		    USB_FIND_BUSSES_CAST
		    (p_info[pindex].sym_hdl[USB_FIND_BUSSES]);

		/* calling the find_busses whose symbols can be found */
		ret_find_busses[pindex] = (*hdl_usb_find_busses)();
		ret_bus += ret_find_busses[pindex];

		/*
		 * updated usb_busses pointer for the plugins
		 * this could be NULL
		 */
		if (check_sym_hdl(pindex, USB_BUSSES) < 0) {
			usb_dprintf(DEBUG_ERRORS,
			    "could not get symbol for %s\n", usb_busses);
			p_info[pindex].busp = NULL;
			continue;
		}
		hdl_usb_busses =
		    USB_BUSSES_CAST(p_info[pindex].sym_hdl[USB_BUSSES]);
		p_info[pindex].busp = *hdl_usb_busses;
		usb_dprintf(DEBUG_DETAILED,
		    "usb_bus ptr  = 0x%x\n", p_info[pindex].busp);
		found_bus = 1;
		winfo.last_pindex = pindex;
	}
	if (!found_bus) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find a usb_bus pointer \n");
		(void) mutex_unlock(&bus_lock);
		return (FAILURE);
	}

	/* Init tmp_usb_busses */
	for (pindex = 0; pindex < winfo.ploaded; pindex ++) {
		if (tmp_usb_busses == NULL) {
			if (p_info[pindex].busp == NULL) {
				continue;
			}
			tmp_usb_busses = p_info[pindex].busp;
			winfo.head_busp = tmp_usb_busses;
			mv_usb_busses = tmp_usb_busses;
			while (mv_usb_busses->next != NULL) {
				mv_usb_busses = mv_usb_busses->next;
			}
			last_usb_busses = mv_usb_busses;
			continue;
		}
		if (p_info[pindex].busp == NULL) {
			continue;
		}
		last_usb_busses->next = p_info[pindex].busp;
		mv_usb_busses = p_info[pindex].busp;
		while (mv_usb_busses->next != NULL) {
			mv_usb_busses = mv_usb_busses->next;
		}
		last_usb_busses = mv_usb_busses;
	}
	usb_busses = winfo.head_busp;
	dump_busses();
	(void) mutex_unlock(&bus_lock);

	return (ret_bus);
}

struct usb_dev_handle *
usb_open(struct usb_device *device)
{
	int			pindex;
	struct usb_dev_handle	*dev;
	struct usb_dev_handle	*(*hdl)(struct usb_device *);
	char			*func = "usb_open";

	usb_dprintf(DEBUG_DETAILED, "usb_open: device ptr is 0x%x\n", device);
	if (winfo.active_index == -1) {
		usb_dprintf(DEBUG_DETAILED, "usb_open: active_index = -1 \n");
		pindex = get_index_devicep(device);
		/* could not find this device pointer */
		if (pindex < 0) {
			usb_dprintf(DEBUG_ERRORS,
			    "%s: could not map device pointer to bus\n", func);
			return (NULL);
		}
	} else {
		usb_dprintf(DEBUG_FUNCTIONS,
		    "usb_open: pindex = %d\n", winfo.active_index);
		pindex = winfo.active_index;
	}
	if (check_sym_hdl(pindex, USB_OPEN) < 0) {
		usb_dprintf(DEBUG_ERRORS, "%s: Symbol not found \n", func);
		return (NULL);
	}
	hdl = USB_OPEN_CAST(p_info[pindex].sym_hdl[USB_OPEN]);
	dev = (*hdl)(device);
	if (usb_add_dev(dev, device, pindex) == SUCCESS) {
		return (dev);
	} else {
		usb_dprintf(DEBUG_ERRORS, "%s:No Memory to add device\n", func);
		return (NULL);
	}
}

int
usb_close(usb_dev_handle *dev)
{
	int	pindex;
	int	ret;
	char	*func = "usb_close";
	int	(*hdl)(usb_dev_handle *);

	pindex = get_pindex(dev, func);
	if (pindex < 0) {
		return (pindex);
	}
	if (check_sym_hdl(pindex, USB_CLOSE) < 0) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (FAILURE);
	}
	hdl = USB_CLOSE_CAST(p_info[pindex].sym_hdl[USB_CLOSE]);
	usb_del_dev(dev, pindex);
	ret = (*hdl)(dev);

	return (ret);
}

int
usb_get_string(usb_dev_handle *dev, int index, int langid, char *buf,
	size_t buflen)
{
	char	*func = "usb_get_string";
	int	(*hdl)(usb_dev_handle *, int, int, char *, size_t);

	if ((hdl = USB_GET_STRING_CAST
	    (lookup_sym_hdl(dev, USB_GET_STRING, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, index, langid, buf, buflen));
}

int
usb_get_string_simple(usb_dev_handle *dev, int index, char *buf,
	size_t buflen)
{
	char	*func = "usb_get_string_simple";
	int	(*hdl)(usb_dev_handle *, int, char *, size_t);

	if ((hdl = USB_GET_STRING_SIMPLE_CAST
	    (lookup_sym_hdl(dev, USB_GET_STRING_SIMPLE, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, index, buf, buflen));
}

int
usb_get_descriptor_by_endpoint(usb_dev_handle *dev, int ep,
	unsigned char type, unsigned char index, void *buf, int size)
{
	char	*func = "usb_get_descriptor_by_endpoint";
	int	(*hdl)(usb_dev_handle *, int, unsigned char,
	    unsigned char, void *, int);

	if ((hdl = USB_GET_DESCRIPTOR_BY_ENDPOINT_CAST
	    (lookup_sym_hdl(dev, USB_GET_DESCRIPTOR_BY_ENDPOINT, func)))
	    == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, ep, type, index, buf, size));
}

int
usb_get_descriptor(usb_dev_handle *dev, unsigned char type,
	unsigned char index, void *buf, int size)
{
	char	*func = "usb_get_descriptor";
	int	(*hdl)(usb_dev_handle *, unsigned char,
	    unsigned char, void *, int);

	if ((hdl = USB_GET_DESCRIPTOR_CAST
	    (lookup_sym_hdl(dev, USB_GET_DESCRIPTOR, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, type, index, buf, size));
}

int
usb_bulk_write(usb_dev_handle *dev, int ep, char *bytes, int size, int timeout)
{
	char	*func = "usb_bulk_write";
	int	(*hdl)(usb_dev_handle *, int, char *, int, int);

	if ((hdl = USB_BULK_WRITE_CAST
	    (lookup_sym_hdl(dev, USB_BULK_WRITE, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}
	return (*hdl)(dev, ep, bytes, size, timeout);
}

int
usb_bulk_read(usb_dev_handle *dev, int ep, char *bytes, int size, int timeout)
{
	char	*func = "usb_bulk_read";
	int	(*hdl)(usb_dev_handle *, int, char *, int, int);

	if ((hdl = USB_BULK_READ_CAST
	    (lookup_sym_hdl(dev, USB_BULK_READ, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, ep, bytes, size, timeout));
}

int
usb_interrupt_read(usb_dev_handle *dev, int ep, char *bytes,
	int size, int timeout)
{
	char	*func = "usb_interrupt_read";
	int	(*hdl)(usb_dev_handle *, int, char *, int, int);

	if ((hdl = USB_INTERRUPT_READ_CAST
	    (lookup_sym_hdl(dev, USB_INTERRUPT_READ, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, ep, bytes, size, timeout));
}

int
usb_interrupt_write(usb_dev_handle *dev, int ep, char *bytes,
	int size, int timeout)
{
	char	*func = "usb_interrupt_write";
	int	(*hdl)(usb_dev_handle *, int, char *, int, int);

	if ((hdl = USB_INTERRUPT_WRITE_CAST
	    (lookup_sym_hdl(dev, USB_INTERRUPT_WRITE, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, ep, bytes, size, timeout));
}

int
usb_control_msg(usb_dev_handle *dev, int requesttype, int request,
	int value, int index, char *bytes, int size, int timeout)
{
	char	*func = "usb_control_msg";
	int	(*hdl)(usb_dev_handle *, int, int, int, int, char *, int, int);

	if ((hdl = USB_CONTROL_MSG_CAST
	    (lookup_sym_hdl(dev, USB_CONTROL_MSG, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, requesttype, request, value, index,
	    bytes, size, timeout));
}

int
usb_set_configuration(usb_dev_handle *dev, int configuration)
{
	char	*func = "usb_set_configuration";
	int	(*hdl)(usb_dev_handle *, int);

	if ((hdl = USB_SET_CONFIGURATION_CAST
	    (lookup_sym_hdl(dev, USB_SET_CONFIGURATION, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, configuration));
}

int
usb_claim_interface(usb_dev_handle *dev, int interface)
{
	char	*func = "usb_claim_interface";
	int	(*hdl)(usb_dev_handle *, int);

	if ((hdl = USB_CLAIM_INTERFACE_CAST
	    (lookup_sym_hdl(dev, USB_CLAIM_INTERFACE, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, interface));
}

int
usb_release_interface(usb_dev_handle *dev, int interface)
{
	char	*func = "usb_release_interface";
	int	(*hdl)(usb_dev_handle *, int);

	if ((hdl = USB_RELEASE_INTERFACE_CAST
	    (lookup_sym_hdl(dev, USB_RELEASE_INTERFACE, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, interface));
}

int
usb_set_altinterface(usb_dev_handle *dev, int alternate)
{
	char	*func = "usb_set_altinterface";
	int	(*hdl)(usb_dev_handle *, int);

	if ((hdl = USB_SET_ALTINTERFACE_CAST
	    (lookup_sym_hdl(dev, USB_SET_ALTINTERFACE, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, alternate));
}

int
usb_resetep(usb_dev_handle *dev, unsigned int ep)
{
	char	*func = "usb_resetep";
	int	(*hdl)(usb_dev_handle *, unsigned int);

	if ((hdl = USB_RESETEP_CAST
	    (lookup_sym_hdl(dev, USB_RESETEP, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, ep));
}

int
usb_clear_halt(usb_dev_handle *dev, unsigned int ep)
{

	char	*func = "usb_clear_halt";
	int	(*hdl)(usb_dev_handle *, unsigned int);

	if ((hdl = USB_CLEAR_HALT_CAST
	    (lookup_sym_hdl(dev, USB_CLEAR_HALT, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}

	return ((*hdl)(dev, ep));
}

int
usb_reset(usb_dev_handle *dev)
{
	char	*func = "usb_reset";
	int	(*hdl)(usb_dev_handle *);

	if ((hdl = USB_RESET_CAST
	    (lookup_sym_hdl(dev, USB_RESET, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (-ENOTSUP);
	}
	return ((*hdl)(dev));
}

int
usb_find_devices(void)
{
	int	pindex;
	int	(*hdl_usb_find_devices)(void);
	int	ret_val = 0;
	int	err_store = 0;

	/*
	 * devices can go away here.
	 * devices can get added also.
	 * the dev handles list does not update it only updates
	 * for usb_close and usb_open
	 */
	for (pindex = 0; pindex < winfo.ploaded; pindex ++) {
		if (check_sym_hdl(pindex, USB_FIND_DEVICES) < 0) {
			continue;
		}
		hdl_usb_find_devices = USB_FIND_DEVICES_CAST
		    (p_info[pindex].sym_hdl[USB_FIND_DEVICES]);
		ret_val = (*hdl_usb_find_devices)();
		if (ret_val < 0) {
			err_store = ret_val;
		} else {
			ret_val += ret_val;
		}
	}
	if (!err_store) {
		return (ret_val);
	} else {
		/* return any error for multiple busses */
		return (err_store);
	}
}

struct usb_device *
usb_device(usb_dev_handle *dev)
{
	char			*func = "usb_device";
	struct usb_device	*((*hdl)(usb_dev_handle *));

	if ((hdl = USB_DEVICE_CAST
	    (lookup_sym_hdl(dev, USB_DEVICE, func))) == NULL) {
		usb_dprintf(DEBUG_ERRORS,
		    "could not find symbol for %s\n", func);
		return (NULL);
	}

	return ((*hdl)(dev));
}

/*
 * This returns the wrapper's usb_busses pointer not the plugins
 */
struct usb_bus *
usb_get_busses(void)
{
	return (usb_busses);
}

/*
 * Makes sense to only return a single
 * str error - so using the strerror of the
 * last plugin that was used
 */

char *
usb_strerror(void)
{
	int	pindex;
	char	*func = "usb_strerror";
	char	*(*hdl_usb_strerror)(void);

	/*
	 * usb_strerror is only of interest for the last
	 * call to the plugin. So call it for the last
	 * plugin used
	 */
	for (pindex = 0; pindex < winfo.ploaded;  pindex ++) {
		if (check_sym_hdl(pindex, USB_STRERROR) < 0) {
			usb_dprintf(DEBUG_ERRORS,
			    "could not find symbol for %s\n", func);
			continue;
		}
		if (pindex == winfo.last_pindex) {
			hdl_usb_strerror = USB_STRERROR_CAST
			    (p_info[pindex].sym_hdl[USB_STRERROR]);
			return ((*hdl_usb_strerror)());
		}
	}

	return (NULL);
}

static void
usb_dprintf(int level, char *format, ...)
{
	va_list	ap;
	char	buf[512];

	va_start(ap, format);
	(void) vsnprintf(buf, sizeof (buf), format, ap);
	if (libusb_debug >= level) {
		(void) fprintf(stderr, buf);
	}
	va_end(ap);
}
