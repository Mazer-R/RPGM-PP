#!/usr/bin/env python3
"""Shows the handheld's screen in a web browser on this computer.

The handheld has no screen-sharing service, but its screen memory can be
read over adb or ssh. This serves a small page on http://localhost:8765 that keeps
asking for the current picture; each picture is copied from the handheld's
framebuffer, so expect about two pictures per second, not smooth video. It
only reads: nothing on the handheld is changed apart from one temporary file
in /tmp.

Usage: python3 tools/screen_view.py [port]
Needs a way to reach the handheld:
  - over USB: adb on PATH or in $ADB, the handheld in ADB mode; or
  - over the network: $SSH_HOST set (for example root@<console-address>) and,
    optionally, $SSH_KEY naming the private key to use.
"""
import http.server
import os
import struct
import subprocess
import sys
import tempfile
import threading

ADB = os.environ.get("ADB", "adb")
SSH_HOST = os.environ.get("SSH_HOST", "")
# One shared connection is kept open, so each picture does not log in again.
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=8",
       "-o", "ControlMaster=auto", "-o", "ControlPersist=120",
       "-o", "ControlPath=" + os.path.expanduser("~/.ssh/potato-player-%C")]  # must be a short path
if os.environ.get("SSH_KEY"):
    SSH += ["-i", os.environ["SSH_KEY"]]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
REMOTE = "/tmp/potato-player-screen.raw"
LOCAL = os.path.join(tempfile.gettempdir(), "potato-player-screen.raw")
LOCK = threading.Lock()

PAGE = b"""<!doctype html><meta charset="utf-8"><title>Console screen</title>
<style>body{margin:0;background:#111;color:#bbb;font:14px system-ui;display:flex;flex-direction:column;
align-items:center;justify-content:center;min-height:100vh}img{width:min(96vw,960px);image-rendering:pixelated;
background:#000}p{margin:8px}</style>
<img id="screen" alt="console screen"><p id="status">connecting...</p>
<script>
var image = document.getElementById('screen'), status = document.getElementById('status'), count = 0, since = Date.now();
function next() { image.src = '/frame.bmp?' + Date.now(); }
image.onload = function () {
  count++;
  status.textContent = (count * 1000 / (Date.now() - since)).toFixed(1) + ' pictures per second';
  next();
};
image.onerror = function () { status.textContent = 'no picture (is the console connected?)'; setTimeout(next, 1500); };
next();
</script>"""


def run(command):
    """Runs a command on the handheld and returns its output as bytes."""
    prefix = SSH + [SSH_HOST] if SSH_HOST else [ADB, "shell"]
    return subprocess.run(prefix + [command], capture_output=True, timeout=10).stdout


def shell(command):
    return run(command).decode().strip()


def frame():
    """Returns the visible screen as a BMP file, or None."""
    with LOCK:
        try:
            width, height_total = (int(v) for v in shell("cat /sys/class/graphics/fb0/virtual_size").split(","))
            pan_y = int(shell("cat /sys/class/graphics/fb0/pan").split(",")[1])
            stride = int(shell("cat /sys/class/graphics/fb0/stride"))
            # The framebuffer holds two pages; the visible one starts at pan_y.
            height = height_total // 2 if height_total >= 2 * 240 else height_total
            copy = "dd if=/dev/fb0 bs=%d skip=%d count=%d 2>/dev/null" % (stride, pan_y, height)
            if SSH_HOST:
                # ssh carries binary output unchanged, so the pixels come straight back.
                pixels = run(copy)
            else:
                # adb's shell alters binary output, so the copy goes through a
                # file. The trailing echo matters: this adb returns as soon as
                # a command with no output is started, before it has finished.
                if shell(copy + " of=" + REMOTE + "; echo done") != "done":
                    return None
                subprocess.run([ADB, "pull", REMOTE, LOCAL], capture_output=True, timeout=10, check=True)
                with open(LOCAL, "rb") as source:
                    pixels = source.read()
        except (subprocess.SubprocessError, ValueError, IndexError, OSError):
            return None
    if len(pixels) < stride * height:
        return None
    # A BMP with a negative height stores rows top first, as the screen does,
    # and its 32-bit pixels are blue-green-red like the framebuffer's.
    header = struct.pack("<2sIHHI", b"BM", 54 + len(pixels), 0, 0, 54)
    info = struct.pack("<IiiHHIIiiII", 40, stride // 4, -height, 1, 32, 0, len(pixels), 2835, 2835, 0, 0)
    return header + info + pixels


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/frame.bmp"):
            body = frame()
            if body is None:
                self.send_error(503)
                return
            kind = "image/bmp"
        else:
            body, kind = PAGE, "text/html"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print("console screen on http://localhost:%d" % PORT, flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
