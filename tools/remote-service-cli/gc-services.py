#!/usr/bin/env python3
"""Operator-only, fixed-origin CLI for GoreeCloud's temporary self-hosted services.

Python standard library only. API credentials are never accepted on argv.
This is not a deployed GoreeCloud Mesh controller or a backup system.
"""
import argparse
import base64
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

SERVICES = {
    "vikunja": ("https://vikunja.goreecloud.com", "/api/v1/", "bearer",
                 "/api/v1/user"),
    "plane": ("https://plane.goreecloud.com", "/api/v1/", "plane",
               "/api/v1/users/me/"),
    "adguard": ("http://127.0.0.1:3000", "/control/", "basic",
                 "/control/status"),
}
STATUS = {
    "vikunja": "https://vikunja.goreecloud.com/api/v1/info",
    "plane": "https://plane.goreecloud.com/",
    "stirling": "https://stirling-pdf.goreecloud.com/api/v1/info/status",
}
CADDYFILE = Path("/opt/goreecloud-temp/Caddyfile")
CONF = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / "goreecloud" / "service-cli"
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
METHODS = WRITE_METHODS | {"GET", "HEAD"}

def fail(message):
    raise SystemExit("Error: " + message)

def run(args):
    try:
        p = subprocess.run(args, check=False, capture_output=True, text=True, timeout=25)
    except (OSError, subprocess.TimeoutExpired):
        fail("Required local executable is missing or timed out.")
    if p.returncode:
        fail("Local command failed (no credential or config contents shown).")
    return p.stdout.strip()

def private_dir():
    if CONF.is_symlink():
        fail("Credential directory is a symlink.")
    CONF.mkdir(parents=True, exist_ok=True, mode=0o700)
    st = CONF.stat()
    if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
        fail("Credential directory must be owned by you and mode 0700.")

def private_file(service):
    if service not in SERVICES:
        fail("Credential service is not supported.")
    return CONF / (service + ".json")

def credential(service):
    path = private_file(service)
    try:
        st_dir = CONF.lstat()
        if not stat.S_ISDIR(st_dir.st_mode) or st_dir.st_uid != os.getuid() or stat.S_IMODE(st_dir.st_mode) != 0o700:
            fail("Credential directory must be a regular owner-only 0700 directory.")
        st = path.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o600:
            fail("Credential file must be a regular, owner-only 0600 file.")
        with path.open(encoding="utf-8") as f:
            cfg = json.load(f)
        if not isinstance(cfg, dict) or not isinstance(cfg.get("secret"), str):
            fail("Credential format is invalid.")
        return cfg
    except FileNotFoundError:
        fail("No private credential for " + service + ". Run: gc-services login " + service)
    except (OSError, ValueError):
        fail("Credential cannot be read.")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(request.full_url, code, "Redirect refused", headers, fp)

def opener():
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        NoRedirect(),
    )

def checked_path(service, path):
    prefixes = ("/api/v1/", "/api/v2/") if service == "vikunja" else (SERVICES[service][1],)
    if not path.startswith(prefixes):
        fail("API path is outside the service's permitted prefix.")
    parts = urllib.parse.urlsplit(path)
    decoded = parts.path
    # Upstream routers may decode multiple times; reject ambiguous traversal.
    for _ in range(3):
        next_value = urllib.parse.unquote(decoded)
        if next_value == decoded:
            break
        decoded = next_value
    if (parts.scheme or parts.netloc or parts.fragment or
        "\\" in decoded or "//" in decoded or ".." in decoded or
        any(ord(ch) < 32 for ch in decoded) or
        not decoded.startswith(prefixes) or
        any(ord(ch) < 32 for ch in path)):
        fail("Unsafe API path.")
    return path

def request(service, method, path, data=None, cfg=None, output=None, quiet=False):
    base, _, auth, _ = SERVICES[service]
    checked_path(service, path)
    headers = {"Accept": "application/json", "User-Agent": "GoreeCloud-service-cli/0.1"}
    if cfg is not None:
        if auth == "bearer":
            headers["Authorization"] = "Bearer " + cfg["secret"]
        elif auth == "plane":
            headers["X-API-Key"] = cfg["secret"]
        else:
            raw = (cfg["username"] + ":" + cfg["secret"]).encode("utf-8")
            headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, headers=headers, data=data, method=method)
    try:
        with opener().open(req, timeout=20) as resp:
            body = resp.read(8 * 1024 * 1024 + 1)
            if len(body) > 8 * 1024 * 1024:
                fail("Response too large (8 MiB maximum); use a specialized client.")
            if output is not None:
                fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(body)
                print(f"HTTP {resp.status}; saved private output to {output}")
            else:
                if not quiet:
                    print(body.decode("utf-8", errors="replace") if body else f"HTTP {resp.status}")
            return resp.status
    except urllib.error.HTTPError as e:
        fail(f"Service returned HTTP {e.code} (response body suppressed).")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        fail("Network or filesystem error; credentials were not printed.")

