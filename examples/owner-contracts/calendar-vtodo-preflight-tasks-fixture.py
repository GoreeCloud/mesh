#!/usr/bin/env python3
"""Emit ONLY one synthetic GoreeCloud Tasks VTODO source-format fixture.

No API calls, accounts, persistence, user-provided task data or network access.
Caller pins source revision and module blobs before invoking this script.
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("Provide pinned GoreeCloud Tasks server source directory")
source = Path(sys.argv[1]).resolve()
if not (source / "vtodo_export.py").is_file():
    raise SystemExit("Tasks serializer source missing")
sys.path.insert(0, str(source))
from vtodo_export import vtodo_preview

synthetic = {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "title": "SYNTHETIC_PRIVATE_TITLE_DO_NOT_ECHO",
    "updatedAt": "2026-11-11T12:00:00Z",
    "revision": 4,
    "deleted": False,
    "completed": False,
    "due": "2026-11-12",
}
result = vtodo_preview(synthetic)
if not 0 < len(result) <= 8192:
    raise SystemExit("Invalid synthetic VTODO byte size")
sys.stdout.buffer.write(result)
