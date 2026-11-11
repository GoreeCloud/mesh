"""Disposable Calendar source fixture for Mesh redacted-preview contract tests.

No production config, no real credentials, no remote socket, no persistent data.
The parent Node test owns all authentication and uses synthetic ICS exclusively.
"""
import json
import os
from pathlib import Path
import signal
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread

if os.environ.get("GC_MESH_CALENDAR_PREVIEW_FIXTURE") != "1":
    raise SystemExit("Explicit isolated Calendar preview test opt-in required")
if len(sys.argv) != 2:
    raise SystemExit("Pinned Calendar source directory required")

source = Path(sys.argv[1]).resolve()
if not (source / "calendar_app/core.py").is_file():
    raise SystemExit("Pinned source not present")
os.umask(0o077)
sys.path.insert(0, str(source))

from calendar_app.core import create_user, make_server

stop = Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())
with TemporaryDirectory(prefix="mesh-calendar-privacy-fixture-") as root:
    database = str(Path(root) / "synthetic.sqlite3")
    create_user(database, "fixture-owner@example.test", "synthetic-owner-password-12345678")
    create_user(database, "fixture-other@example.test", "synthetic-other-password-12345678")
    with make_server(database, "127.0.0.1", 0) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        print(json.dumps({"port": server.server_address[1]}), flush=True)
        stop.wait()
        server.shutdown()
        worker.join(timeout=3)
