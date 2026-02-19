#!/usr/bin/env python
"""
RunIQ local dev server
- Serves static files on port 8080
- Proxies /api/anthropic -> https://api.anthropic.com (bypasses CORS)

Usage: python proxy.py
"""
import http.server
import urllib.request
import urllib.error
import json
import os

PORT = 8080
ANTHROPIC_API = "https://api.anthropic.com"

class Handler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path.startswith("/api/anthropic"):
            self._proxy_anthropic()
        else:
            self.send_response(404)
            self.end_headers()

    def _proxy_anthropic(self):
        # Strip /api/anthropic prefix to get the real path
        real_path = self.path.replace("/api/anthropic", "", 1)
        url = ANTHROPIC_API + real_path

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        # Forward all anthropic headers from the request
        headers = {}
        for h in ["x-api-key", "anthropic-version", "anthropic-dangerous-client-side-api-keys", "content-type"]:
            val = self.headers.get(h)
            if val:
                headers[h] = val

        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err_body)
        except Exception as e:
            self.send_response(500)
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, x-api-key, anthropic-version, anthropic-dangerous-client-side-api-keys")

    def log_message(self, fmt, *args):
        # Clean up log output
        if "/api/anthropic" in args[0]:
            print(f"  [proxy] {args[0]} {args[1]}")
        else:
            super().log_message(fmt, *args)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"\n  RunIQ Dev Server running at http://localhost:{PORT}")
    print(f"  Anthropic API proxy at http://localhost:{PORT}/api/anthropic")
    print(f"  Press Ctrl+C to stop\n")
    with http.server.HTTPServer(("", PORT), Handler) as httpd:
        httpd.serve_forever()
