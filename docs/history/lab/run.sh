#!/bin/sh
# Runs inside the container: serve the game, start cog headless, sample memory.
# Usage: run.sh <seconds>
DURATION="${1:-110}"
python3 /lab/serve.py /lab/game/www /lab/harness.js 8000 &
sleep 1
export XDG_RUNTIME_DIR=/tmp LIBGL_ALWAYS_SOFTWARE=1
cog -P headless \
    --enable-write-console-messages-to-stdout=true \
    --enable-webgl=true \
    --media-playback-requires-user-gesture=false ${COG_EXTRA} \
    "${URL:-http://127.0.0.1:8000/index.html}" 2>&1 | grep -v "^$" &
i=0
while [ "$i" -lt "$DURATION" ]; do
  sleep 5; i=$((i + 5))
  web=$(pgrep -o WPEWebProcess)
  anon_web=$(awk '/^Anonymous:/{print $2}' /proc/$web/smaps_rollup 2>/dev/null)
  pss_web=$(awk '/^Pss:/{print $2}' /proc/$web/smaps_rollup 2>/dev/null)
  # memory.stat separates program memory (anon, shmem) from disk cache (file).
  anon=$(awk '/^anon /{print $2}' /sys/fs/cgroup/memory.stat)
  shmem=$(awk '/^shmem /{print $2}' /sys/fs/cgroup/memory.stat)
  file=$(awk '/^file /{print $2}' /sys/fs/cgroup/memory.stat)
  echo "[MEM] t=${i}s web_pss_mb=$(( ${pss_web:-0} / 1024 )) web_anon_mb=$(( ${anon_web:-0} / 1024 )) cg_anon_mb=$(( anon / 1048576 )) cg_shmem_mb=$(( shmem / 1048576 )) cg_file_mb=$(( file / 1048576 )) cg_peak_mb=$(( $(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0) / 1048576 ))"
done
  echo "[MEM] t=${i}s pss_all_mb=$((pss / 1024)) cgroup_current_mb=$(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) cgroup_peak_mb=$(( $(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0) / 1048576 ))"
done
# Largest anonymous regions of the page process, grouped by region size.
echo "[SMAPS]"
awk '/^[0-9a-f]+-[0-9a-f]+ /{name=$6} /^Rss:/{rss=$2} /^Anonymous:/{if($2>4096){n[name==""?"(anon)":name]+=$2; c[name==""?"(anon)":name]++}} END{for(k in n) printf "%7d MB in %4d regions  %s\n", n[k]/1024, c[k], k}' /proc/$(pgrep -o WPEWebProcess)/smaps | sort -rn | head -8
echo "[PROC]"; ps -eo rss,comm --sort=-rss | head -8
