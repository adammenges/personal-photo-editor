#!/usr/bin/env python3
"""Learn a conservative Grainlab style from one or more positive film scans.

This is intentionally a scan-look estimator, not a stock characterization tool.
An unpaired positive scan entangles scene, exposure, emulsion, development,
printing, scanner optics, color management, sharpening, and compression.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date
import html
import json
import math
from pathlib import Path
import re
import shutil
import sys
from typing import Any, Iterable

try:
    import numpy as np
    from PIL import Image, ImageOps
except ImportError as error:  # pragma: no cover - wrapper prints setup guidance
    raise SystemExit("Film-style learning needs Pillow and NumPy.") from error


ROOT = Path(__file__).resolve().parents[1]
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
RESAMPLE = Image.Resampling.LANCZOS
LUMA_WEIGHTS = np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)
IDENTIFIER = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass
class ScanSample:
    path: Path
    width: int
    height: int
    analyzed_width: int
    analyzed_height: int
    originally_monochrome: bool
    palette_pixels: np.ndarray
    metrics: dict[str, Any]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, float(value)))


def rounded(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def finite(value: float | None, fallback: float = 0.0) -> float:
    return fallback if value is None or not math.isfinite(float(value)) else float(value)


def box_blur(values: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return values
    kernel = radius * 2 + 1
    padded = np.pad(values, radius, mode="reflect")
    integral = np.pad(padded, ((1, 0), (1, 0)), mode="constant")
    integral = integral.cumsum(axis=0).cumsum(axis=1)
    return (
        integral[kernel:, kernel:]
        - integral[:-kernel, kernel:]
        - integral[kernel:, :-kernel]
        + integral[:-kernel, :-kernel]
    ) / (kernel * kernel)


def rms(values: np.ndarray) -> float:
    if values.size < 16:
        return 0.0
    return float(np.sqrt(np.mean(np.square(values))))


def safe_correlation(first: np.ndarray, second: np.ndarray, mask: np.ndarray) -> float:
    a = first[mask]
    b = second[mask]
    if a.size < 64 or float(a.std()) < 1e-8 or float(b.std()) < 1e-8:
        return 1.0
    return float(np.corrcoef(a, b)[0, 1])


def cast_vector(rgb: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, int]:
    selected = rgb[mask]
    evidence_count = int(selected.shape[0])
    if selected.shape[0] < 64:
        selected = rgb.reshape(-1, 3)
    median = np.median(selected, axis=0)
    neutral = max(1e-6, float(np.dot(median, LUMA_WEIGHTS)))
    return median / neutral, evidence_count


def atomic_write_text(destination: Path, contents: str) -> None:
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(contents)
    temporary.replace(destination)


def existing_stock_path(identifier: str) -> Path | None:
    stock_root = ROOT / "ui" / "film-stocks"
    for path in sorted(stock_root.rglob("*.json")):
        if path.name == "index.json":
            continue
        try:
            if json.loads(path.read_text()).get("id") == identifier:
                return path.resolve()
        except (OSError, json.JSONDecodeError):
            continue
    return None


def load_rgb(path: Path, maximum_edge: int) -> tuple[np.ndarray, tuple[int, int], bool]:
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        original_size = image.size
        originally_monochrome = image.mode in {"1", "L", "LA", "I", "F"} or image.mode.startswith("I;")
        scale = min(1.0, maximum_edge / max(image.size))
        if scale < 1:
            image = image.resize(
                tuple(max(16, round(dimension * scale)) for dimension in image.size),
                RESAMPLE,
            )

        if originally_monochrome and (image.mode.startswith("I;") or image.mode in {"I", "F"}):
            values = np.asarray(image.convert("F"), dtype=np.float32)
            maximum = 65535.0 if float(values.max(initial=0)) > 255 else 255.0
            channel = np.clip(values / maximum, 0, 1)
            rgb = np.repeat(channel[..., None], 3, axis=2)
        else:
            rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return rgb, original_size, originally_monochrome


def tile_variation(residual: np.ndarray, smooth: np.ndarray) -> float:
    height, width = residual.shape
    values: list[float] = []
    for row in range(4):
        for column in range(4):
            y0, y1 = round(row * height / 4), round((row + 1) * height / 4)
            x0, x1 = round(column * width / 4), round((column + 1) * width / 4)
            mask = smooth[y0:y1, x0:x1]
            if int(mask.sum()) >= 128:
                values.append(rms(residual[y0:y1, x0:x1][mask]))
    if len(values) < 3 or float(np.mean(values)) < 1e-8:
        return 0.0
    return float(np.std(values) / np.mean(values))


def analyze_pixels(rgb: np.ndarray, originally_monochrome: bool) -> dict[str, Any]:
    luminance = np.tensordot(rgb, LUMA_WEIGHTS, axes=([2], [0])).astype(np.float32)
    percentiles = np.percentile(luminance, [1, 5, 10, 25, 50, 75, 90, 95, 99])
    p01, p05, p10, p25, p50, p75, p90, p95, p99 = [float(value) for value in percentiles]
    tone_span = max(1e-5, p95 - p05)

    blur3 = box_blur(luminance, 1)
    blur9 = box_blur(luminance, 4)
    residual3 = luminance - blur3
    residual9 = luminance - blur9
    vertical, horizontal = np.gradient(luminance)
    gradient = np.sqrt(horizontal * horizontal + vertical * vertical)
    smooth_threshold = float(np.quantile(gradient, 0.38))
    smooth = (gradient <= smooth_threshold) & (luminance >= 0.025) & (luminance <= 0.975)
    if int(smooth.sum()) < 256:
        smooth = gradient <= smooth_threshold

    channel_residuals = [rgb[..., channel] - box_blur(rgb[..., channel], 1) for channel in range(3)]
    smooth_rms = rms(residual3[smooth]) * 255
    broad_rms = rms(residual9[smooth]) * 255
    fine_ratio = smooth_rms / max(broad_rms, 1e-7)

    tone_rms: dict[str, float | None] = {}
    for key, lower, upper in (
        ("shadow", 0.03, 0.28),
        ("middle", 0.28, 0.68),
        ("highlight", 0.68, 0.98),
    ):
        mask = smooth & (luminance >= lower) & (luminance < upper)
        tone_rms[key] = rms(residual3[mask]) * 255 if int(mask.sum()) >= 128 else None

    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    saturation = (maximum - minimum) / np.maximum(maximum, 0.03)
    neutral_threshold = clamp(float(np.quantile(saturation, 0.24)), 0.025, 0.14)
    neutral = (saturation <= neutral_threshold) & (luminance >= 0.08) & (luminance <= 0.92)
    overall_cast, neutral_count = cast_vector(rgb, neutral)

    shadow_neutral = neutral & (luminance < p25)
    highlight_neutral = neutral & (luminance > p75)
    shadow_cast, shadow_count = cast_vector(rgb, shadow_neutral)
    highlight_cast, highlight_count = cast_vector(rgb, highlight_neutral)

    channel_spread = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    monochrome_score = 1 - clamp(float(np.quantile(channel_spread, 0.90)) / 0.055, 0, 1)
    if originally_monochrome:
        monochrome_score = 1.0

    return {
        "percentiles": {
            key: rounded(value)
            for key, value in zip(("p01", "p05", "p10", "p25", "p50", "p75", "p90", "p95", "p99"), percentiles)
        },
        "toneSpan": rounded(tone_span),
        "shadowSpacing": rounded((p25 - p05) / tone_span),
        "highlightSpacing": rounded((p95 - p75) / tone_span),
        "midtonePosition": rounded((p50 - p05) / tone_span),
        "blackClipFraction": rounded(float(np.mean(luminance <= 0.01))),
        "whiteClipFraction": rounded(float(np.mean(luminance >= 0.99))),
        "medianSaturation": rounded(float(np.median(saturation))),
        "upperSaturation": rounded(float(np.quantile(saturation, 0.75))),
        "neutralCast": [rounded(value) for value in overall_cast],
        "shadowCast": [rounded(value) for value in shadow_cast],
        "highlightCast": [rounded(value) for value in highlight_cast],
        "neutralPixelFraction": rounded(neutral_count / luminance.size),
        "shadowNeutralPixels": shadow_count,
        "highlightNeutralPixels": highlight_count,
        "monochromeScore": rounded(monochrome_score),
        "smoothPixelFraction": rounded(float(np.mean(smooth))),
        "grainRms8Bit": rounded(smooth_rms),
        "broadGrainRms8Bit": rounded(broad_rms),
        "fineToBroadRatio": rounded(fine_ratio),
        "grainTileVariation": rounded(tile_variation(residual3, smooth)),
        "grainByTone": {key: None if value is None else rounded(value) for key, value in tone_rms.items()},
        "redGreenResidualCorrelation": rounded(safe_correlation(channel_residuals[0], channel_residuals[1], smooth)),
        "greenBlueResidualCorrelation": rounded(safe_correlation(channel_residuals[1], channel_residuals[2], smooth)),
    }


def analyze_scan(path: Path, maximum_edge: int) -> ScanSample:
    rgb, original_size, originally_monochrome = load_rgb(path, maximum_edge)
    metrics = analyze_pixels(rgb, originally_monochrome)
    return ScanSample(
        path=path,
        width=original_size[0],
        height=original_size[1],
        analyzed_width=rgb.shape[1],
        analyzed_height=rgb.shape[0],
        originally_monochrome=originally_monochrome,
        palette_pixels=rgb[::8, ::8].reshape(-1, 3).copy(),
        metrics=metrics,
    )


def discover_inputs(inputs: Iterable[str], recursive: bool) -> list[Path]:
    discovered: set[Path] = set()
    for raw in inputs:
        candidate = Path(raw).expanduser().resolve()
        if not candidate.exists():
            raise SystemExit(f"Input does not exist: {candidate}")
        if candidate.is_dir():
            iterator = candidate.rglob("*") if recursive else candidate.glob("*")
            for path in iterator:
                if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
                    discovered.add(path.resolve())
        elif candidate.suffix.lower() in SUPPORTED_EXTENSIONS:
            discovered.add(candidate)
        else:
            raise SystemExit(f"Unsupported scan format: {candidate.suffix or '(none)'}")
    paths = sorted(discovered, key=lambda path: str(path).lower())
    if not paths:
        raise SystemExit("No supported JPG, PNG, WebP, or TIFF scans were found.")
    return paths


def median_metric(samples: list[ScanSample], key: str) -> float:
    return float(np.median([float(sample.metrics[key]) for sample in samples]))


def median_vector(samples: list[ScanSample], key: str) -> np.ndarray:
    return np.median(np.asarray([sample.metrics[key] for sample in samples], dtype=np.float64), axis=0)


def confidence_label(score: float) -> str:
    if score >= 0.72:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"


def confidence_scores(samples: list[ScanSample]) -> dict[str, Any]:
    count_score = clamp(math.log2(len(samples) + 1) / 3.6, 0.18, 1.0)
    smooth_score = clamp(median_metric(samples, "smoothPixelFraction") / 0.34, 0, 1)
    neutral_score = clamp(median_metric(samples, "neutralPixelFraction") / 0.18, 0, 1)
    tone_coverage = clamp(median_metric(samples, "toneSpan") / 0.48, 0.06, 1.0)
    grain_values = np.asarray([sample.metrics["grainRms8Bit"] for sample in samples], dtype=float)
    grain_dispersion = float(np.std(grain_values) / max(float(np.mean(grain_values)), 0.1))
    agreement = clamp(1 - grain_dispersion / 0.85, 0, 1)
    resolution_score = clamp(np.median([min(sample.width, sample.height) for sample in samples]) / 1800, 0.2, 1)
    scores = {
        "tone": (0.40 + count_score * 0.45) * tone_coverage,
        "color": neutral_score * 0.52 + count_score * 0.32,
        "grain": (smooth_score * 0.32 + agreement * 0.28 + resolution_score * 0.24 + count_score * 0.16)
        * (0.70 + count_score * 0.30),
        "crossover": neutral_score * count_score * 0.68 * tone_coverage,
    }
    scores["overall"] = float(np.mean(list(scores.values())))
    return {
        key: {"score": rounded(clamp(value, 0, 1), 2), "label": confidence_label(value)}
        for key, value in scores.items()
    }


def chroma_crossover(cast: np.ndarray, baseline: np.ndarray) -> list[float]:
    difference = cast - baseline
    difference -= float(np.dot(difference, LUMA_WEIGHTS))
    return [rounded(clamp(component * 0.16, -0.06, 0.06)) for component in difference]


def derive_palette(samples: list[ScanSample]) -> list[dict[str, str]]:
    pixels = np.concatenate([sample.palette_pixels for sample in samples], axis=0)
    luminance = pixels @ LUMA_WEIGHTS
    entries = []
    bands = (
        ("scan shadow", 0.08, 0.20),
        ("lower midtone", 0.32, 0.44),
        ("upper midtone", 0.58, 0.70),
        ("scan highlight", 0.82, 0.94),
    )
    order = np.argsort(luminance)
    pixels, luminance = pixels[order], luminance[order]
    for name, lower, upper in bands:
        low_index = min(len(pixels) - 1, round(lower * (len(pixels) - 1)))
        high_index = max(low_index + 1, round(upper * (len(pixels) - 1)))
        color = np.median(pixels[low_index:high_index], axis=0)
        encoded = np.clip(np.round(color * 255), 0, 255).astype(int)
        entries.append({"name": name, "hex": "#" + "".join(f"{channel:02x}" for channel in encoded)})
    return entries


def derive_style(samples: list[ScanSample], args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    confidence = confidence_scores(samples)
    auto_monochrome = median_metric(samples, "monochromeScore") >= 0.82
    monochrome = auto_monochrome if args.monochrome == "auto" else args.monochrome == "yes"
    family = args.family if args.family != "auto" else ("bw" if monochrome else "c41")
    medium = args.medium if args.medium != "auto" else ("silver" if monochrome else "dye")

    tone_span = median_metric(samples, "toneSpan")
    shadow_spacing = median_metric(samples, "shadowSpacing")
    highlight_spacing = median_metric(samples, "highlightSpacing")
    midtone_position = median_metric(samples, "midtonePosition")
    black_point = float(np.median([sample.metrics["percentiles"]["p01"] for sample in samples]))
    upper_saturation = median_metric(samples, "upperSaturation")
    grain_rms = median_metric(samples, "grainRms8Bit")
    fine_ratio = median_metric(samples, "fineToBroadRatio")
    tile_variation = median_metric(samples, "grainTileVariation")
    red_green = median_metric(samples, "redGreenResidualCorrelation")
    green_blue = median_metric(samples, "greenBlueResidualCorrelation")
    baseline_cast = median_vector(samples, "neutralCast")
    shadow_cast = median_vector(samples, "shadowCast")
    highlight_cast = median_vector(samples, "highlightCast")

    tint = np.power(np.clip(baseline_cast, 0.70, 1.30), 0.42)
    tint /= float(np.dot(tint, LUMA_WEIGHTS))
    tint = np.clip(tint, 0.88, 1.12)
    if monochrome:
        tint = np.ones(3)

    mean_radius = clamp(0.45 + (1 - clamp(fine_ratio, 0.18, 1.0)) * 2.0, 0.45, 2.15)
    radius_variance = clamp(0.10 + tile_variation * 0.72, 0.10, 0.85)
    middle_grain = np.median([
        finite(sample.metrics["grainByTone"]["middle"], grain_rms) for sample in samples
    ])
    shadow_grain = np.median([
        finite(sample.metrics["grainByTone"]["shadow"], grain_rms) for sample in samples
    ])
    shadow_bias = clamp(0.28 + (shadow_grain / max(middle_grain, 0.1) - 1) * 0.7, 0.08, 1.05)
    channel_independence = 1 - clamp((red_green + green_blue) / 2, 0, 1)
    grain_chroma = 0.0 if monochrome else clamp(0.018 + channel_independence * 0.055, 0.015, 0.075)
    grain_amount = int(round(clamp(4 + grain_rms * 7.2, 4, 28)))

    if mean_radius < 0.85:
        scale, crystal = "fine", ("delta" if tile_variation < 0.22 else "tabular")
    elif mean_radius < 1.38:
        scale, crystal = "medium", "tabular" if tile_variation < 0.28 else "cubic"
    else:
        scale, crystal = "coarse", "cubic"
    emulsion = "uniform" if tile_variation < 0.18 else "core-shell" if (not monochrome and tile_variation < 0.38) else "mixed"

    has_tone_evidence = tone_span >= 0.22
    toe = clamp(0.05 + (0.22 - shadow_spacing) * 0.38, 0.025, 0.18) if has_tone_evidence else 0.05
    shoulder = clamp(0.14 + (0.22 - highlight_spacing) * 0.7, 0.06, 0.32) if has_tone_evidence else 0.15
    gamma = clamp(1 + (0.50 - midtone_position) * 0.35, 0.90, 1.12) if has_tone_evidence else 1.0
    saturation_compression = 0.0 if monochrome else clamp(0.31 - upper_saturation * 0.24, 0.08, 0.27)
    scan_contrast = clamp(0.91 + tone_span * 0.12, 0.92, 1.04) if has_tone_evidence else 1.0
    creative_contrast = int(round(clamp((tone_span - 0.62) * 32, -8, 8))) if has_tone_evidence else 0
    fade = int(round(clamp(black_point * 115, 0, 14))) if has_tone_evidence else 0
    fog = clamp(0.002 + black_point * 0.06, 0.002, 0.012) if has_tone_evidence else 0.002
    tone_detail = (
        f"Toe {toe:.3f}, shoulder {shoulder:.3f}, gamma {gamma:.3f}; {confidence['tone']['label']} confidence."
        if has_tone_evidence
        else "The scan set has too little tonal range to fit a curve; conservative curve defaults were retained."
    )

    relationship = "Personal scan-derived interpretation; unpaired and not a measured stock profile"
    stock_reference = args.stock or "User-supplied positive film scan set"
    process_notes = args.process_notes or "Development and scan transfer were not independently measured."
    facts = [
        {"label": "LEARNING SET", "value": f"{len(samples)} positive scan{'s' if len(samples) != 1 else ''}", "note": confidence["overall"]["label"] + " overall confidence"},
        {"label": "REFERENCE", "value": stock_reference, "note": "User-provided label; not inferred"},
        {"label": "IMAGE TYPE", "value": "Monochrome" if monochrome else "Color", "note": "Detected from rendered scan pixels"},
        {"label": "GRAIN SIGNAL", "value": f"{grain_rms:.2f} / 255 RMS", "note": "Smooth-region high-pass residual"},
        {"label": "APPARENT SCALE", "value": scale.title(), "note": "Includes scanner aperture and sharpening"},
        {"label": "STRUCTURE MODEL", "value": f"{crystal} / {emulsion}", "note": "Rendering vocabulary, not chemical identification"},
        {"label": "TONE SPAN", "value": f"{tone_span:.3f}", "note": "5th–95th luminance percentile"},
        {"label": "CAMERA", "value": args.camera or "Not supplied", "note": "Metadata, not image inference"},
        {"label": "SCANNER", "value": args.scanner or "Not supplied", "note": "Material to apparent texture scale"},
    ]

    stock = {
        "id": args.id,
        "name": args.name or args.id.replace("-", " ").title(),
        "maker": args.maker,
        "type": "mono" if monochrome else "color",
        "group": f"LEARNED / {'MONO' if monochrome else 'COLOR'}",
        "sort": 10000,
        "settings": {
            "exposure": 0,
            "contrast": creative_contrast,
            "highlights": 0,
            "shadows": 0,
            "temperature": 0,
            "tint": 0,
            "saturation": 0,
            "fade": fade,
            "grain": grain_amount,
            "vignette": 0,
        },
        "grainProfile": {
            "medium": medium,
            "crystal": crystal,
            "emulsion": emulsion,
            "scale": scale,
            "process": args.process,
        },
        "pipeline": {
            "version": 1,
            "family": family,
            "monochrome": monochrome,
            "scene": {"sensitivity": [0.30, 0.59, 0.11] if monochrome else [1.0, 1.0, 1.0], "flash": 0.0},
            "curve": {
                "toe": rounded(toe),
                "shoulder": rounded(shoulder),
                "gamma": rounded(gamma),
                "saturationCompression": rounded(saturation_compression),
            },
            "crossover": {
                "shadows": [0.0, 0.0, 0.0] if monochrome else chroma_crossover(shadow_cast, baseline_cast),
                "highlights": [0.0, 0.0, 0.0] if monochrome else chroma_crossover(highlight_cast, baseline_cast),
            },
            "chemistry": {
                "silverRetention": 0.0,
                "fog": rounded(fog),
                "flare": 0.0,
                "localContrast": rounded(clamp(0.015 + grain_rms * 0.003, 0.015, 0.055)),
            },
            "optics": {"halation": 0.0, "halationRadius": 0.0, "halationThreshold": 0.92},
            "output": {"tint": [rounded(value) for value in tint], "scanContrast": rounded(scan_contrast)},
            "grain": {
                "meanRadius": rounded(mean_radius),
                "radiusVariance": rounded(radius_variance),
                "shadowBias": rounded(shadow_bias),
                "chroma": rounded(grain_chroma),
            },
        },
        "dossier": {
            "version": 1,
            "reference": {
                "stock": stock_reference,
                "manufacturer": args.lab or args.maker,
                "relationship": relationship,
                "status": "Personal learned scan style",
            },
            "tagline": "A local interpretation learned from the density, color, and texture of a personal film scan set.",
            "portrait": (
                f"{args.name or args.id.replace('-', ' ').title()} translates the shared tendencies of {len(samples)} rendered positive "
                "scan(s) into Grainlab's stage-based pipeline. It preserves a conservative estimate of the set's tone spacing, "
                "neutral cast, density-dependent color separation, and apparent grain structure while leaving unsupported optics at zero."
            ),
            "facts": facts,
            "palette": derive_palette(samples),
            "chapters": [
                {
                    "eyebrow": "LEARNED EVIDENCE",
                    "title": "What the scan pixels can support",
                    "lede": "Measurements are aggregated with medians so one unusual frame has less influence on the style.",
                    "details": [
                        {"label": "Tone", "value": tone_detail},
                        {"label": "Color", "value": f"Neutral output tint {', '.join(f'{value:.3f}' for value in tint)}; {confidence['color']['label']} confidence."},
                        {"label": "Texture", "value": f"{grain_rms:.2f}/255 RMS residual, radius {mean_radius:.2f}, variance {radius_variance:.2f}; {confidence['grain']['label']} confidence."},
                        {"label": "Roll agreement", "value": f"Derived from {len(samples)} frame(s); more varied scenes and flat areas increase confidence."},
                    ],
                    "notes": [
                        "Smooth-region residual includes emulsion grain, scanner noise, compression, sharpening, dust, and fine subject texture.",
                        "Color crossover is estimated only from low-chroma pixels and remains scene-dependent without a target or paired digital capture.",
                    ],
                },
                {
                    "eyebrow": "BOUNDARIES",
                    "title": "A scan look is not a film stock measurement",
                    "lede": "The source is a developed, rendered positive. Several physical stages have already been collapsed into one RGB file.",
                    "details": [
                        {"label": "Exposure and scene", "value": "Unknown subject reflectance and exposure prevent recovery of an absolute sensitometric curve."},
                        {"label": "Lab", "value": process_notes},
                        {"label": "Scan", "value": "Scanner optics, profile, dust removal, denoise, sharpening, and output encoding all influence the learned result."},
                        {"label": "Optics", "value": "Halation and vignette stay at zero because ordinary scenes cannot identify them reliably."},
                    ],
                    "notes": [
                        "Use a whole roll with varied lighting, neutrals, skin, sky, foliage, and defocused areas for a more stable style.",
                        "For calibration-grade work, photograph a target on film and digital under the same controlled illumination and retain scan metadata.",
                    ],
                },
            ],
            "bestFor": [
                "Carrying the visual character of a personal film roll onto iPhone or digital-camera photographs.",
                "Building a repeatable starting point from a lab and scanner combination you already like.",
                "Comparing multiple rolls while keeping every learned parameter inspectable and editable.",
            ],
            "watchFor": [
                "Learning from a single strongly colored or unusually exposed scene.",
                "Treating JPEG sharpening, compression blocks, dust, or scanner noise as emulsion grain.",
                "Naming the result after a stock when development and scan conditions are unknown.",
                "Expecting an unpaired positive scan to recover spectral sensitivity or measured latitude.",
            ],
            "fieldNotes": [
                "A learned style is a memory of this scan chain, not a certificate about the emulsion.",
                "Add frames that disagree with each other; a useful roll signature survives more than one favorite photograph.",
            ],
            "sources": [
                {
                    "title": "Grainlab learned film-style methodology",
                    "publisher": "Grainlab",
                    "url": "https://github.com/adammenges/personal-photo-editor/blob/main/docs/learned-film-styles.md",
                }
            ],
            "verified": date.today().isoformat(),
            "disclaimer": (
                "Generated locally from user-supplied positive scans. This is an interpretive scan style, not a measured film stock, "
                "camera profile, spectral characterization, ICC transform, or manufacturer-endorsed emulation."
            ),
        },
    }
    evidence = {
        "schemaVersion": 1,
        "styleId": args.id,
        "interpretation": relationship,
        "inputCount": len(samples),
        "confidence": confidence,
        "aggregate": {
            "toneSpan": rounded(tone_span),
            "shadowSpacing": rounded(shadow_spacing),
            "highlightSpacing": rounded(highlight_spacing),
            "midtonePosition": rounded(midtone_position),
            "neutralCast": [rounded(value) for value in baseline_cast],
            "grainRms8Bit": rounded(grain_rms),
            "fineToBroadRatio": rounded(fine_ratio),
            "grainTileVariation": rounded(tile_variation),
            "redGreenResidualCorrelation": rounded(red_green),
            "greenBlueResidualCorrelation": rounded(green_blue),
            "autoMonochrome": auto_monochrome,
            "hasToneEvidence": has_tone_evidence,
        },
        "mapping": {
            "conservativeDefaults": ["exposure", "halation", "vignette", "silverRetention", "scannerFlare"],
            "stock": stock,
        },
        "images": [
            {
                "file": str(sample.path),
                "dimensions": [sample.width, sample.height],
                "analyzedDimensions": [sample.analyzed_width, sample.analyzed_height],
                "metrics": sample.metrics,
            }
            for sample in samples
        ],
    }
    return stock, evidence


def ensure_finite_json(value: Any, label: str = "root") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            ensure_finite_json(item, f"{label}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            ensure_finite_json(item, f"{label}[{index}]")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"Non-finite value at {label}")


def validate_learned_stock(stock: dict[str, Any]) -> None:
    ensure_finite_json(stock)
    if not IDENTIFIER.fullmatch(stock["id"]):
        raise ValueError("Style id must contain lowercase letters, digits, and single hyphens only.")
    for key in ("name", "maker", "type", "group"):
        if not isinstance(stock.get(key), str) or not stock[key].strip():
            raise ValueError(f"Stock {key} must be a non-empty string")
    allowed_traits = {
        "medium": {"silver", "dye"},
        "crystal": {"cubic", "tabular", "delta"},
        "emulsion": {"uniform", "mixed", "core-shell"},
        "scale": {"fine", "medium", "coarse"},
        "process": {"standard", "push", "pull", "motion", "bleach", "cross"},
    }
    for key, allowed in allowed_traits.items():
        if stock["grainProfile"].get(key) not in allowed:
            raise ValueError(f"Unsupported grainProfile.{key}")
    pipeline = stock["pipeline"]
    ranges = {
        "scene.flash": (0, 0.2),
        "curve.toe": (0, 1), "curve.shoulder": (0, 1), "curve.gamma": (0.45, 1.8),
        "curve.saturationCompression": (0, 1), "chemistry.silverRetention": (0, 1),
        "chemistry.fog": (0, 0.2), "chemistry.flare": (0, 0.15), "chemistry.localContrast": (0, 0.4),
        "optics.halation": (0, 0.7), "optics.halationRadius": (0, 64), "optics.halationThreshold": (0, 1),
        "output.scanContrast": (0.5, 1.5), "grain.meanRadius": (0.2, 2.5),
        "grain.radiusVariance": (0, 1.5), "grain.shadowBias": (0, 1.5), "grain.chroma": (0, 0.15),
    }
    for path, (minimum, maximum) in ranges.items():
        section, key = path.split(".")
        value = float(pipeline[section][key])
        if not minimum <= value <= maximum:
            raise ValueError(f"pipeline.{path} is outside the supported range")
    for section, key, minimum, maximum in (
        ("scene", "sensitivity", 0, 2), ("crossover", "shadows", -0.2, 0.2),
        ("crossover", "highlights", -0.2, 0.2), ("output", "tint", 0.5, 1.5),
    ):
        vector = pipeline[section][key]
        if len(vector) != 3 or any(not minimum <= float(component) <= maximum for component in vector):
            raise ValueError(f"pipeline.{section}.{key} is outside the supported range")
    if pipeline["family"] not in {"utility", "bw", "c41", "e6", "ecn2", "print"}:
        raise ValueError("Unsupported pipeline family")
    if pipeline.get("version") != 1 or not isinstance(pipeline.get("monochrome"), bool):
        raise ValueError("Pipeline must use version 1 and define monochrome as Boolean")
    if stock["type"] not in {"color", "mono", "utility"}:
        raise ValueError("Unsupported style type")
    dossier = stock["dossier"]
    if dossier.get("version") != 1:
        raise ValueError("Dossier must use version 1")
    for key in ("tagline", "portrait", "verified", "disclaimer"):
        if not isinstance(dossier.get(key), str) or not dossier[key].strip():
            raise ValueError(f"dossier.{key} must be a non-empty string")
    for key in ("stock", "manufacturer", "relationship", "status"):
        if not isinstance(dossier.get("reference", {}).get(key), str) or not dossier["reference"][key].strip():
            raise ValueError(f"dossier.reference.{key} must be a non-empty string")
    for key in ("facts", "palette", "chapters", "bestFor", "watchFor", "fieldNotes", "sources"):
        if not dossier.get(key):
            raise ValueError(f"dossier.{key} cannot be empty")
    for swatch in dossier["palette"]:
        color = swatch.get("hex", "")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError(f"Invalid dossier palette color: {color}")
    for source in dossier["sources"]:
        if not source.get("title") or not source.get("publisher") or not source.get("url", "").startswith("https://"):
            raise ValueError("Dossier sources require title, publisher, and an HTTPS URL")


def write_preview(sample: ScanSample, destination: Path) -> None:
    with Image.open(sample.path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        image.thumbnail((720, 520), RESAMPLE)
        image.save(destination, "JPEG", quality=90, optimize=True)


def metric_value(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.3f}"
    return html.escape(str(value))


def build_report(output_dir: Path, stock: dict[str, Any], evidence: dict[str, Any], samples: list[ScanSample]) -> Path:
    preview_dir = output_dir / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    cards = []
    for index, sample in enumerate(samples, 1):
        preview = preview_dir / f"{index:03d}-{sample.path.stem[:48]}.jpg"
        write_preview(sample, preview)
        metrics = sample.metrics
        cards.append(
            f'<article class="scan"><img src="previews/{html.escape(preview.name)}" alt="Local scan preview">'
            f'<div><p class="eyebrow">SCAN {index:02d}</p><h3>{html.escape(sample.path.name)}</h3>'
            f'<p>{sample.width} × {sample.height} · analyzed at {sample.analyzed_width} × {sample.analyzed_height}</p>'
            f'<dl><div><dt>tone span</dt><dd>{metrics["toneSpan"]:.3f}</dd></div>'
            f'<div><dt>grain RMS</dt><dd>{metrics["grainRms8Bit"]:.2f}/255</dd></div>'
            f'<div><dt>fine/broad</dt><dd>{metrics["fineToBroadRatio"]:.3f}</dd></div>'
            f'<div><dt>neutral pixels</dt><dd>{metrics["neutralPixelFraction"] * 100:.1f}%</dd></div></dl></div></article>'
        )

    confidence = evidence["confidence"]
    pipeline = stock["pipeline"]
    parameter_rows = []
    mappings = (
        ("tone", "curve.toe", pipeline["curve"]["toe"]),
        ("tone", "curve.shoulder", pipeline["curve"]["shoulder"]),
        ("tone", "curve.gamma", pipeline["curve"]["gamma"]),
        ("color", "output.tint", pipeline["output"]["tint"]),
        ("crossover", "crossover.shadows", pipeline["crossover"]["shadows"]),
        ("crossover", "crossover.highlights", pipeline["crossover"]["highlights"]),
        ("grain", "grain.meanRadius", pipeline["grain"]["meanRadius"]),
        ("grain", "grain.radiusVariance", pipeline["grain"]["radiusVariance"]),
        ("grain", "grain.shadowBias", pipeline["grain"]["shadowBias"]),
        ("grain", "grain.chroma", pipeline["grain"]["chroma"]),
    )
    for area, name, value in mappings:
        parameter_rows.append(
            f"<tr><td><code>{html.escape(name)}</code></td><td>{metric_value(value)}</td>"
            f'<td><span class="confidence {confidence[area]["label"]}">{confidence[area]["label"]} · {confidence[area]["score"]:.2f}</span></td></tr>'
        )

    report = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(stock['name'])} · learned film style</title>
<style>
:root{{--bg:#090c0b;--panel:#111613;--ink:#e7eee9;--muted:#8e9a93;--line:#28312c;--green:#78e2a8;--amber:#f0bd6d;--red:#ff8b7c}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}}main{{width:min(1180px,calc(100% - 32px));margin:auto;padding:56px 0 90px}}h1{{font-size:clamp(32px,6vw,68px);line-height:.95;letter-spacing:-.06em;margin:.2em 0}}h2{{margin:48px 0 16px;font-size:22px}}h3{{margin:0 0 6px}}p{{color:var(--muted)}}a{{color:var(--green)}}.eyebrow{{color:var(--green);font-size:12px;letter-spacing:.16em;margin:0}}.hero{{border:1px solid var(--line);padding:30px;background:linear-gradient(135deg,#121a15,#0b0f0d)}}.warning{{border-left:3px solid var(--amber);padding:12px 18px;background:#19150f;color:#e8d3ae}}.summary{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:22px}}.summary div,.scan,table{{border:1px solid var(--line);background:var(--panel)}}.summary div{{padding:16px}}.summary strong{{display:block;font-size:22px}}.summary span{{color:var(--muted);font-size:12px}}.scans{{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px}}.scan{{overflow:hidden}}.scan img{{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#050706}}.scan>div{{padding:18px}}dl{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}dl div{{border-top:1px solid var(--line);padding-top:6px}}dt{{color:var(--muted);font-size:11px}}dd{{margin:0}}table{{width:100%;border-collapse:collapse}}th,td{{padding:12px;text-align:left;border-bottom:1px solid var(--line)}}th{{color:var(--muted);font-size:11px}}code{{color:#bfe9ce}}.confidence{{padding:3px 7px;border:1px solid var(--line);border-radius:99px}}.high{{color:var(--green)}}.medium{{color:var(--amber)}}.low{{color:var(--red)}}pre{{overflow:auto;padding:18px;border:1px solid var(--line);background:#070908;color:#b8c5bd}}@media(max-width:700px){{.summary{{grid-template-columns:1fr 1fr}}}}
</style></head><body><main>
<section class="hero"><p class="eyebrow">GRAINLAB / LEARNED STYLE</p><h1>{html.escape(stock['name'])}</h1>
<p>{html.escape(stock['dossier']['portrait'])}</p>
<p class="warning"><strong>Interpretation boundary:</strong> an unpaired positive scan cannot separate film stock from scene, exposure, development, lab printing, scanner profile, denoise, sharpening, or compression. This report describes the combined scan look.</p>
<div class="summary"><div><strong>{len(samples)}</strong><span>scans</span></div><div><strong>{stock['type']}</strong><span>detected image type</span></div><div><strong>{confidence['overall']['label']}</strong><span>overall confidence · {confidence['overall']['score']:.2f}</span></div><div><strong>{stock['grainProfile']['scale']}</strong><span>apparent texture scale</span></div></div></section>
<h2>Source evidence</h2><div class="scans">{''.join(cards)}</div>
<h2>Generated mapping</h2><table><thead><tr><th>parameter</th><th>value</th><th>confidence</th></tr></thead><tbody>{''.join(parameter_rows)}</tbody></table>
<h2>Conservative zeros</h2><p>Exposure, halation, vignette, silver retention, and scanner flare remain at neutral defaults. Ordinary scan pixels do not identify those stages reliably enough to automate them.</p>
<h2>Artifacts</h2><p><a href="{html.escape(stock['id'])}.json">installable stock JSON</a> · <a href="analysis.json">complete measurement evidence</a></p>
<details><summary>Generated stock preview</summary><pre>{html.escape(json.dumps(stock, indent=2))}</pre></details>
</main></body></html>"""
    destination = output_dir / "index.html"
    atomic_write_text(destination, report)
    return destination


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Analyze positive film scans locally and generate a data-driven Grainlab style.",
        epilog="Nothing is uploaded. Use a folder from one roll for a more stable result than a single favorite frame.",
    )
    result.add_argument("--input", action="append", required=True, help="Scan file or directory; repeat for multiple sources.")
    result.add_argument("--recursive", action="store_true", help="Search input directories recursively.")
    result.add_argument("--id", required=True, help="Lowercase hyphenated style id, for example my-portra-roll-01.")
    result.add_argument("--name", help="Display name; defaults to a title-cased id.")
    result.add_argument("--maker", default="Personal", help="Library maker label (default: Personal).")
    result.add_argument("--stock", help="Known film stock; metadata only and never inferred.")
    result.add_argument("--camera", help="Film camera or format; metadata only.")
    result.add_argument("--scanner", help="Scanner or lab scan path; metadata only.")
    result.add_argument("--lab", help="Lab/developer identity; metadata only.")
    result.add_argument("--process-notes", help="Known developer, dilution, temperature, push/pull, or scan notes.")
    result.add_argument("--family", choices=("auto", "bw", "c41", "e6", "ecn2", "print"), default="auto")
    result.add_argument("--monochrome", choices=("auto", "yes", "no"), default="auto")
    result.add_argument("--medium", choices=("auto", "silver", "dye"), default="auto")
    result.add_argument("--process", choices=("standard", "push", "pull", "motion", "bleach", "cross"), default="standard")
    result.add_argument("--maximum-edge", type=int, default=1600, help="Analysis proxy long edge; source files are never modified.")
    result.add_argument("--output-root", type=Path, default=ROOT / "artifacts" / "learned-styles")
    result.add_argument("--install", action="store_true", help="Also install the generated JSON under ui/film-stocks/learned/.")
    result.add_argument("--force", action="store_true", help="Allow replacement of an existing artifact and installed style.")
    return result


