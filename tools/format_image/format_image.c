/*
 * This file and its contents are supplied under the terms of the
 * Common Development and Distribution License ("CDDL"), version 1.0.
 * You may only use this file in accordance with the terms of version
 * 1.0 of the CDDL.
 *
 * A full copy of the text of the CDDL should have accompanied this
 * source.  A copy of the CDDL is also available via the Internet at
 * http://www.illumos.org/license/CDDL.
 *
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * As the build runs in a non-global zone, we don't have the luxury of tools
 * such as labeled lofi, format, etc. in order to create the USB image.  We are
 * looking to create an image of the following form:
 *
 * Part Tag      First Sector Size     Type
 * -    mbr/GPT  0            1MB      MBR+EFI GPT (-m option plus libefi)
 * 0    system   2048         256MB    EFI System Partition (-e option)
 * 1    boot     526336       1MB      Legacy BIOS boot partition (-b option)
 * 2    root     528384       3.46GB   pcfs or ufs root
 * 8    reserved 7796083      8MB      V_RESERVED / devid (not really used)
 *
 * This boots under BIOS as follows:
 *
 * 1. BIOS loads the MBR, which jumps to stage2_sector (see pmbr.s)
 * 2. stage2 is a modified gptzfsboot, in partition 1 above
 * 3. despite the name, this can also load pcfs/ufs - partition 2 above.
 *    To find the partition, there is a weirdo fake multiboot header embedded
 *    that we need to update with the starting LBA of partition 2.
 * 4. This then boots into loader
 * 5. which finally will load the kernel
 *
 * On a UEFI system:
 *
 * 1. BIOS finds the ESP at partition 0, and loads /EFI/BOOT/BOOTX64.EFI
 *    as defined by the EFI spec. This is "loader"
 * 2. loader loads kernel from the pcfs/ufs root from partition 2
 * 3. kernel takes control
 *
 * So this tool needs to fix up then write a modified MBR, populate the GPT
 * header and partition tables, and write out the ESP and biosboot images.
 * It is sort of an unholy merger of zpool_label_disk(ZPOOL_CREATE_BOOT_LABEL)
 * and installboot(8).
 *
 * We only currently support 512 block size, and the code isn't endian-vetted.
 *
 * The "root" partition is populated later, not by this tool. This is the main
 * reason we megabyte-align the partitions: it's much faster if we can dd with
 * a larger block size.
 */

#include <uuid/uuid.h>
#include <strings.h>
#include <string.h>
#include <assert.h>
#include <unistd.h>
#include <stdarg.h>
#include <stdlib.h>
#include <libgen.h>
#include <fcntl.h>
#include <stdio.h>
#include <errno.h>
#include <err.h>

#include <sys/efi_partition.h>
#include <sys/dktp/fdisk.h>
#include <sys/sysmacros.h>
#include <sys/types.h>
#include <sys/vtoc.h>
#include <sys/stat.h>

#define	EXIT_USAGE (2)

/*
 * From installboot.h, these are a set of offsets into the MBR.
 */
#define	SECTOR_SIZE (512)
#define	STAGE1_STAGE2_SIZE (0xfc)  /* 16bits */
#define	STAGE1_STAGE2_LBA (0xfe)  /* 64bits */
#define	STAGE1_STAGE2_UUID (0x106) /* 128bits */
#define	STAGE1_MBR_VERSION (0xfa) /* 2 bytes, major/minor */
#define	STAGE1_BPB_OFFSET (0x3)   /* technically BPB starts at 0xb */
#define	STAGE1_BPB_SIZE (0x3b)
#define	STAGE1_MAGIC (0x1fe) /* 0xAA55 */

/*
 * From multiboot.h
 */
#define	MB_HEADER_MAGIC		 0x1BADB002	/* magic */

#define	LBSIZE (SECTOR_SIZE)
#define	MB_BLOCKS (2048) /* 1Mb in blocks */
#define	PART_ALIGN (MB_BLOCKS * SECTOR_SIZE)
#define	LEGACY_BOOTPART_BLOCKS (MB_BLOCKS) /* in LBSIZE */
#define	LEGACY_BOOTPART_SIZE (LEGACY_BOOTPART_BLOCKS * LBSIZE)

/*
 * Space for MBR+GPT prior to first partition, aligned up to the first MB.
 */
#define	START_SECT (MB_BLOCKS)

/*
 * These define the basic layout of a USB key image, and are sniffed by
 * /lib/sdc/usb-key.sh (and potentially elsewhere).  The legacy grub key is
 * implicitly version 1.  A revision of IMAGE_MAJOR implies that old code cannot
 * successfully mount the root of the USB key image in the expected place (that
 * is, slice 2).
 */
#define	IMAGE_MAJOR (2)
#define	IMAGE_MINOR (0)

