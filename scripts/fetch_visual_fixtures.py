#!/usr/bin/env python3
"""Fetch and verify the licensed visual-calibration source images."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "tests" / "visual" / "fixture-manifest.json"
USER_AGENT = "Grainlab visual calibration/1.0 (local test fixture fetcher)"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".download")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="fail when an asset is absent instead of downloading it",
    )
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text())
    assets = [*manifest["references"], *manifest["inputs"]]
    failed = False

    for asset in assets:
        path = ROOT / asset["path"]
        expected = asset["sha256"]
        actual = sha256(path) if path.exists() else None
        if actual == expected:
            print(f"ok       {asset['id']}")
            continue
        if args.verify_only:
            reason = "missing" if actual is None else f"checksum {actual}"
            print(f"failed   {asset['id']} ({reason})", file=sys.stderr)
            failed = True
            continue
        if actual is not None:
            print(f"refresh  {asset['id']} (checksum did not match)")
        else:
            print(f"download {asset['id']}")
        fetch(asset["downloadUrl"], path)
        actual = sha256(path)
        if actual != expected:
            print(
                f"failed   {asset['id']} (expected {expected}, received {actual})",
                file=sys.stderr,
            )
            path.unlink(missing_ok=True)
            failed = True
        else:
            print(f"ok       {asset['id']}")

    if failed:
        return 1

    print(f"\n{len(assets)} licensed source fixtures verified in {manifest['artifactRoot']}/sources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
