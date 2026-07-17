#!/usr/bin/env python3
"""Extract exact fit-view frames from browser-captured Grainlab screenshots."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "tests" / "visual" / "fixture-manifest.json"


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text())
    extracted = 0
    for case in manifest["renderCases"]:
        capture_path = ROOT / case["capturePath"]
        metadata_path = Path(str(capture_path) + ".json")
        if not capture_path.exists() or not metadata_path.exists():
            continue
        metadata = json.loads(metadata_path.read_text())
        width = round(metadata["cssWidth"])
        height = round(metadata["cssHeight"])
        left = round(metadata["stageX"] + metadata["frameCenterX"] - width / 2)
        top = round(metadata["stageY"] + metadata["frameCenterY"] - height / 2)
        output_path = ROOT / case["outputPath"]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(capture_path) as screenshot:
            frame = screenshot.crop((left, top, left + width, top + height)).convert("RGB")
            frame.save(output_path, "JPEG", quality=95, subsampling=0, optimize=True)
        print(
            f"capture  {case['id']:<32} {width} × {height} · "
            f"{metadata.get('engine', 'unknown engine')}"
        )
        extracted += 1

        detail_capture_value = case.get("detailCapturePath")
        detail_output_value = case.get("detailOutputPath")
        if not detail_capture_value or not detail_output_value:
            continue
        detail_capture = ROOT / detail_capture_value
        detail_metadata_path = Path(str(detail_capture) + ".json")
        if not detail_capture.exists() or not detail_metadata_path.exists():
            continue
        detail = json.loads(detail_metadata_path.read_text())
        # The browser capture is exactly 100% when CSS and source dimensions
        # agree. Take a centered square inside the stage so badges and borders
        # cannot contaminate the frequency measurement.
        if detail["cssWidth"] != detail["pixelWidth"] or detail["cssHeight"] != detail["pixelHeight"]:
            raise ValueError(f"{case['id']} detail capture is not at 100%")
        side = round(min(detail["stageWidth"] - 200, detail["stageHeight"] - 80))
        left = round(detail["stageX"] + (detail["stageWidth"] - side) / 2)
        top = round(detail["stageY"] + (detail["stageHeight"] - side) / 2)
        detail_output = ROOT / detail_output_value
        with Image.open(detail_capture) as screenshot:
            frame = screenshot.crop((left, top, left + side, top + side)).convert("RGB")
            frame.save(detail_output, "PNG", optimize=True)
        print(f"detail   {case['id']:<32} {side} × {side} · 100%")
    print(f"\n{extracted} browser renderer captures extracted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
