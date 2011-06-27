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
 * Test to see if Intel VT-x or AMD-v is supported according to cpuid.
 *
 * Taken from: http://blogs.sun.com/JoeBonasera/entry/detecting_hardware_virtualization_support_for
 *
 * And mofified to state *which* extension is available.
 *
 */
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <stdio.h>
#include <ctype.h>

static const char devname[] = "/dev/cpu/self/cpuid";

#define EAX     0
#define EBX     1
#define ECX     2
#define EDX     3

int
main(int argc, char **argv)
{
        int device;
        uint32_t func;
        uint32_t regs[4];
        uint32_t v;
        int r;
        int bit;
        int nbits;
        char *extension=NULL;

        /*
         * open cpuid device
         */
        device = open(devname, O_RDONLY);
        if (device == -1)
                goto fail;

        func = 0x0;
        if (pread(device, regs, sizeof (regs), func) != sizeof (regs))
                goto fail;

        if (regs[EBX] == 0x68747541 &&
            regs[ECX] == 0x444d4163 &&
            regs[EDX] == 0x69746e65) { /* AuthenticAMD */

                func = 0x80000001;
                r = ECX;
                bit = 2;
                nbits = 1;
                extension = "svm";

        } else if (regs[EBX] == 0x756e6547 &&
            regs[ECX] == 0x6c65746e &&
            regs[EDX] == 0x49656e69) { /* GenuineIntel */

                func = 1;
                r = ECX;
                bit = 5;
                nbits = 1;
                extension = "vmx";

        } else {
                goto fail;
        }

        if (pread(device, regs, sizeof (regs), func) != sizeof (regs))
                goto fail;

        v = regs[r] >> bit;
        if (nbits < 32 && nbits > 0)
                v &= (1 << nbits) - 1;

        if (v)
                printf("%s\n", extension);
        else
                printf("none\n");

        (void) close(device);
        exit(0);

fail:
        printf("unknown\n");
        (void) close(device);
        exit(1);
}
