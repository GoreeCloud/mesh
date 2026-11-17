"""Temporary, loopback-only source contract fixture; no accounts or external network."""
import json
import os
from pathlib import Path
import signal
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread

if len(sys.argv) != 2:
    raise SystemExit("Source directory required")
source = Path(sys.argv[1]).resolve()
if not (source / "calendar_app/core.py").is_file():
    raise SystemExit("Missing source-owned Calendar backend")
os.umask(0o077)
sys.path.insert(0, str(source))
from calendar_app.core import make_server

stopping = Event()
signal.signal(signal.SIGTERM, lambda *_: stopping.set())
with TemporaryDirectory(prefix="mesh-calendar-source-contract-") as temporary:
    database = str(Path(temporary) / "synthetic.sqlite3")
    with make_server(database, "127.0.0.1", 0) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        print(json.dumps({"port": server.server_address[1], "database": database}), flush=True)
        stopping.wait()
        server.shutdown()
        worker.join(timeout=3)
