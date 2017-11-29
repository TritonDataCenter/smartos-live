#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/dkio.h>
#include <sys/vtoc.h>

void
usage(char *argv0) {
	printf("Usage: %s [char dev]\n", argv0);
}

int
main(int argc, char *argv[]) {
	char *devpath = argv[1];
	int devnode;
	struct stat buf;
	int ret;
	int removable;

	if (argc != 2) {
		usage(argv[0]);
		return (-1);
	}

	if ((devnode = open(devpath, O_RDONLY)) < 0) {
		printf("Could not open %s\n", devpath);
		usage(argv[0]);
		return (-1);
	}

	if (fstat(devnode, &buf) == -1 || !S_ISCHR(buf.st_mode)) {
		printf("%s: not a character device\n", devpath);
		usage(argv[0]);
		close(devnode);
		return (-1);
	}

	ret = ioctl(devnode, DKIOCREMOVABLE, &removable);

	if ((ret >= 0) && (removable != 0)) {
		close(devnode);
		return (0);
	}

	close(devnode);
	return (1);
}
