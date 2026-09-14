#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parent.parent), **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/saved"):
            self.path = "/preview/index.html"
        super().do_GET()

print("Preview: http://127.0.0.1:8876/preview/index.html", flush=True)
ThreadingHTTPServer(("127.0.0.1", 8876), Handler).serve_forever()
