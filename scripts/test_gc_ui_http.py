#!/usr/bin/env python3
"""Local HTTP integration checks for the isolated GC UI Mesh website candidate.

The test server applies a *test interpretation* of the candidate _headers file.
This is NOT a deployment to mesh.goreecloud.com and does not verify CDN behavior,
TLS, DNS, true HTTPS/HSTS enforcement, rollback or production acceptance.
"""
from __future__ import annotations

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit
import re
import unittest

from build_gc_ui_candidate import DIST
from validate_gc_ui_candidate import validate

EXPECTED_ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/404.html": ("404.html", "text/html; charset=utf-8"),
    "/assets/site.css": ("assets/site.css", "text/css; charset=utf-8"),
    "/assets/gc-ui-foundations.css": ("assets/gc-ui-foundations.css", "text/css; charset=utf-8"),
    "/assets/site.js": ("assets/site.js", "text/javascript; charset=utf-8"),
}
EXPECTED_PATTERNS = ("/*", "/assets/*", "/*.html")
KEY = re.compile(r"^[A-Za-z][A-Za-z0-9-]*$")


def parse_headers(content: str) -> dict[str, dict[str, str]]:
    """Fail closed on malformed, duplicate, or unexpected preview policy."""
    parsed: dict[str, dict[str, str]] = {}
    active: str | None = None
    for n, raw in enumerate(content.splitlines(), 1):
        if not raw.strip():
            continue
        if raw.startswith("/") and not raw.startswith("//"):
            pattern = raw.strip()
            if pattern not in EXPECTED_PATTERNS or pattern in parsed or raw != pattern:
                raise ValueError(f"unknown/duplicate/malformed header route at line {n}")
            parsed[pattern] = {}
            active = pattern
            continue
        if active is None or not raw.startswith("  ") or raw.startswith("   "):
            raise ValueError(f"malformed header declaration at line {n}")
        field = raw[2:]
        if ":" not in field:
            raise ValueError(f"missing header value at line {n}")
        key, value = field.split(":", 1)
        value = value.strip()
        if not KEY.fullmatch(key) or not value or "\r" in value or "\n" in value:
            raise ValueError(f"unsafe header declaration at line {n}")
        lowered = key.lower()
        if lowered in parsed[active]:
            raise ValueError(f"duplicate header {key} in route {active}")
        parsed[active][lowered] = value
    if tuple(parsed) != EXPECTED_PATTERNS:
        raise ValueError("missing or reordered preview header routes")
    required = {
        "content-security-policy": ("default-src 'self'", "script-src 'self'",
             "style-src 'self'", "connect-src 'none'", "object-src 'none'",
             "frame-ancestors 'none'", "base-uri 'none'"),
        "strict-transport-security": ("max-age=31536000",),
        "x-robots-tag": ("noindex",),
        "referrer-policy": ("no-referrer",),
        "x-content-type-options": ("nosniff",),
        "permissions-policy": ("camera=()", "microphone=()", "geolocation=()"),
        "cross-origin-opener-policy": ("same-origin",),
        "x-frame-options": ("DENY",),
    }
    root = parsed["/*"]
    for name, fragments in required.items():
        if name not in root or any(part not in root[name] for part in fragments):
            raise ValueError("missing preview security contract: " + name)
    if parsed["/assets/*"].get("cache-control") != "public, max-age=300, must-revalidate":
        raise ValueError("preview static assets have unexpected cache policy")
    if parsed["/*.html"].get("cache-control") != "no-cache":
        raise ValueError("preview HTML has unexpected cache policy")
    return parsed


def effective_headers(path: str, policy: dict[str, dict[str, str]]) -> dict[str, str]:
    headers = dict(policy["/*"])
    if path.startswith("/assets/"):
        headers.update(policy["/assets/*"])
    if path.endswith(".html") or path == "/":
        headers.update(policy["/*.html"])
    return headers