def run(arguments: list[str] | None = None) -> int:
    args = parser().parse_args(arguments)
    if not IDENTIFIER.fullmatch(args.id):
        raise SystemExit("--id must contain lowercase letters, digits, and single hyphens only.")
    if args.maximum_edge < 512:
        raise SystemExit("--maximum-edge must be at least 512 pixels for useful grain evidence.")
    sources = discover_inputs(args.input, args.recursive)
    output_dir = args.output_root.expanduser().resolve() / args.id
    installed_path = ROOT / "ui" / "film-stocks" / "learned" / f"{args.id}.json"
    candidate_path = output_dir / f"{args.id}.json"
    if output_dir.exists() and not args.force:
        raise SystemExit(f"Artifact already exists: {output_dir}\nPass --force to replace this style's generated report.")
    if args.install and installed_path.exists() and not args.force:
        raise SystemExit(f"Installed style already exists: {installed_path}\nPass --force to replace it.")
    existing = existing_stock_path(args.id) if args.install else None
    if existing is not None and existing != installed_path.resolve():
        raise SystemExit(f"Style id {args.id!r} is already owned by {existing}; choose a unique --id.")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    print(f"analyzing {len(sources)} local scan(s)")
    samples = []
    for source in sources:
        print(f"  scan  {source}")
        samples.append(analyze_scan(source, args.maximum_edge))
    stock, evidence = derive_style(samples, args)
    validate_learned_stock(stock)
    atomic_write_text(candidate_path, json.dumps(stock, indent=2, ensure_ascii=False) + "\n")
    atomic_write_text(output_dir / "analysis.json", json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
    report_path = build_report(output_dir, stock, evidence, samples)

    if args.install:
        installed_path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(installed_path, candidate_path.read_text())
        print(f"installed {installed_path}")
        print("run `make check` to validate the style and rebuild the library manifest")
    else:
        print("candidate only; pass --install after reviewing the evidence report")
    print(f"style     {candidate_path}")
    print(f"evidence  {output_dir / 'analysis.json'}")
    print(f"report    {report_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except (OSError, ValueError) as error:
        print(f"film-style learning failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