typedef struct multiboot_header {
	uint32_t	magic;
	uint32_t	flags;
	uint32_t	checksum;
	caddr32_t	header_addr;
	caddr32_t	load_addr;
	caddr32_t	load_end_addr;
	caddr32_t	bss_end_addr;
	caddr32_t	entry_addr;
} multiboot_header_t;

static const char *progname;
static size_t biosboot_start;
static int outfile;

static void
usage(const char *fmt, ...)
{
	if (fmt != NULL) {
		va_list ap;

		va_start(ap, fmt);
		vwarnx(fmt, ap);
		va_end(ap);
	}

	(void) fprintf(stderr,
	    "Usage: %s -o image.usb -m mbr -e efifs -b biosboot\n"
	    "\n"
	    "Format a USB/ISO image for booting SmartOS or Triton.\n"
	    "\n"
	    "\t-o  output file\n"
	    "\t-m  MBR image\n"
	    "\t-e  EFI system partition (ESP) pcfs image\n"
	    "\t-b  Legacy BIOS stage2 boot program (gptzfsboot)\n",
	    progname);

	exit(fmt == NULL ? EXIT_SUCCESS : EXIT_USAGE);
}

static char *
read_file(const char *path, size_t size, size_t *lenp)
{
	struct stat st;
	ssize_t ret;
	size_t left;
	char *buf;
	char *pos;
	int fd;

	if ((fd = open(path, O_RDONLY)) == -1)
		err(EXIT_FAILURE, "couldn't open %s", path);

	if (fstat(fd, &st) != 0)
		err(EXIT_FAILURE, "couldn't stat %s", path);

	if (size != 0 && st.st_size > size) {
		errx(EXIT_FAILURE, "file %s exceeds maximum %lu bytes",
		    path, size);
	}

	if (size == 0)
		size = st.st_size;

	if ((buf = calloc(1, size)) == NULL)
		err(EXIT_FAILURE, "couldn't alloc buf for %s", path);

	for (left = st.st_size, pos = buf; left; pos += ret, left -=ret) {
		ret = read(fd, pos, left);

		if (ret < 0)
			err(EXIT_FAILURE, "couldn't read from %s", path);
	}

	if (lenp != NULL)
		*lenp = st.st_size;
	return (buf);
}

static void
write_mbr(char *mbr, size_t esplen, size_t biosbootlen)
{
	uint64_t *stage2_lbap = (uint64_t *)(mbr + STAGE1_STAGE2_LBA);
	uint16_t *stage2_sizep = (uint16_t *)(mbr + STAGE1_STAGE2_SIZE);
	uint8_t *stage1_major = (uint8_t *)(mbr + STAGE1_MBR_VERSION);
	uint8_t *stage1_minor = (uint8_t *)(mbr + STAGE1_MBR_VERSION + 1);
	uchar_t *uuidp = (uchar_t *)(mbr + STAGE1_STAGE2_UUID);

	*stage2_lbap = START_SECT + esplen / LBSIZE;
	*stage2_sizep = biosbootlen / LBSIZE;
	*stage1_major = IMAGE_MAJOR;
	*stage1_minor = IMAGE_MINOR;

	/*
	 * This is all "nops" in the MBR image: let's clear it out like
	 * installboot(8) does.
	 */
	bzero(mbr + STAGE1_BPB_OFFSET, STAGE1_BPB_SIZE);

	uuid_generate(uuidp);

	if (pwrite(outfile, mbr, SECTOR_SIZE, 0) != SECTOR_SIZE)
		err(EXIT_FAILURE, "failed to write MBR");
}

static void
set_part(struct dk_part *part, diskaddr_t start, diskaddr_t size,
    const char *name, ushort_t tag)
{
	if (tag != V_RESERVED) {
		assert((start % MB_BLOCKS) == 0);
		assert((size % MB_BLOCKS) == 0);
	}

	printf("%s %d %llu %llu\n", name, tag, start * LBSIZE, size * LBSIZE);

	part->p_start = start;
	part->p_size = size;
	if (strlcpy(part->p_name, name, sizeof (part->p_name)) >=
	    sizeof (part->p_name))
		errx(EXIT_FAILURE, "partition name %s is too long", name);

	part->p_tag = tag;
}

