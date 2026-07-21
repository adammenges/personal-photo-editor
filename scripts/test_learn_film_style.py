#!/usr/bin/env python3
"""Deterministic checks for the local learned-style workflow."""

from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

import learn_film_style


class LearnedFilmStyleTests(unittest.TestCase):
    def test_color_roll_builds_valid_deterministic_style(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scans = root / "scans"
            scans.mkdir()
            height, width = 540, 720
            y, x = np.mgrid[0:height, 0:width]
            base = 0.06 + 0.82 * x / (width - 1) + 0.04 * np.sin(y / 38)
            for index in range(3):
                random = np.random.default_rng(1200 + index)
                texture = random.normal(0, 0.008 + index * 0.0005, (height, width))
                rgb = np.stack((base * 1.07, base * 1.01, base * 0.93), axis=2)
                rgb += texture[..., None]
                Image.fromarray(np.uint8(np.clip(rgb, 0, 1) * 255), "RGB").save(scans / f"roll-{index}.png")

            output = root / "output"
            arguments = [
                "--input", str(scans), "--id", "warm-roll-test", "--name", "Warm Roll Test",
                "--stock", "Known Test Stock", "--maximum-edge", "512", "--output-root", str(output),
            ]
            with redirect_stdout(io.StringIO()):
                result = learn_film_style.run(arguments)
            self.assertEqual(result, 0)
            style_path = output / "warm-roll-test" / "warm-roll-test.json"
            first = style_path.read_text()
            stock = json.loads(first)
            learn_film_style.validate_learned_stock(stock)
            self.assertEqual(stock["type"], "color")
            self.assertGreater(stock["pipeline"]["output"]["tint"][0], stock["pipeline"]["output"]["tint"][2])
            self.assertTrue((output / "warm-roll-test" / "analysis.json").exists())
            self.assertTrue((output / "warm-roll-test" / "index.html").exists())

            with redirect_stdout(io.StringIO()):
                result = learn_film_style.run(arguments + ["--force"])
            self.assertEqual(result, 0)
            self.assertEqual(first, style_path.read_text())

    def test_grayscale_input_becomes_monochrome_silver_style(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            height, width = 560, 740
            random = np.random.default_rng(801)
            gradient = np.linspace(0.08, 0.86, width, dtype=np.float32)[None, :]
            values = np.clip(np.repeat(gradient, height, axis=0) + random.normal(0, 0.01, (height, width)), 0, 1)
            scan = root / "mono.png"
            Image.fromarray(np.uint8(values * 255), "L").save(scan)
            output = root / "output"
            with redirect_stdout(io.StringIO()):
                result = learn_film_style.run([
                    "--input", str(scan), "--id", "mono-roll-test", "--maximum-edge", "512", "--output-root", str(output),
                ])
            self.assertEqual(result, 0)
            stock = json.loads((output / "mono-roll-test" / "mono-roll-test.json").read_text())
            self.assertEqual(stock["type"], "mono")
            self.assertEqual(stock["grainProfile"]["medium"], "silver")
            self.assertEqual(stock["pipeline"]["output"]["tint"], [1.0, 1.0, 1.0])
            self.assertEqual(stock["pipeline"]["grain"]["chroma"], 0.0)

    def test_texture_scale_metric_distinguishes_fine_and_broad_noise(self) -> None:
        random = np.random.default_rng(991)
        noise = random.normal(0, 0.015, (640, 640)).astype(np.float32)
        fine = np.clip(0.45 + noise, 0, 1)
        broad_noise = learn_film_style.box_blur(noise, 3)
        broad = np.clip(0.45 + broad_noise * 3.2, 0, 1)
        fine_rgb = np.repeat(fine[..., None], 3, axis=2)
        broad_rgb = np.repeat(broad[..., None], 3, axis=2)
        fine_metrics = learn_film_style.analyze_pixels(fine_rgb, True)
        broad_metrics = learn_film_style.analyze_pixels(broad_rgb, True)
        self.assertGreater(fine_metrics["fineToBroadRatio"], broad_metrics["fineToBroadRatio"])

    def test_flat_scan_does_not_invent_a_tone_curve(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            random = np.random.default_rng(411)
            values = np.clip(0.45 + random.normal(0, 0.008, (560, 740)), 0, 1)
            scan = root / "flat.png"
            Image.fromarray(np.uint8(values * 255), "L").save(scan)
            output = root / "output"
            with redirect_stdout(io.StringIO()):
                learn_film_style.run([
                    "--input", str(scan), "--id", "flat-roll-test", "--maximum-edge", "512", "--output-root", str(output),
                ])
            stock = json.loads((output / "flat-roll-test" / "flat-roll-test.json").read_text())
            evidence = json.loads((output / "flat-roll-test" / "analysis.json").read_text())
            self.assertFalse(evidence["aggregate"]["hasToneEvidence"])
            self.assertEqual(stock["settings"]["contrast"], 0)
            self.assertEqual(stock["settings"]["fade"], 0)
            self.assertEqual(stock["pipeline"]["curve"]["gamma"], 1.0)
            self.assertEqual(evidence["confidence"]["tone"]["label"], "low")


if __name__ == "__main__":
    unittest.main()
