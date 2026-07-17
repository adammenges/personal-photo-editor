#!/usr/bin/env python3
"""Build deterministic iPhone QA copies and synthetic calibration charts."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "tests" / "visual" / "fixture-manifest.json"
RESAMPLE = Image.Resampling.LANCZOS


def create_qa_copy(source: Path, destination: Path, maximum_edge: int = 2048) -> None:
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        scale = min(1.0, maximum_edge / max(image.size))
        size = tuple(max(1, round(value * scale)) for value in image.size)
        if size != image.size:
            image = image.resize(size, RESAMPLE)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "JPEG", quality=95, subsampling=0, optimize=True)


def middle_gray(path: Path, size: tuple[int, int]) -> None:
    # sRGB 119 is close to perceptual L*=50 and matches the reference scan's
    # stated middle-gray normalization without adding a digital texture.
    Image.new("RGB", size, (119, 119, 119)).save(path, "PNG", optimize=True)


def tone_wedge(path: Path, size: tuple[int, int]) -> None:
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    patch_width = size[0] / 16
    for patch in range(16):
        # Even stops in linear light, encoded to sRGB, exercise the film curve
        # more usefully than an evenly spaced 8-bit ramp.
        linear = patch / 15
        encoded = linear * 12.92 if linear <= 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055
        value = round(encoded * 255)
        left = round(patch * patch_width)
        right = round((patch + 1) * patch_width)
        draw.rectangle((left, 0, right, size[1]), fill=(value, value, value))
    image.save(path, "PNG", optimize=True)


def halation_edges(path: Path, size: tuple[int, int]) -> None:
    width, height = size
    image = Image.new("RGB", size, (8, 10, 13))
    draw = ImageDraw.Draw(image)

    # A white-to-warm highlight ladder against dark density.
    for index, value in enumerate((80, 112, 148, 188, 224, 255)):
        radius = round(width * (0.025 + index * 0.006))
        center_x = round(width * (0.10 + index * 0.15))
        center_y = round(height * 0.24)
        warm = (value, round(value * 0.86), round(value * 0.68))
        draw.ellipse((center_x - radius, center_y - radius, center_x + radius, center_y + radius), fill=warm)

    # Slanted hard edges reveal whether texture swims, rings, or becomes an
    # unrelated veil when the highlight model is active.
    draw.polygon(
        [
            (round(width * 0.08), round(height * 0.52)),
            (round(width * 0.53), round(height * 0.46)),
            (round(width * 0.55), round(height * 0.67)),
            (round(width * 0.10), round(height * 0.73)),
        ],
        fill=(236, 236, 232),
    )
    draw.polygon(
        [
            (round(width * 0.58), round(height * 0.50)),
            (round(width * 0.92), round(height * 0.57)),
            (round(width * 0.90), round(height * 0.75)),
            (round(width * 0.56), round(height * 0.68)),
        ],
        fill=(205, 55, 36),
    )
    draw.rectangle(
        (round(width * 0.08), round(height * 0.84), round(width * 0.92), round(height * 0.90)),
        fill=(30, 31, 33),
    )
    for index in range(33):
        x = round(width * (0.08 + index * 0.84 / 32))
        value = round(index / 32 * 255)
        draw.line((x, round(height * 0.84), x, round(height * 0.90)), fill=(value, value, value), width=max(1, width // 700))
    image.save(path, "PNG", optimize=True)


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text())
    for asset in manifest["inputs"]:
        source = ROOT / asset["path"]
        if not source.exists():
            raise FileNotFoundError(f"Missing {source}; run scripts/fetch_visual_fixtures.py first")
        destination = ROOT / asset["fixturePath"]
        create_qa_copy(source, destination)
        with Image.open(destination) as image:
            print(f"fixture  {asset['id']:<18} {image.width} × {image.height}")

    synthetic = {asset["id"]: asset for asset in manifest["synthetic"]}
    for asset in synthetic.values():
        (ROOT / asset["path"]).parent.mkdir(parents=True, exist_ok=True)

    middle_gray(ROOT / synthetic["middle-gray-flat"]["path"], tuple(synthetic["middle-gray-flat"]["dimensions"]))
    tone_wedge(ROOT / synthetic["tone-wedge"]["path"], tuple(synthetic["tone-wedge"]["dimensions"]))
    halation_edges(ROOT / synthetic["halation-edges"]["path"], tuple(synthetic["halation-edges"]["dimensions"]))
    print(f"\n{len(synthetic)} synthetic charts generated in {manifest['artifactRoot']}/synthetic")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
