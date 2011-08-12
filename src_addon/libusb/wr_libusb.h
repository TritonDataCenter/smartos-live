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
 * Copyright 2009 Sun Microsystems, Inc.  All rights reserved.
 * Use is subject to license terms.
 */

#ifndef	_WR_LIBUSB_H
#define	_WR_LIBUSB_H

#pragma ident	"@(#)wr_libusb.h	1.4	09/03/24 SMI"

#ifdef	__cplusplus
extern "C" {
#endif

/* debug levels */
#define	DEBUG_NONE		0
#define	DEBUG_ERRORS		1
#define	DEBUG_RECOVERABLE	2
#define	DEBUG_FUNCTIONS		3
#define	DEBUG_DETAILED		4
#define	DEBUG_DATA_DUMP		5

#define	MOD_SUFFIX	".so"

/* consistent with the Makefile VER and mapfiles */
#define	LIBUSB_WRAPPER_VERSION	"1.1"

#define	PLUGIN_EXCLUSIVE 2
#define	MAX_PLUGINS 10
#define	MAX_VERSION_LEN	512
#define	SUCCESS 0
#define	FAILURE -1
#define	DSYM (dlsym((handle), (symbol)))

/* default plugin dir */
#define	PLUGIN_DIR	"/usr/lib/libusb_plugins"

#define	USB_OPEN			0
#define	USB_CLOSE			1
#define	USB_GET_STRING			2
#define	USB_GET_STRING_SIMPLE		3
#define	USB_GET_DESCRIPTOR_BY_ENDPOINT	4
#define	USB_GET_DESCRIPTOR		5
#define	USB_BULK_WRITE			6
#define	USB_BULK_READ			7
#define	USB_INTERRUPT_WRITE		8
#define	USB_INTERRUPT_READ		9
#define	USB_CONTROL_MSG			10
#define	USB_SET_CONFIGURATION		11
#define	USB_CLAIM_INTERFACE		12
#define	USB_RELEASE_INTERFACE		13
#define	USB_SET_ALTINTERFACE		14
#define	USB_RESETEP			15
#define	USB_CLEAR_HALT			16
#define	USB_RESET			17
#define	USB_INIT			18
#define	USB_SET_DEBUG			19
#define	USB_FIND_BUSSES			20
#define	USB_FIND_DEVICES		21
#define	USB_DEVICE			22
#define	USB_GET_BUSSES			23
#define	USB_STRERROR			24
#define	USB_BUSSES			25
#define	LIBUSB_INIT			26
#define	LIBUSB_FINI			27
#define	LIBUSB_VERSION			28

char *sym_names[] = {
	"usb_open",				/* 0 */
	"usb_close",				/* 1 */
	"usb_get_string",			/* 2 */
	"usb_get_string_simple",		/* 3 */
	"usb_get_descriptor_by_endpoint",	/* 4 */
	"usb_get_descriptor",			/* 5 */
	"usb_bulk_write",			/* 6 */
	"usb_bulk_read",			/* 7 */
	"usb_interrupt_write",			/* 8 */
	"usb_interrupt_read",			/* 9 */
	"usb_control_msg",			/* 10 */
	"usb_set_configuration",  		/* 11 */
	"usb_claim_interface",			/* 12 */
	"usb_release_interface",		/* 13 */
	"usb_set_altinterface",			/* 14 */
	"usb_resetep",				/* 15 */
	"usb_clear_halt",			/* 16 */
	"usb_reset",				/* 17 */
	"usb_init",				/* 18 */
	"usb_set_debug",			/* 19 */
	"usb_find_busses",			/* 20 */
	"usb_find_devices",			/* 21 */
	"usb_device",				/* 22 */
	"usb_get_busses",			/* 23 */
	"usb_strerror",				/* 24 */
	"usb_busses", 				/* 25 */
	"libusb_init", 				/* 26 */
	"libusb_fini", 				/* 27 */
	"libusb_version" 			/* 28 */
};

#define	USB_OPEN_CAST			(struct usb_dev_handle *(*) \
					    (struct usb_device *))
#define	USB_CLOSE_CAST			(int (*)(usb_dev_handle *))
#define	USB_GET_STRING_CAST		(int (*) (usb_dev_handle *, int, \
					    int, char *, size_t))