static void
write_efi(size_t esplen)
{
	struct dk_gpt *vtoc;
	diskaddr_t start = START_SECT;
	diskaddr_t size;
	int ret;

	if (efi_alloc_and_init(outfile, EFI_NUMPAR, &vtoc) != 0)
		err(EXIT_FAILURE, "failed to init EFI");

	set_part(&vtoc->efi_parts[0], start, esplen / LBSIZE,
	    "loader", V_SYSTEM);

	start += esplen / LBSIZE;
	biosboot_start = start;

	set_part(&vtoc->efi_parts[1], start, LEGACY_BOOTPART_BLOCKS,
	    "boot", V_BOOT);

	start += LEGACY_BOOTPART_BLOCKS;

	size = vtoc->efi_last_u_lba + 1 - (EFI_MIN_RESV_SIZE + start);
	size = P2ALIGN(size, MB_BLOCKS);

	set_part(&vtoc->efi_parts[2], start, size, "root", V_ROOT);

	start = vtoc->efi_last_u_lba + 1 - EFI_MIN_RESV_SIZE;

	set_part(&vtoc->efi_parts[8], start, EFI_MIN_RESV_SIZE,
	    "reserved", V_RESERVED);

	/*
	 * This also updates the PMBR for the protective partition.
	 */
	if ((ret = efi_write(outfile, vtoc)) != 0)
		errx(EXIT_FAILURE, "failed to write EFI with %d", ret);

	efi_free(vtoc);
}

static void
write_esp(char *esp, size_t esplen)
{
	if (pwrite(outfile, esp, esplen, START_SECT * LBSIZE) != esplen)
		err(EXIT_FAILURE, "failed to write ESP");
}

static multiboot_header_t *
find_multiboot(char *biosboot, size_t biosbootlen)
{
	for (size_t off = 0; off < biosbootlen; off +=4) {
		multiboot_header_t *mb = (multiboot_header_t *)(biosboot + off);

		if (mb->magic != MB_HEADER_MAGIC)
			continue;

		if (-(mb->flags + mb->magic) != mb->checksum)
			continue;

		return (mb);
	}

	return (NULL);
}

/*
 * Before we can write out gptzfsboot we need to update its embedded
 * multiboot_header_t: the ->bss_end_addr offset is examined to figure out the
 * root partition's start sector (see sys/boot/common/multiboot.S).  Whoever
 * said booting was pleasant?
 */
static void
write_biosboot(char *biosboot, size_t biosbootlen)
{
	/* in sectors */
	multiboot_header_t *multiboot;
	uint64_t *ptr;

	if ((multiboot = find_multiboot(biosboot, biosbootlen)) == NULL)
		errx(EXIT_FAILURE, "couldn't find fake multiboot header");

	ptr = (uint64_t *)&multiboot->bss_end_addr;
	*ptr = biosboot_start + LEGACY_BOOTPART_BLOCKS;

	if (pwrite(outfile, biosboot, LEGACY_BOOTPART_SIZE,
	    biosboot_start * LBSIZE) != LEGACY_BOOTPART_SIZE)
		err(EXIT_FAILURE, "failed to write biosboot");
}

int
main(int argc, char *argv[])
{
	const char *biosbootpath = NULL;
	const char *esppath = NULL;
	const char *mbrpath = NULL;
	const char *outpath = NULL;
	size_t biosbootlen;
	char *biosboot;
	size_t esplen;
	char *esp;
	char *mbr;
	int c;

	progname = basename(argv[0]);

	while ((c = getopt(argc, argv, ":b:e:hm:o:")) != -1) {
		switch (c) {
		case 'b':
			biosbootpath = optarg;
			break;
		case 'e':
			esppath = optarg;
			break;
		case 'o':
			outpath = optarg;
			break;
		case 'm':
			mbrpath = optarg;
			break;
		case 'h':
			usage(NULL);
			break;
		case ':':
			usage("Option -%c requires an operand\n", optopt);
			break;
		case '?':
			usage("Unrecognised option: -%c\n", optopt);
			break;
		}
	}

	if (biosbootpath == NULL || esppath == NULL || mbrpath == NULL ||
	    outpath == NULL)
		usage("missing argument\n");

	if (optind != argc)
		usage("too many arguments\n");

	if ((outfile = open(outpath, O_RDWR)) == -1)
		err(EXIT_FAILURE, "failed to open %s for writing", outpath);

	mbr = read_file(mbrpath, SECTOR_SIZE, NULL);

	if (((struct mboot *)mbr)->signature != MBB_MAGIC) {
		errx(EXIT_FAILURE, "MBR has incorrect magic %hlx",
		    ((struct mboot *)mbr)->signature);
	}

	esp = read_file(esppath, 0, &esplen);

	if (esplen % PART_ALIGN) {
		errx(EXIT_FAILURE, "ESP image is not %lu-byte aligned",
		    PART_ALIGN);
	}

	biosboot = read_file(biosbootpath, LEGACY_BOOTPART_SIZE, &biosbootlen);

	write_mbr(mbr, esplen, biosbootlen);
	write_efi(esplen);
	write_esp(esp, esplen);
	write_biosboot(biosboot, biosbootlen);

	(void) close(outfile);

	return (EXIT_SUCCESS);
}
