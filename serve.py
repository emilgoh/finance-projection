#!/usr/bin/env python3
"""Development server for the site.

`python3 -m http.server` sends no cache headers, so browsers apply heuristic
caching and happily keep serving a stale `js/app.js` after you have edited it —
the page then renders new markup against old code, which looks like a broken
feature rather than a caching problem. This serves the same files with caching
switched off.

Usage:  ./serve.py [port]        (default 8000)
"""

import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # one tidy line per request
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=".")
    server = HTTPServer(("127.0.0.1", port), handler)
    print(f"Serving http://localhost:{port}  (caching disabled, Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
