#!/bin/sh
# Runs inside the container: start the game, wait, then print which memory
# regions of the page process hold the most resident memory.
python3 /lab/serve.py /lab/game/www /lab/harness.js 8000 &
sleep 1
export XDG_RUNTIME_DIR=/tmp LIBGL_ALWAYS_SOFTWARE=1
cog -P headless --enable-webgl=true ${COG_EXTRA} "${URL:-http://127.0.0.1:8000/index.html?noaudio}" >/dev/null 2>&1 &
sleep "${1:-14}"
pid=$(pgrep -o WPEWebProcess)
awk '/^[0-9a-f]+-[0-9a-f]+ /{name=$6; if(name=="")name="(anonymous)"} /^Rss:/{r[name]+=$2; c[name]++} END{for(k in r) if(r[k]>8192) printf "%6d MB %5d regions  %s\n", r[k]/1024, c[k], k}' /proc/$pid/smaps | sort -rn | head -10
echo "threads: $(ls /proc/$pid/task | wc -l)"
echo "anon region sizes (MB resident, top 12):"
awk '/^[0-9a-f]+-[0-9a-f]+ /{name=$6} /^Rss:/{if(name=="" && $2>4096) print int($2/1024)}' /proc/$pid/smaps | sort -rn | head -12 | tr '\n' ' '
