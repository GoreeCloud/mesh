"""Isolated loopback transport tests: no VPS credentials or production writes."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest

SCRIPT = Path(os.environ.get("GC_CLI_BIN", str(Path(__file__).with_name("gc-services.py"))))
loader = importlib.machinery.SourceFileLoader("gc_cli_loopback_fixture", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)

class APIHandler(BaseHTTPRequestHandler):
    received = []
    def log_message(self, *_):
        return
    def _respond(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
        type(self).received.append((self.command, self.path, dict(self.headers.items()), body))
        response = json.dumps({"fixture": "ok"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)
    def do_GET(self):
        self._respond()
    def do_POST(self):
        self._respond()

class IsolatedTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), APIHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        APIHandler.received = []
        self.original = dict(mod.SERVICES)
        for name, (base, prefix, auth, check) in self.original.items():
            mod.SERVICES[name] = (f"http://127.0.0.1:{self.server.server_port}", prefix, auth, check)

    def tearDown(self):
        mod.SERVICES.clear()
        mod.SERVICES.update(self.original)

    def test_vikunja_bearer_and_json_write_fixture(self):
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            code = mod.request("vikunja", "POST", "/api/v1/projects", data=b'{"title":"sample"}',
                               cfg={"secret":"fixture-bearer-secret"}, quiet=True)
        self.assertEqual(code, 200)
        method, path, headers, body = APIHandler.received[-1]
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/api/v1/projects")
        self.assertEqual(headers["Authorization"], "Bearer fixture-bearer-secret")
        self.assertEqual(body, b'{"title":"sample"}')
        self.assertNotIn("fixture-bearer-secret", log.getvalue())
        self.assertEqual(log.getvalue(), "")

    def test_plane_api_key_header(self):
        with contextlib.redirect_stdout(io.StringIO()):
            mod.request("plane", "GET", "/api/v1/users/me/",
                        cfg={"secret":"fixture-plane-key"}, quiet=True)
        _, _, headers, _ = APIHandler.received[-1]
        self.assertEqual(headers["X-Api-Key"], "fixture-plane-key")

    def test_adguard_basic_only_to_fixed_loopback_fixture(self):
        with contextlib.redirect_stdout(io.StringIO()):
            mod.request("adguard", "GET", "/control/status",
                        cfg={"username":"sample", "secret":"fixture-pass"}, quiet=True)
        _, _, headers, _ = APIHandler.received[-1]
        import base64
        self.assertEqual(headers["Authorization"], "Basic " + base64.b64encode(b"sample:fixture-pass").decode())

    def test_private_response_output_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/"result.json"
            with contextlib.redirect_stdout(io.StringIO()) as out:
                mod.request("vikunja", "GET", "/api/v2/info", cfg={"secret":"fixture"},
                            output=path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(json.loads(path.read_text()), {"fixture": "ok"})
            self.assertNotIn("fixture", out.getvalue())
            with self.assertRaises(SystemExit):
                with contextlib.redirect_stdout(io.StringIO()):
                    mod.request("vikunja", "GET", "/api/v2/info", cfg={"secret":"fixture"}, output=path)

if __name__ == "__main__":
    unittest.main()
