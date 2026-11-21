"""Offline safety tests for the optional GoreeCloud VPS service CLI."""
import importlib.machinery
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = Path(os.environ.get("GC_CLI_BIN", str(Path(__file__).with_name("gc-services.py"))))
loader = importlib.machinery.SourceFileLoader("gc_services_under_test", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)

class CLIContractTests(unittest.TestCase):
    def test_api_prefix_enforcement(self):
        self.assertEqual(mod.checked_path("vikunja", "/api/v1/projects?per_page=10"), "/api/v1/projects?per_page=10")
        self.assertEqual(mod.checked_path("plane", "/api/v1/workspaces/test/projects/"), "/api/v1/workspaces/test/projects/")
        self.assertEqual(mod.checked_path("adguard", "/control/status"), "/control/status")
        for service, path in [
            ("vikunja", "https://attacker.invalid/api/v1/projects"),
            ("vikunja", "//attacker.invalid/api/v1/projects"),
            ("vikunja", "/api/v1/../../admin"),
            ("vikunja", "/api/v1/%2e%2e/admin"),
            ("vikunja", "/api/v1/%2f%2fevil"),
            ("vikunja", "/api/v1/users#fragment"),
            ("plane", "/control/status"),
            ("adguard", "/api/v1/projects"),
        ]:
            with self.subTest(service=service, path=path), self.assertRaises(SystemExit):
                mod.checked_path(service, path)

    def test_mutation_requires_confirm_before_loading_credential(self):
        cp = subprocess.run([sys.executable, str(SCRIPT), "api", "adguard", "POST",
                             "/control/filtering/refresh"],
                            capture_output=True, text=True, timeout=5)
        self.assertNotEqual(cp.returncode, 0)
        self.assertIn("Writes require --confirm-write", cp.stderr)

    def test_caddy_reload_requires_confirm(self):
        cp = subprocess.run([sys.executable, str(SCRIPT), "caddy", "reload"],
                            capture_output=True, text=True, timeout=5)
        self.assertNotEqual(cp.returncode, 0)
        self.assertIn("requires --confirm-write", cp.stderr)

    def test_login_requires_private_terminal(self):
        cp = subprocess.run([sys.executable, str(SCRIPT), "login", "plane"],
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(cp.returncode, 0)
        self.assertIn("private interactive VPS terminal", cp.stderr)

    def test_no_automatic_redirects(self):
        obj = mod.NoRedirect()
        with self.assertRaises(Exception):
            obj.redirect_request(None, None, 302, "Moved", {}, "https://attacker.invalid")

    def test_auth_check_without_credential_fails_closed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, XDG_CONFIG_HOME=tmp)
            cp = subprocess.run([sys.executable, str(SCRIPT), "auth-check", "vikunja"],
                                env=env, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(cp.returncode, 0)
            self.assertIn("No private credential", cp.stderr)

if __name__ == "__main__":
    unittest.main()
