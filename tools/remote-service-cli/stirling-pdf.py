#!/usr/bin/env python3
"""Private Stirling PDF API CLI for GoreeCloud VPS Mesh (no third-party Python deps)."""
import argparse
import getpass
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

BASE = "https://stirling-pdf.goreecloud.com"
HOME = Path.home()
CONF = Path(os.environ.get("XDG_CONFIG_HOME", str(HOME / ".config"))) / "goreecloud" / "stirling-pdf"
HEADER = CONF / "api-header"


def error(message):
    raise SystemExit(f"Error: {message}")


def curl(*arguments, header=None, max_time=60, capture=False):
    cmd = ["curl", "--silent", "--show-error", "--proto", "=https",
           "--max-redirs", "0", "--max-time", str(max_time)]
    if header is not None:
        cmd += ["--header", "@" + str(header)]
    cmd += list(arguments)
    return subprocess.run(cmd, text=True if capture else False,
                          capture_output=capture, check=False)


def credential():
    if HEADER.is_symlink() or not HEADER.is_file():
        error("No locally saved token; run 'stirling-pdf login' in your VPS terminal.")
    metadata = HEADER.stat()
    if metadata.st_uid != os.getuid() or (metadata.st_mode & 0o777) != 0o600:
        error("API header must be owned by you and chmod 600.")
    return HEADER


def auth_code(header):
    result = curl("--output", "/dev/null", "--write-out", "%{http_code}",
                  BASE + "/api/v1/info/uptime", header=header,
                  max_time=25, capture=True)
    if result.returncode != 0:
        error("Could not securely contact Stirling PDF.")
    return result.stdout.strip()


def login(_):
    if not sys.stdin.isatty():
        error("Use an interactive VPS terminal to enter the token privately.")
    CONF.mkdir(parents=True, exist_ok=True, mode=0o700)
    CONF.chmod(0o700)
    if HEADER.is_symlink():
        error("Credential destination is a symlink; refusing to overwrite.")
    token = getpass.getpass("Paste existing Stirling API token (hidden): ")
    if not token or token != token.strip() or not all(33 <= ord(c) <= 126 for c in token):
        error("Token must be nonempty printable ASCII without whitespace.")
    fd, name = tempfile.mkstemp(prefix=".api-header-", dir=CONF)
    path = Path(name)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write("X-API-KEY: " + token + "\n")
        token = None
        code = auth_code(path)
        if code != "200":
            error(f"Token not saved: authentication check returned HTTP {code}.")
        os.replace(path, HEADER)
        HEADER.chmod(0o600)
        print("API token authenticated and saved privately (mode 0600).")
    finally:
        path.unlink(missing_ok=True)


def auth_check(_):
    code = auth_code(credential())
    if code != "200":
        error(f"Authentication failed (HTTP {code}); use 'stirling-pdf login' to replace token.")
    print("Authenticated successfully (HTTP 200) at", BASE)


def status(_):
    response = curl("--fail", BASE + "/api/v1/info/status", max_time=20)
    if response.returncode:
        error("Stirling PDF status check failed.")
    print()


def upload(endpoint, files, output, fields=()):
    header = credential()
    for item in files:
        if not item.is_file():
            error(f"Input file does not exist: {item}")
    if output.exists() or output.is_symlink():
        error(f"Refusing to overwrite existing output: {output}")
    if not output.parent.is_dir():
        error(f"Output directory missing: {output.parent}")
    fd, temp_name = tempfile.mkstemp(prefix=".stirling-pdf-", dir=output.parent)
    os.close(fd)
    temp = Path(temp_name)
    try:
        options = []
        for item in files:
            options += ["--form", "fileInput=@" + str(item) + ";type=application/pdf"]
        for key, value in fields:
            options += ["--form", key + "=" + str(value)]
        response = curl("--fail", "--request", "POST", "--output", str(temp),
                        *options, BASE + endpoint, header=header, max_time=600)
        if response.returncode:
            error("PDF processing API request failed; no output saved.")
        with temp.open("rb") as result:
            if result.read(5) != b"%PDF-":
                error("Unexpected API response: output is not a PDF.")
        # Atomic create without overwriting any file created while processing.
        os.link(temp, output, follow_symlinks=False)
        print("Saved", output)
    finally:
        temp.unlink(missing_ok=True)


def compress(args):
    upload("/api/v1/misc/compress-pdf", [Path(args.input).resolve()],
           Path(args.output).absolute(), [("optimizeLevel", 5)])


def merge(args):
    upload("/api/v1/general/merge-pdfs", [Path(p).resolve() for p in args.inputs],
           Path(args.output).absolute())


def api(args):
    credential_path = credential()
    path = args.path
    if not path.startswith("/api/v1/") or any(c.isspace() for c in path) or \
       ".." in path or "@" in path or "://" in path or "//" in path or "#" in path:
        error("Only a relative /api/v1/... path on the fixed Stirling host is allowed.")
    response = curl("--fail", "--request", args.method, BASE + path,
                    header=credential_path, max_time=60)
    if response.returncode:
        error(f"Stirling PDF API returned a curl error ({response.returncode}).")
    print()


def logout(_):
    credential()
    HEADER.unlink()
    print("Locally stored API header removed; remote API key has NOT been revoked.")


def main():
    parser = argparse.ArgumentParser(description="Stirling PDF CLI (private local token).")
    sub = parser.add_subparsers(dest="command", required=True)
    for cmd, handler, desc in [
        ("status", status, "Check public health without a token"),
        ("login", login, "Privately enroll your existing token"),
        ("auth-check", auth_check, "Validate saved API token"),
        ("logout", logout, "Remove locally stored token")]:
        sub.add_parser(cmd, help=desc).set_defaults(func=handler)
    p = sub.add_parser("compress", help="Compress a PDF without overwriting output")
    p.add_argument("input")
    p.add_argument("output")
    p.set_defaults(func=compress)
    p = sub.add_parser("merge", help="Merge two or more PDF files")
    p.add_argument("output")
    p.add_argument("inputs", nargs="+")
    p.set_defaults(func=merge)
    p = sub.add_parser("api", help="Call a fixed-origin API endpoint without leaking the key")
    p.add_argument("method", choices=["GET", "POST", "PUT", "PATCH", "DELETE"])
    p.add_argument("path", help="Relative path under /api/v1/")
    p.set_defaults(func=api)
    args = parser.parse_args()
    if args.command == "merge" and len(args.inputs) < 2:
        parser.error("merge requires at least two input PDFs")
    args.func(args)


if __name__ == "__main__":
    main()
