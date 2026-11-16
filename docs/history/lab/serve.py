#!/usr/bin/env python3
"""Serve an RPG Maker MV `www` folder over HTTP for the WPE experiment.

The game files are never modified. The test harness is added by rewriting
`index.html` in memory as it is served.
"""
import http.server
import os
import sys

WWW = os.path.abspath(sys.argv[1])
HARNESS = os.path.abspath(sys.argv[2])
PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 8000
TAG = (b'<script type="text/javascript" src="/__harness.js"></script>'
       b'<script type="text/javascript" src="/__overlay/event-culling.js"></script>')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WWW, **kwargs)

    def log_message(self, fmt, *args):
        # Only report failed requests: a 404 is a missing asset or a
        # letter-case mismatch, which is what this experiment looks for.
        if len(args) > 1 and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("[HTTP] " + (fmt % args) + "\n")

    def _send(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/__harness.js":
            with open(HARNESS, "rb") as fh:
                return self._send(fh.read(), "application/javascript")
        if path.startswith("/__overlay/"):
            # Experimental in-memory patches, kept outside the game folder.
            name = os.path.basename(path)
            with open(os.path.join(os.path.dirname(HARNESS), "overlays", name), "rb") as fh:
                return self._send(fh.read(), "application/javascript")
        if path.startswith("/__lab/"):
            # Stand-alone probe pages kept next to this script.
            name = os.path.basename(path)
            with open(os.path.join(os.path.dirname(HARNESS), "probes", name), "rb") as fh:
                return self._send(fh.read(), "text/html")
        if path in ("/", "/index.html"):
            with open(os.path.join(WWW, "index.html"), "rb") as fh:
                html = fh.read()
            # Load the harness before the game's own scripts so its error
            # hooks are in place first.
            html = html.replace(b"<body", TAG + b"<body", 1)
            return self._send(html, "text/html")
        return super().do_GET()


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
