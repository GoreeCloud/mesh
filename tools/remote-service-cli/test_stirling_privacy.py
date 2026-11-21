"""Offline privacy, no-overwrite, and mutation-guard tests for Stirling CLI."""
import argparse
import contextlib
import importlib.machinery
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("stirling-pdf.py")
loader = importlib.machinery.SourceFileLoader("stirling_privacy_test", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
cli = importlib.util.module_from_spec(spec)
loader.exec_module(cli)


class ApiPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.original_header = cli.HEADER
        cli.HEADER = self.base / "api-header"
        cli.HEADER.write_text("X-API-KEY: synthetic-not-real\n")
        os.chmod(cli.HEADER, 0o600)
        self.addCleanup(setattr, cli, "HEADER", self.original_header)

    def args(self, method="GET", path="/api/v1/info/uptime", **kwargs):
        return argparse.Namespace(method=method, path=path,
            show_data=kwargs.get("show_data", False),
            output=kwargs.get("output"), confirm_write=kwargs.get("confirm_write", False))

    def test_default_suppresses_body_and_limits_bytes(self):
        observed = []
        def fake_curl(*args, **kwargs):
            observed.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)
        with patch.object(cli, "curl", fake_curl):
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                cli.api(self.args())
        self.assertEqual(len(observed), 1)
        call = observed[0][0]
        self.assertEqual(call[call.index("--output") + 1], "/dev/null")
        self.assertIn("--max-filesize", call)
        self.assertEqual(call[call.index("--max-filesize") + 1], "1048576")
        self.assertNotIn("synthetic-not-real", stdout.getvalue())

    def test_mutations_require_explicit_permission_flag(self):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            with self.subTest(method=method), patch.object(cli, "curl", side_effect=AssertionError("network")):
                with self.assertRaises(SystemExit) as raised:
                    cli.api(self.args(method=method))
                self.assertIn("--confirm-write", str(raised.exception))

    def test_explicitly_confirmed_write_is_allowed_without_secret_leak(self):
        observed = []
        def fake_curl(*args, **kwargs):
            observed.append(args)
            return subprocess.CompletedProcess(args, 0)
        with patch.object(cli, "curl", fake_curl):
            with contextlib.redirect_stdout(io.StringIO()):
                cli.api(self.args(method="POST", confirm_write=True))
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0][observed[0].index("--request") + 1], "POST")
        self.assertIn("--output", observed[0])

    def test_output_creates_private_non_overwriting_file(self):
        dest = self.base / "result.json"
        def fake_curl(*args, **kwargs):
            Path(args[args.index("--output") + 1]).write_text('{"status":"ok"}')
            return subprocess.CompletedProcess(args, 0)
        with patch.object(cli, "curl", fake_curl):
            with contextlib.redirect_stdout(io.StringIO()):
                cli.api(self.args(output=str(dest)))
        self.assertEqual(dest.read_text(), '{"status":"ok"}')
        self.assertEqual(dest.stat().st_mode & 0o777, 0o600)
        with patch.object(cli, "curl", side_effect=AssertionError("network")):
            with self.assertRaises(SystemExit):
                cli.api(self.args(output=str(dest)))

    def test_show_data_and_output_are_mutually_exclusive(self):
        with patch.object(cli, "curl", side_effect=AssertionError("network")):
            with self.assertRaises(SystemExit):
                cli.api(self.args(show_data=True, output=str(self.base / "x")))

    def test_show_data_requires_opt_in(self):
        calls = []
        def fake_curl(*args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0)
        with patch.object(cli, "curl", fake_curl):
            with contextlib.redirect_stdout(io.StringIO()):
                cli.api(self.args(show_data=True))
        self.assertNotIn("--output", calls[0])
        self.assertIn("--max-filesize", calls[0])

    def test_unsafe_host_and_path_rejected_even_with_write_flag(self):
        for unsafe in ("https://attacker.invalid/api/v1/info/uptime",
                       "//attacker.invalid/api/v1/info",
                       "/api/v1/../../admin",
                       "/api/v1/info#evil",
                       "/api/v1/info\r\nX-API-KEY: x"):
            with self.subTest(unsafe=unsafe), patch.object(cli, "curl", side_effect=AssertionError("network")):
                with self.assertRaises(SystemExit):
                    cli.api(self.args(path=unsafe, method="POST", confirm_write=True))


if __name__ == "__main__":
    unittest.main()
