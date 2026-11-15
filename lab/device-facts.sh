#!/bin/sh
# Read-only fact sheet for the target handheld. Prints what the experiments
# need to know about the system: CPU, memory, display stack, C library and
# storage. It changes nothing on the device.
#
# Run from the development machine:
#   ssh root@<device-ip> sh < lab/device-facts.sh | tee lab/out/device-facts.txt
echo "=== kernel ==="; uname -a
echo "=== os ==="; cat /etc/os-release 2>/dev/null | head -6
for f in /opt/muos/config/version.txt /opt/muos/config/system/version /opt/muos/version.txt; do
  [ -f "$f" ] && echo "muOS version ($f): $(cat "$f")"
done
echo "=== cpu ==="; grep -m1 -E "model name|Hardware" /proc/cpuinfo; grep -m1 "CPU part" /proc/cpuinfo
echo "cores: $(grep -c ^processor /proc/cpuinfo)"; grep -m1 Features /proc/cpuinfo
echo "userland: $(getconf LONG_BIT 2>/dev/null) bit"
echo "=== memory ==="; free -m 2>/dev/null || cat /proc/meminfo | head -6
echo "--- swap ---"; cat /proc/swaps
echo "=== display ==="; ls -l /dev/dri /dev/fb* /dev/mali* 2>&1
cat /sys/class/graphics/fb0/virtual_size 2>/dev/null | sed 's/^/fb0 size: /'
echo "=== c library ==="; ls /lib/libc.so* /lib/ld-* /lib/aarch64-linux-gnu/libc.so* 2>/dev/null
(ldd --version 2>&1 || true) | head -2
echo "=== graphics and audio libraries ==="
ls /usr/lib /usr/lib64 /lib /usr/lib/aarch64-linux-gnu 2>/dev/null \
  | grep -iE "gbm|mali|EGL|GLES|SDL2|wayland|drm|asound|pulse" | sort -u
echo "=== storage ==="; mount | grep -iE "mmc|sd[a-z]"; df -h 2>/dev/null | grep -iE "mmc|sd[a-z]|Filesystem"
echo "=== tools ==="; for t in node python3 gdb strace file; do printf "%s: " "$t"; command -v "$t" || echo "-"; done
echo "=== top memory users ==="; ps -o rss,comm 2>/dev/null | sort -rn | head -6 || ps | head -12