def make_handler(dist: Path, policy: dict[str, dict[str, str]]):
    class CandidatePreviewHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def _respond(self, with_body: bool):
            path = urlsplit(self.path).path
            # An allowlist is intentional: prevent accidental _headers and
            # SHA256 manifest publication from this test-only HTTP origin.
            match = EXPECTED_ROUTES.get(path)
            status = 200 if match else 404
            relative, kind = match or ("404.html", "text/html; charset=utf-8")
            body = (dist / relative).read_bytes()
            self.send_response(status)
            headers = effective_headers(path if match else "/404.html", policy)
            if not match:
                headers["cache-control"] = "no-store"
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if with_body:
                self.wfile.write(body)

        def do_GET(self):
            self._respond(with_body=True)

        def do_HEAD(self):
            self._respond(with_body=False)

    return CandidatePreviewHandler


@contextmanager
def serve_local_preview(dist: Path, policy):
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(dist, policy))
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=3)


def fetch(base: str, path: str, method: str = "GET"):
    request = Request(base + path, method=method, headers={"Cache-Control": "no-cache"})
    try:
        with urlopen(request, timeout=3) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()


class CandidateLocalHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        validate(DIST, built=True)
        cls.policy = parse_headers((DIST / "_headers").read_text(encoding="utf-8"))
        cls.server = serve_local_preview(DIST, cls.policy)
        cls.base = cls.server.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.server.__exit__(None, None, None)

    def test_root_served_with_headers_and_exact_bytes(self):
        status, headers, body = fetch(self.base, "/")
        self.assertEqual(status, 200)
        self.assertEqual(body, (DIST / "index.html").read_bytes())
        self.assertIn("noindex", headers["X-Robots-Tag"])
        self.assertIn("connect-src 'none'", headers["Content-Security-Policy"])
        self.assertIn("max-age=31536000", headers["Strict-Transport-Security"])
        self.assertEqual(headers["Cache-Control"], "no-cache")
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")

    def test_static_assets_are_local_and_short_cached(self):
        for path in ("/assets/site.css", "/assets/gc-ui-foundations.css", "/assets/site.js"):
            with self.subTest(path=path):
                status, headers, body = fetch(self.base, path)
                self.assertEqual(status, 200)
                self.assertEqual(body, (DIST / path.lstrip("/")).read_bytes())
                self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
                self.assertEqual(headers["Cache-Control"], "public, max-age=300, must-revalidate")
                self.assertEqual(int(headers["Content-Length"]), len(body))

    def test_missing_page_uses_404_html_with_404_status(self):
        status, headers, body = fetch(self.base, "/missing-preview-route")
        self.assertEqual(status, 404)
        self.assertEqual(body, (DIST / "404.html").read_bytes())
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn("noindex", headers["X-Robots-Tag"])

    def test_preview_metadata_not_published_as_assets(self):
        for path in ("/_headers", "/SHA256SUMS.json", "/assets/glaze.css"):
            with self.subTest(path=path):
                status, _, body = fetch(self.base, path)
                self.assertEqual(status, 404)
                self.assertEqual(body, (DIST / "404.html").read_bytes())

    def test_head_and_get_agree_on_size_and_protection(self):
        head_status, head_headers, head_body = fetch(self.base, "/assets/site.css", "HEAD")
        get_status, get_headers, get_body = fetch(self.base, "/assets/site.css")
        self.assertEqual((head_status, get_status), (200, 200))
        self.assertFalse(head_body)
        self.assertEqual(head_headers["Content-Length"], str(len(get_body)))
        self.assertEqual(head_headers["Content-Security-Policy"],
                         get_headers["Content-Security-Policy"])

    def test_invalid_header_policy_fails_closed(self):
        valid = (DIST / "_headers").read_text(encoding="utf-8")
        for changed in (valid.replace("connect-src 'none'", "connect-src *"),
                        valid.replace("X-Robots-Tag: noindex", "X-Robots-Tag: index"),
                        valid.replace("Cache-Control: no-cache", "Cache-Control: public"),
                        valid.replace("/*\n", "/*\n  Referrer-Policy: unsafe-url\n")):
            with self.subTest(sample=changed[:40]):
                with self.assertRaises(ValueError):
                    parse_headers(changed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
