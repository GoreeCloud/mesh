#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEBSITE = ROOT / "website"
LOCK_PATH = WEBSITE / "glaze.lock.json"
DESTINATION = WEBSITE / "glaze"


def git_blob_sha(data: bytes) -> str:
    prefix = b"blob " + str(len(data)).encode("ascii") + b"\0"
    return hashlib.sha1(prefix + data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Vendor the exact locked GLAZE UI web source graph.")
    parser.add_argument("--source", required=True, type=Path, help="Checkout root for the locked goreecloud-glaze-ui revision")
    args = parser.parse_args()

    source = args.source.resolve()
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    if lock.get("product") != "GLAZE UI V1.1" or lock.get("version") != "1.1.0":
        raise SystemExit("unexpected Mesh Center Glaze lock product/version")
    if lock.get("release_commit") != "15cc76d2bcd4065552dc31c77145b63f34d9e7b2":
        raise SystemExit("unexpected Mesh Center Glaze release commit")

    staged: list[tuple[str, bytes]] = []
    for upstream_path, expected_sha in lock["files"].items():
        source_file = source / upstream_path
        if not source_file.is_file() or source_file.is_symlink():
            raise SystemExit(f"missing or unsafe locked Glaze source: {upstream_path}")
        data = source_file.read_bytes()
        actual_sha = git_blob_sha(data)
        if actual_sha != expected_sha:
            raise SystemExit(f"Glaze integrity mismatch for {upstream_path}: {actual_sha} != {expected_sha}")
        staged.append((Path(upstream_path).name, data))

    if DESTINATION.exists():
        shutil.rmtree(DESTINATION)
    DESTINATION.mkdir(parents=True)
    for name, data in staged:
        (DESTINATION / name).write_bytes(data)

    expected_names = {name for name, _ in staged}
    actual_names = {path.name for path in DESTINATION.iterdir() if path.is_file()}
    if actual_names != expected_names:
        raise SystemExit("vendored Glaze directory does not exactly match locked source graph")

    print(f"Vendored {len(staged)} locked GLAZE UI V1.1 files from {lock['release_commit']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
