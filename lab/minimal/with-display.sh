#!/bin/sh
# Runs a command inside the container with a virtual X display, which the
# WebGL library needs to create a context. Started by hand because the usual
# `xvfb-run` wrapper hangs in this container.
Xvfb :99 -screen 0 1024x768x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
i=0
while [ ! -e /tmp/.X11-unix/X99 ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
export DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1
exec "$@"
