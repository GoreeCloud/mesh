"""Offline guard tests for the separately installed Stirling PDF adapter."""
import argparse
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("stirling-pdf.py")
loader = importlib.machinery.SourceFileLoader("stirling_adapter_test", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)

class StirlingAdapterTests(unittest.TestCase):
    def test_private_tty_required_for_enrollment(self):
        proc = subprocess.run([sys.executable, str(SCRIPT), "login"],
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("interactive VPS terminal", proc.stderr)

    def test_header_permission_and_origin_path_fail_closed(self):
        original = mod.HEADER
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "api-header"
            path.write_text("X-API-KEY: synthetic-only\n")
            os.chmod(path, 0o644)
            mod.HEADER = path
            try:
                with self.assertRaises(SystemExit):
                    mod.credential()
                os.chmod(path, 0o600)
                self.assertEqual(mod.credential(), path)
                for unsafe in ["https://attacker.invalid/api/v1/info/uptime",
                               "//attacker.invalid/api/v1/info",
                               "/api/v1/../../control",
                               "/api/v1/info#evil"]:
                    with self.subTest(unsafe=unsafe), self.assertRaises(SystemExit):
                        mod.api(argparse.Namespace(method="GET", path=unsafe))
            finally:
                mod.HEADER = original

if __name__ == "__main__":
    unittest.main()