def login(args):
    if not sys.stdin.isatty():
        fail("Enter credentials from a private interactive VPS terminal, not chat or CLI arguments.")
    service = args.service
    cfg = {}
    if SERVICES[service][2] == "basic":
        cfg["username"] = input("AdGuard username: ").strip()
        if not cfg["username"] or any(c in cfg["username"] for c in "\r\n:"):
            fail("Invalid username.")
    secret = getpass.getpass("API token/password (hidden): ")
    if not secret or "\r" in secret or "\n" in secret:
        fail("Invalid credential.")
    cfg["secret"] = secret
    try:
        # No credentials stored until the authenticated read succeeds.
        request(service, "GET", SERVICES[service][3], cfg=cfg, output=None, quiet=True)
    except SystemExit:
        fail("Credential not stored: authentication or API compatibility failed.")
    private_dir()
    dest = private_file(service)
    if dest.is_symlink():
        fail("Credential destination is a symlink.")
    fd, name = tempfile.mkstemp(prefix=".credential-", dir=CONF)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(cfg, out)
            out.write("\n")
        os.chmod(name, 0o600)
        os.replace(name, dest)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print("Validated and saved private credential (0600).")

def http_status(name, url):
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "GoreeCloud-service-cli/0.1"})
    try:
        with opener().open(req, timeout=8) as resp:
            resp.read(64)
            print(f"{name}: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        print(f"{name}: HTTP {e.code}")
    except (urllib.error.URLError, OSError, TimeoutError):
        print(f"{name}: unavailable")

def caddy(args):
    prefix = ["docker", "exec", "goreecloud-temp-caddy", "caddy"]
    if args.action == "routes":
        # Only site names; never echo complete Caddyfile, hashes, or private config.
        lines = CADDYFILE.read_text(encoding="utf-8").splitlines()
        hosts = [line.strip().split("{")[0].strip() for line in lines
                 if line.strip().endswith("{") and not line.startswith((" ", "\t"))]
        print("\n".join(hosts) or "No site blocks detected.")
    elif args.action == "validate":
        run(prefix + ["validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
        print("Caddyfile validation passed; no reload performed.")
    elif args.action == "reload":
        if not args.confirm_write:
            fail("Live reload requires --confirm-write.")
        run(prefix + ["validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
        # Preserve currently mounted candidate before changing live runtime.
        backup_dir = CADDYFILE.parent / "backups" / "cli-caddy"
        backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup = backup_dir / ("Caddyfile." + str(os.getpid()) + ".pre-reload")
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as out, CADDYFILE.open("rb") as src:
            shutil.copyfileobj(src, out)
        run(prefix + ["reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
        print("Caddy reload command succeeded; independently verify routes and TLS. Candidate snapshot:", backup)

def container(args):
    """Bounded diagnostics without Docker environment, mounts or secrets."""
    if args.action == "list":
        print(run(["docker", "ps", "-a", "--format", "{{.Names}} | {{.Status}}"]))
        return
    if not args.name or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", args.name):
        fail("A valid container name is required.")
    names = run(["docker", "ps", "-a", "--format", "{{.Names}}"]).splitlines()
    if args.name not in names:
        fail("Container not found in local Docker inventory.")
    if args.action == "status":
        # Never print docker inspect whole objects: they can contain credentials.
        print(run(["docker", "inspect", "--format",
                   "{{.Name}} | {{.State.Status}} | {{if .State.Health}}{{.State.Health.Status}}{{else}}no healthcheck{{end}}",
                   args.name]))
    elif args.action == "logs":
        if args.output is None:
            fail("Container logs may contain secrets; use --output to save privately.")
        if args.lines < 1 or args.lines > 200:
            fail("Log tail must be between 1 and 200 lines.")
        if args.output.exists() or args.output.is_symlink():
            fail("Refusing to overwrite log output.")
        # stdout+stderr together is bounded after process completion.
        p = subprocess.run(["docker", "logs", "--tail", str(args.lines), args.name],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           check=False, timeout=15)
        if p.returncode != 0 or len(p.stdout) > 2 * 1024 * 1024:
            fail("Docker log capture failed or exceeded 2 MiB limit.")
        fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "wb") as dest:
            dest.write(p.stdout)
        print("Private log snapshot saved; may contain sensitive data:", args.output)


def main():
    ap = argparse.ArgumentParser(description="Local private VPS service CLI; no passwords on command line")
    sp = ap.add_subparsers(dest="command", required=True)
    sp.add_parser("list", help="List supported services and observed Docker containers")
    p = sp.add_parser("container", help="Read-only diagnostics for all installed Docker services")
    p.add_argument("action", choices=["list", "status", "logs"])
    p.add_argument("name", nargs="?")
    p.add_argument("--lines", type=int, default=50)
    p.add_argument("--output", type=Path, help="Private log file, non-overwriting 0600")
    sp.add_parser("doctor", help="Read-only public health, credentials present and Caddy syntax")
    for name, helptext in (("login", "Privately enroll a scoped credential"),
                            ("auth-check", "Validate an enrolled credential without revealing user data"),
                            ("logout", "Remove local credential; does not revoke the server key")):
        p = sp.add_parser(name, help=helptext)
        p.add_argument("service", choices=sorted(SERVICES) + ["stirling"])
    p = sp.add_parser("api", help="Authorized REST read or explicitly approved write")
    p.add_argument("service", choices=sorted(SERVICES) + ["stirling"])
    p.add_argument("method", choices=sorted(METHODS))
    p.add_argument("path")
    p.add_argument("--data-file", type=Path, help="Existing local JSON payload, not shell argument")
    p.add_argument("--output", type=Path, help="Create a new private output file (no overwrite)")
    p.add_argument("--show-data", action="store_true", help="Explicitly print potentially sensitive API response body")
    p.add_argument("--confirm-write", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="Check the proposed API call without sending or reading credentials")
    p = sp.add_parser("caddy", help="Caddy syntax, route names, or guarded live reload")
    p.add_argument("action", choices=["routes", "validate", "reload"])
    p.add_argument("--confirm-write", action="store_true")
    args = ap.parse_args()
    if args.command == "list":
        for n in sorted(SERVICES):
            print(n + " (authenticated API)")
        print("stirling (existing stirling-pdf CLI); caddy (Docker Caddyfile commands)")
        print(run(["docker", "ps", "--format", "{{.Names}} | {{.Status}}"]))
    elif args.command == "container":
        container(args)
    elif args.command == "doctor":
        for n, u in STATUS.items():
            http_status(n, u)
        http_status("adguard (auth expected)", "http://127.0.0.1:3000/control/status")
        for n in sorted(SERVICES):
            p = private_file(n)
            valid = p.is_file() and not p.is_symlink() and stat.S_IMODE(p.stat().st_mode) == 0o600
            print(n + " credential: " + ("present" if valid else "not enrolled"))
        try:
            caddy(argparse.Namespace(action="validate", confirm_write=False))
        except SystemExit as exc:
            print("Caddy validation failed:", exc)
    elif args.command in ("login", "auth-check", "logout"):
        if args.service == "stirling":
            print(run([str(Path.home() / ".local/bin" / "stirling-pdf"),
                       {"login": "login", "auth-check": "auth-check", "logout": "logout"}[args.command]]))
        elif args.command == "login":
            login(args)
        elif args.command == "auth-check":
            request(args.service, "GET", SERVICES[args.service][3],
                    cfg=credential(args.service), quiet=True)
            print("Authenticated API read succeeded; response content suppressed.")
        else:
            credential(args.service)
            private_file(args.service).unlink()
            print("Local credential deleted; server-issued access was NOT revoked.")
    elif args.command == "caddy":
        caddy(args)
    elif args.command == "api":
        if args.service != "stirling":
            checked_path(args.service, args.path)
        if args.dry_run:
            if args.service == "stirling":
                if args.method not in {"GET", "POST", "PUT", "PATCH", "DELETE"} or not args.path.startswith("/api/v1/") or ".." in args.path:
                    fail("Stirling dry-run path or method is invalid.")
            if args.method in {"GET", "HEAD"} and args.data_file:
                fail("GET and HEAD must not include a request body.")
            if args.data_file:
                if not args.data_file.is_file() or args.data_file.stat().st_size > 2 * 1024 * 1024:
                    fail("Payload must be an existing JSON file at most 2 MiB.")
                try:
                    json.loads(args.data_file.read_bytes())
                except ValueError:
                    fail("Payload is not valid JSON.")
            print("Dry run passed: fixed service origin, scoped path, optional JSON file validated; no request sent.")
            return
        if args.method in WRITE_METHODS and not args.confirm_write:
            fail("Writes require --confirm-write.")
        if args.method == "GET" and args.data_file:
            fail("GET must not include a request body.")
        if args.service == "stirling":
            if args.data_file or args.output:
                fail("Use 'stirling-pdf compress/merge' for PDF file processing.")
            if args.method == "HEAD":
                fail("Stirling wrapper does not support HEAD.")
            if not args.path.startswith("/api/v1/") or ".." in args.path or "://" in args.path or "#" in args.path or any(ord(ch) < 32 for ch in args.path):
                fail("Invalid Stirling API path.")
            print(run([str(Path.home() / ".local/bin" / "stirling-pdf"), "api", args.method, args.path]))
        else:
            data = None
            if args.data_file:
                if not args.data_file.is_file() or args.data_file.stat().st_size > 2 * 1024 * 1024:
                    fail("Payload must be an existing JSON file at most 2 MiB.")
                data = args.data_file.read_bytes()
                try:
                    json.loads(data)
                except ValueError:
                    fail("Payload is not valid JSON.")
            status_code = request(args.service, args.method, args.path, data=data,
                    cfg=credential(args.service), output=args.output, quiet=not args.show_data)
            if not args.show_data and args.output is None:
                print(f"HTTP {status_code}; private response body suppressed. Use --show-data or --output.")

if __name__ == "__main__":
    main()