#define	USB_GET_STRING_SIMPLE_CAST	(int (*) (usb_dev_handle *, int, \
					    char *, size_t))
#define	USB_GET_DESCRIPTOR_BY_ENDPOINT_CAST (int (*) (usb_dev_handle *, int, \
					    unsigned char, unsigned char, \
					    void *, int))
#define	USB_GET_DESCRIPTOR_CAST		(int (*)(usb_dev_handle *, unsigned \
					    char, unsigned char, void *, int))
#define	USB_BULK_WRITE_CAST 		(int (*) (usb_dev_handle *, int, \
					    char *, int, int))
#define	USB_BULK_READ_CAST		(int (*) (usb_dev_handle *, int, \
					    char *, int, int))
#define	USB_INTERRUPT_READ_CAST		(int (*) (usb_dev_handle *, \
					    int, char *, int, int))
#define	USB_INTERRUPT_WRITE_CAST	(int (*) (usb_dev_handle *, int, \
					    char *, int, int))
#define	USB_CONTROL_MSG_CAST		(int (*)(usb_dev_handle *, int, int, \
					    int, int, char *, int, int))
#define	USB_SET_CONFIGURATION_CAST	(int (*)(usb_dev_handle *, int))
#define	USB_CLAIM_INTERFACE_CAST	(int (*)(usb_dev_handle *, int))
#define	USB_RELEASE_INTERFACE_CAST	(int (*)(usb_dev_handle *, int))
#define	USB_SET_ALTINTERFACE_CAST	(int (*)(usb_dev_handle *, int))
#define	USB_RESETEP_CAST		(int (*)(usb_dev_handle *, \
					    unsigned int))
#define	USB_CLEAR_HALT_CAST		(int (*)(usb_dev_handle *, \
					    unsigned int))
#define	USB_RESET_CAST			(int (*)(usb_dev_handle *))
#define	USB_INIT_CAST			(void (*)(void))
#define	USB_SET_DEBUG_CAST		(void (*)(int))
#define	USB_FIND_BUSSES_CAST		(int (*)(void))
#define	USB_FIND_DEVICES_CAST		(int (*) (void))
#define	USB_DEVICE_CAST			(struct usb_device *(*) \
					    (usb_dev_handle *))
#define	USB_STRERROR_CAST		(char *(*)(void))
#define	USB_BUSSES_CAST			(struct usb_bus **)
#define	LIBUSB_INIT_CAST		(int (*)(void))
#define	LIBUSB_FINI_CAST		(int (*)(void))

#define	NUM_SYMS			(unsigned int)(sizeof (sym_names) / \
					sizeof (char *))

/*
 * wrapper info structure - maintains wrapper state
 * and plugins data
 */
typedef struct wrapper_info {
	int 	ploaded;		/* highest plugin index */
	int 	last_pindex;		/* last plugin index used by app */
	int 	active_index;		/* used to indicate single plugin */
	int 	exclusive_index;	/* if set then this plugin is excl */
	struct 	usb_bus *head_busp;	/* wrapper combined usb_busses ptr */
} wrapper_info_t;


/*
 * this is the dev_handles struct that each plugin
 * maintains a linked list of
 */
typedef struct dev_handles {
	struct usb_dev_handle 	*dev; 		/* usb.h dev handle */
	struct usb_device 	*device;	/* usb.h device pointer */
	struct dev_handles 	*next;		/* for linked list */
	struct dev_handles 	*prev;
} dev_handles_t;

/*
 * plugin state info
 */
typedef struct plugin_info {
	char 		*p_name;		/* module name */
	char 		*p_path;		/* module path */
	void 		*p_handle;		/* handle to plugin */
	int 		exclusive_flag;		/* plugin exclusivity */
	int 		active_flag;		/* is plugin single */
	char 		*prefix;		/* libusb_prefix symbol val */
	dev_handles_t	*dev_handles;		/* list of open dev hdls */
	struct usb_bus 	*busp;			/* plugin bus pointer */
	void 		*sym_hdl[NUM_SYMS];	/* plugin symbols */
} plugin_info_t;

#ifdef	__cplusplus
}
#endif

#endif /* _WR_LIBUSB_H */
