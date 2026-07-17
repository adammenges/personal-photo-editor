#!/usr/bin/env python3
"""Measure visual fixtures and build Grainlab's local calibration report."""

from __future__ import annotations

from datetime import datetime, timezone
import html
import json
import math
import os
from pathlib import Path
import sys

try:
    import numpy as np
    from PIL import Image, ImageOps
except ImportError as error:  # pragma: no cover - environment guidance
    raise SystemExit(
        "Visual reporting needs Pillow and NumPy. Run scripts/run_visual_tests.sh "
        "inside Codex or use a Python environment containing those packages."
    ) from error


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "tests" / "visual" / "fixture-manifest.json"
REPORT_DIR = ROOT / "artifacts" / "visual-tests" / "report"
CROP_DIR = REPORT_DIR / "crops"
RESAMPLE = Image.Resampling.LANCZOS


def normalized_crop(image: Image.Image, crop: list[float] | None) -> Image.Image:
    if not crop:
        return image
    x, y, width, height = crop
    left = round(image.width * x)
    top = round(image.height * y)
    right = round(image.width * (x + width))
    bottom = round(image.height * (y + height))
    return image.crop((left, top, max(left + 1, right), max(top + 1, bottom)))


def preview(path: Path, crop: list[float] | None, name: str) -> str:
    destination = CROP_DIR / f"{name}.jpg"
    with Image.open(path) as original:
        image = normalized_crop(ImageOps.exif_transpose(original), crop).convert("RGB")
        image.thumbnail((760, 620), RESAMPLE)
        image.save(destination, "JPEG", quality=91, optimize=True)
    return f"crops/{destination.name}"


def metric_arrays(path: Path, crop: list[float] | None, maximum_edge: int = 1200) -> tuple[np.ndarray, np.ndarray | None]:
    with Image.open(path) as original:
        image = normalized_crop(ImageOps.exif_transpose(original), crop)
        scale = min(1.0, maximum_edge / max(image.size))
        if scale < 1:
            size = tuple(max(3, round(value * scale)) for value in image.size)
            image = image.resize(size, RESAMPLE)

        if image.mode.startswith("I;16") or image.mode in {"I", "F"}:
            values = np.asarray(image.convert("F"), dtype=np.float32)
            maximum = 65535.0 if float(values.max(initial=0)) > 255 else 255.0
            luminance = np.clip(values / maximum, 0, 1)
            return luminance, None

        rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
        return luminance, rgb


def highpass(values: np.ndarray) -> np.ndarray:
    center = values[1:-1, 1:-1]
    blurred = (
        values[:-2, :-2]
        + 2 * values[:-2, 1:-1]
        + values[:-2, 2:]
        + 2 * values[1:-1, :-2]
        + 4 * center
        + 2 * values[1:-1, 2:]
        + values[2:, :-2]
        + 2 * values[2:, 1:-1]
        + values[2:, 2:]
    ) / 16
    return center - blurred


def rms(values: np.ndarray) -> float | None:
    if values.size < 16:
        return None
    return float(np.sqrt(np.mean(np.square(values)))) * 255


def safe_correlation(first: np.ndarray, second: np.ndarray, mask: np.ndarray) -> float | None:
    a = first[mask]
    b = second[mask]
    if a.size < 16 or float(a.std()) < 1e-8 or float(b.std()) < 1e-8:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def metrics(path: Path, crop: list[float] | None) -> dict[str, float | None]:
    luminance, rgb = metric_arrays(path, crop)
    residual = highpass(luminance)
    center = luminance[1:-1, 1:-1]
    gradient = np.maximum.reduce(
        [
            np.abs(center - luminance[:-2, 1:-1]),
            np.abs(center - luminance[2:, 1:-1]),
            np.abs(center - luminance[1:-1, :-2]),
            np.abs(center - luminance[1:-1, 2:]),
        ]
    )
    smooth = gradient <= np.quantile(gradient, 0.38)
    result: dict[str, float | None] = {"smooth": rms(residual[smooth])}
    for key, low, high in (
        ("shadow", 0.00, 0.25),
        ("middle", 0.25, 0.68),
        ("highlight", 0.68, 1.01),
    ):
        result[key] = rms(residual[smooth & (center >= low) & (center < high)])

    result["red_green"] = None
    result["green_blue"] = None
    if rgb is not None:
        channel_residuals = [highpass(rgb[..., channel]) for channel in range(3)]
        result["red_green"] = safe_correlation(channel_residuals[0], channel_residuals[1], smooth)
        result["green_blue"] = safe_correlation(channel_residuals[1], channel_residuals[2], smooth)
    return result


def power_spectrum(path: Path) -> tuple[np.ndarray, np.ndarray]:
    luminance, _ = metric_arrays(path, None, maximum_edge=1800)
    side = min(1024, luminance.shape[0], luminance.shape[1])
    y = (luminance.shape[0] - side) // 2
    x = (luminance.shape[1] - side) // 2
    patch = luminance[y:y + side, x:x + side].astype(np.float64)
    patch -= patch.mean()
    window = np.outer(np.hanning(side), np.hanning(side))
    power = np.abs(np.fft.rfft2(patch * window)) ** 2
    fy = np.fft.fftfreq(side)[:, None]
    fx = np.fft.rfftfreq(side)[None, :]
    radius = np.sqrt(fx * fx + fy * fy)
    edges = np.linspace(0, 0.5, 65)
    bins = np.digitize(radius.ravel(), edges)
    radial = np.array(
        [power.ravel()[bins == index].mean() if np.any(bins == index) else np.nan for index in range(1, len(edges))]
    )
    radial = 10 * np.log10(np.maximum(radial, 1e-30))
    radial -= np.nanmax(radial[1:])
    frequencies = (edges[:-1] + edges[1:]) / 2
    # The first annulus contains residual DC/window leakage and is not grain.
    # Omitting it keeps the normalized chart focused on spatial structure.
    return frequencies[1:], radial[1:]


def series_svg(series: list[tuple[str, np.ndarray, np.ndarray]], x_label: str, y_label: str) -> str:
    width, height = 900, 310
    left, top, right, bottom = 64, 24, 24, 54
    plot_width = width - left - right
    plot_height = height - top - bottom
    all_x = np.concatenate([item[1] for item in series])
    all_y = np.concatenate([item[2][np.isfinite(item[2])] for item in series])
    x_min, x_max = float(all_x.min()), float(all_x.max())
    raw_min = float(all_y.min())
    raw_max = float(all_y.max())
    if raw_min >= 0 and raw_max <= 1.05:
        y_min, y_max = 0.0, 1.0
    elif raw_max - raw_min <= 12:
        y_min = math.floor(raw_min)
        y_max = max(0.0, math.ceil(raw_max))
    else:
        y_min = math.floor(raw_min / 5) * 5
        y_max = max(0.0, math.ceil(raw_max / 5) * 5)
    if math.isclose(y_min, y_max):
        y_min -= 1
        y_max += 1

    def point(x_value: float, y_value: float) -> tuple[float, float]:
        px = left + (x_value - x_min) / (x_max - x_min) * plot_width
        py = top + (y_max - y_value) / (y_max - y_min) * plot_height
        return px, py

    colors = ("#69e5a6", "#ffbe6f", "#7bb7ff", "#e687ff")
    elements = [f'<svg class="chart" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(y_label)} by {html.escape(x_label)}">']
    for step in range(5):
        fraction = step / 4
        py = top + fraction * plot_height
        value = y_max - fraction * (y_max - y_min)
        tick = f"{value:.1f}" if y_max - y_min <= 2 else f"{value:.0f}"
        elements.append(f'<line x1="{left}" y1="{py:.1f}" x2="{width-right}" y2="{py:.1f}" class="grid"/>')
        elements.append(f'<text x="{left-10}" y="{py+4:.1f}" text-anchor="end">{tick}</text>')
    elements.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{height-bottom}" class="axis"/>')
    elements.append(f'<line x1="{left}" y1="{height-bottom}" x2="{width-right}" y2="{height-bottom}" class="axis"/>')
    for index, (label, x_values, y_values) in enumerate(series):
        coordinates = [point(float(x_value), float(y_value)) for x_value, y_value in zip(x_values, y_values) if np.isfinite(y_value)]
        path = " ".join(("M" if item == 0 else "L") + f" {x:.2f} {y:.2f}" for item, (x, y) in enumerate(coordinates))
        color = colors[index % len(colors)]
        elements.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="2.2"/>')
        elements.append(f'<g class="legend"><rect x="{left + index * 205}" y="{height-26}" width="12" height="3" fill="{color}"/><text x="{left + 18 + index * 205}" y="{height-21}">{html.escape(label)}</text></g>')
    elements.append(f'<text x="{left + plot_width/2:.1f}" y="{height-5}" text-anchor="middle">{html.escape(x_label)}</text>')
    elements.append(f'<text transform="translate(15 {top + plot_height/2:.1f}) rotate(-90)" text-anchor="middle">{html.escape(y_label)}</text>')
    elements.append("</svg>")
    return "".join(elements)


def wedge_series(path: Path) -> tuple[np.ndarray, np.ndarray]:
    luminance, _ = metric_arrays(path, None, maximum_edge=2048)
    height, width = luminance.shape
    values: list[float] = []
    for patch in range(16):
        left = round(width * (patch + 0.16) / 16)
        right = round(width * (patch + 0.84) / 16)
        top = round(height * 0.15)
        bottom = round(height * 0.85)
        values.append(rms(highpass(luminance[top:bottom, left:right])) or 0)
    return np.arange(16), np.asarray(values)


def fmt(value: float | None, digits: int = 2) -> str:
    return "—" if value is None or not math.isfinite(value) else f"{value:.{digits}f}"


def path_link(path: Path) -> str:
    return Path(os.path.relpath(path, REPORT_DIR)).as_posix()


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text())
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    CROP_DIR.mkdir(parents=True, exist_ok=True)

    assets = {asset["id"]: asset for group in ("references", "inputs", "synthetic") for asset in manifest[group]}
    missing_sources = [asset["id"] for group in ("references", "inputs") for asset in manifest[group] if not (ROOT / asset["path"]).exists()]
    if missing_sources:
        raise SystemExit("Missing sources: " + ", ".join(missing_sources) + ". Run scripts/fetch_visual_fixtures.py.")

    reference_cards = []
    metric_rows = []
    for asset in manifest["references"]:
        path = ROOT / asset["path"]
        image_preview = preview(path, asset.get("crop"), asset["id"])
        reference_cards.append(
            f'<article class="reference-card"><img src="{image_preview}" alt="Crop from {html.escape(asset["title"])}">'
            f'<div><p class="eyebrow">{html.escape(asset["kind"])}</p><h3>{html.escape(asset["title"])}</h3>'
            f'<p>{html.escape(asset["diagnostic"])}</p><p class="meta">{html.escape(asset["capture"].get("film", ""))} · '
            f'{html.escape(asset["capture"].get("scanner", ""))}</p><a href="{html.escape(asset["sourcePage"])}">source + license ↗</a></div></article>'
        )
        metric_rows.append((asset["title"], "real film", metrics(path, asset.get("crop"))))

    render_cards = []
    completed = 0
    for case in manifest["renderCases"]:
        source_asset = assets[case["sourceId"]]
        source_path = ROOT / case["sourcePath"]
        output_path = ROOT / case["outputPath"]
        crop = source_asset.get("crop")
        source_preview = preview(source_path, crop, f"{case['id']}-source")
        source_full = path_link(source_path)
        if output_path.exists():
            completed += 1
            output_preview = preview(output_path, crop, f"{case['id']}-rendered")
            output_full = path_link(output_path)
            output_html = f'<a href="{output_full}"><img src="{output_preview}" alt="{html.escape(case["presetName"])} render"></a>'
            metric_rows.append((case["id"], "Grainlab", metrics(output_path, crop)))
        else:
            output_html = '<div class="missing">BASELINE NOT RENDERED</div>'
        render_cards.append(
            f'<article class="render-case"><header><div><p class="eyebrow">{html.escape(case["presetId"])}</p>'
            f'<h3>{html.escape(source_asset["title"])} → {html.escape(case["presetName"])}</h3></div>'
            f'<span class="status {"pass" if output_path.exists() else "pending"}">{"ready" if output_path.exists() else "pending"}</span></header>'
            f'<div class="pair"><figure><a href="{source_full}"><img src="{source_preview}" alt="Source crop"></a><figcaption>source</figcaption></figure>'
            f'<figure>{output_html}<figcaption>Grainlab output</figcaption></figure></div>'
            f'<p>{html.escape(case["diagnostic"])}</p></article>'
        )

    metric_html = []
    for name, kind, values in metric_rows:
        metric_html.append(
            "<tr>"
            f"<td><strong>{html.escape(name)}</strong><small>{html.escape(kind)}</small></td>"
            f"<td>{fmt(values['smooth'])}</td><td>{fmt(values['shadow'])}</td>"
            f"<td>{fmt(values['middle'])}</td><td>{fmt(values['highlight'])}</td>"
            f"<td>{fmt(values['red_green'])}</td><td>{fmt(values['green_blue'])}</td>"
            "</tr>"
        )

    spectrum_series = []
    tri_x_reference = ROOT / assets["tri-x-400-grain-flat"]["path"]
    frequencies, power = power_spectrum(tri_x_reference)
    spectrum_series.append(("real Tri-X 400 scan", frequencies, power))
    reference_frequency = frequencies
    reference_power = power
    flat_case = next(case for case in manifest["renderCases"] if case["id"] == "middle-gray-tri-x-320")
    flat_output = ROOT / flat_case.get("detailOutputPath", flat_case["outputPath"])
    spectrum_observation = "The generated 100% comparison is not available yet."
    if flat_output.exists():
        frequencies, power = power_spectrum(flat_output)
        spectrum_series.append(("Grainlab Tri-X 320", frequencies, power))
        reference_high = float(reference_power[(reference_frequency >= 0.20) & (reference_frequency <= 0.35)].mean())
        generated_high = float(power[(frequencies >= 0.20) & (frequencies <= 0.35)].mean())
        high_band_gap = generated_high - reference_high
        if high_band_gap < -6:
            spectrum_observation = (
                f"Current calibration signal: the generated 100% crop carries {abs(high_band_gap):.1f} dB less "
                "normalized energy in the 0.20–0.35 cycles/pixel band, so it reads materially smoother than this scan. "
                "That is a tuning direction, not a hard failure, until film-area scale and scanner transfer are normalized."
            )
        else:
            spectrum_observation = (
                f"Current calibration signal: the generated high-frequency band differs by {high_band_gap:+.1f} dB from "
                "the reference after normalization. Treat the direction as guidance until physical scale is normalized."
            )
    spectrum_chart = series_svg(spectrum_series, "spatial frequency (cycles / pixel)", "relative power (dB)")

    wedge_case = next(case for case in manifest["renderCases"] if case["id"] == "tone-wedge-portra-400")
    wedge_output = ROOT / wedge_case["outputPath"]
    model_response_path = ROOT / "artifacts" / "visual-tests" / "model-grain-response.json"
    if wedge_output.exists() and model_response_path.exists():
        patches, granularity = wedge_series(wedge_output)
        model_response = json.loads(model_response_path.read_text())
        activation = np.asarray(model_response["activationDeviation"], dtype=np.float64)
        granularity /= max(float(granularity.max(initial=0)), 1e-12)
        activation /= max(float(activation.max(initial=0)), 1e-12)
        wedge_chart = series_svg(
            [
                ("WGSL fit-view wedge", patches, granularity),
                ("CPU crystal activation", patches, activation),
            ],
            "linear-light wedge patch (dark → light)",
            "relative granularity (each curve normalized)",
        )
    else:
        wedge_chart = '<div class="missing chart-missing">Render the tone-wedge baseline to populate this chart.</div>'

    provenance_rows = []
    for asset in [*manifest["references"], *manifest["inputs"]]:
        provenance_rows.append(
            f'<tr><td><a href="{html.escape(asset["sourcePage"])}">{html.escape(asset["title"])}</a></td>'
            f'<td>{html.escape(asset["author"])}</td><td><a href="{html.escape(asset["license"]["url"])}">{html.escape(asset["license"]["name"])}</a></td>'
            f'<td><code>{html.escape(asset["sha256"][:12])}…</code></td></tr>'
        )

    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")
    document = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grainlab visual calibration</title>
<style>
:root {{ color-scheme: dark; --ink:#dce7e1; --muted:#8d9e95; --panel:#101713; --line:#27332c; --green:#69e5a6; --amber:#ffbe6f; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:#070a08; color:var(--ink); font:15px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }}
main {{ width:min(1240px,calc(100% - 36px)); margin:0 auto; padding:48px 0 80px; }}
h1,h2,h3,p {{ margin-top:0; }} h1 {{ font-size:clamp(34px,7vw,76px); line-height:.96; letter-spacing:-.06em; max-width:900px; }}
h2 {{ margin-top:64px; padding-top:18px; border-top:1px solid var(--line); font-size:20px; letter-spacing:.08em; text-transform:uppercase; }}
h3 {{ font-size:17px; }} a {{ color:var(--green); }} .lede {{ max-width:850px; color:#b9c8c0; font-size:17px; }}
.eyebrow {{ color:var(--green); font-size:11px; letter-spacing:.12em; text-transform:uppercase; margin-bottom:8px; }}
.summary {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:30px 0; }}
.summary div,.reference-card,.render-case,.chart-wrap {{ background:var(--panel); border:1px solid var(--line); border-radius:8px; }}
.summary div {{ padding:17px; }} .summary strong {{ display:block; font-size:24px; color:var(--green); }} .summary small,.meta,small {{ color:var(--muted); }}
.reference-grid {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }} .reference-card {{ overflow:hidden; }}
.reference-card img {{ width:100%; aspect-ratio:16/9; display:block; object-fit:cover; image-rendering:auto; }} .reference-card div {{ padding:20px; }}
.render-grid {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }} .render-case {{ padding:18px; }} .render-case header {{ display:flex; justify-content:space-between; gap:16px; }}
.pair {{ display:grid; grid-template-columns:1fr 1fr; gap:9px; }} figure {{ margin:0; }} .pair img,.missing {{ width:100%; aspect-ratio:1; object-fit:cover; border:1px solid var(--line); display:block; }}
figcaption {{ color:var(--muted); padding:6px 0 14px; text-transform:uppercase; font-size:10px; }} .missing {{ display:grid; place-items:center; color:var(--amber); text-align:center; padding:18px; }}
.status {{ border:1px solid; border-radius:99px; padding:3px 9px; height:max-content; font-size:10px; text-transform:uppercase; }} .status.pass {{ color:var(--green); }} .status.pending {{ color:var(--amber); }}
.chart-wrap {{ padding:18px; overflow:auto; margin-bottom:14px; }} .chart {{ min-width:720px; width:100%; }} .chart text {{ fill:var(--muted); font-size:11px; }} .chart .grid {{ stroke:#1e2923; }} .chart .axis {{ stroke:#607168; }} .chart-missing {{ aspect-ratio:auto; min-height:190px; }}
table {{ border-collapse:collapse; width:100%; background:var(--panel); }} th,td {{ border:1px solid var(--line); padding:10px; text-align:right; }} th {{ color:var(--muted); font-size:10px; text-transform:uppercase; }} td:first-child,th:first-child {{ text-align:left; }} td strong,td small {{ display:block; }} code {{ color:#c1d2c9; }}
.note {{ border-left:2px solid var(--amber); padding:2px 0 2px 14px; color:#becbc4; max-width:920px; }}
footer {{ margin-top:60px; color:var(--muted); }}
@media (max-width:820px) {{ .summary,.reference-grid,.render-grid {{ grid-template-columns:1fr; }} main {{ width:min(100% - 22px,1240px); }} .table-scroll {{ overflow:auto; }} }}
</style>
</head>
<body><main>
<p class="eyebrow">GRAINLAB / MATERIAL RESPONSE QA</p>
<h1>Does the image look developed, or merely covered in noise?</h1>
<p class="lede">This report puts the same renderer against controlled charts, real iPhone scenes, and real film scans. The goal is not pixel matching between unlike capture chains; it is to catch detached overlays, chroma speckle, uniform-opacity grain, unstable slider motion, and spatial spectra that no longer resemble photographic material.</p>
<section class="summary"><div><strong>5 / 5</strong><small>licensed source files verified</small></div><div><strong>{completed} / {len(manifest['renderCases'])}</strong><small>Grainlab baselines rendered</small></div><div><strong>fixed seed</strong><small>temporal pattern invariant covered by the model regression</small></div></section>

<h2>01 / Real film anchors</h2>
<p class="note">The Tri-X sample is a controlled 16-bit flat scan, so it is the quantitative anchor. The Portra scene is a perceptual anchor. Scan resolution, enlargement, developer, and sharpening are not normalized, so absolute grain size is deliberately not treated as ground truth.</p>
<div class="reference-grid">{''.join(reference_cards)}</div>

<h2>02 / iPhone + synthetic render matrix</h2>
<div class="render-grid">{''.join(render_cards)}</div>

<h2>03 / Spatial-frequency comparison</h2>
<p>Curves are normalized to their own strongest non-DC band. The Grainlab trace uses a browser-captured 100% center crop, not the fit-view baseline. Shape matters here: a hard high-frequency shelf suggests digital noise; excessive low-frequency energy suggests blobs or cloudy tiling. The reference and emulation do not share a physical pixels-per-micron scale.</p>
<div class="chart-wrap">{spectrum_chart}</div>
<p class="note">{html.escape(spectrum_observation)}</p>

<h2>04 / Tone-dependent granularity</h2>
<p>The flat-overlay failure is a nearly horizontal line. A photographic response changes with exposure because crystal activation and the film curve change together. The exact shape is stock- and process-dependent.</p>
<div class="chart-wrap">{wedge_chart}</div>

<h2>05 / Diagnostic measurements</h2>
<p>RMS values are 8-bit-level equivalents measured after a 3×3 high-pass filter inside the smoothest 38% of each crop. Channel correlations close to 1 are neutral/common structure; lower color-channel correlation is expected for dye clouds, but arbitrary independent RGB noise is not.</p>
<div class="table-scroll"><table><thead><tr><th>fixture</th><th>smooth RMS</th><th>shadows</th><th>midtones</th><th>highlights</th><th>R↔G</th><th>G↔B</th></tr></thead><tbody>{''.join(metric_html)}</tbody></table></div>

<h2>06 / Provenance</h2>
<p>Source files live only under the ignored <code>artifacts/</code> tree. The manifest records exact checksums and the fetcher revalidates every file. Grainlab remains local-only; no fixture is uploaded by the test suite.</p>
<div class="table-scroll"><table><thead><tr><th>asset</th><th>author</th><th>license</th><th>SHA-256</th></tr></thead><tbody>{''.join(provenance_rows)}</tbody></table></div>

<footer>Generated {html.escape(now)} · <a href="../../../tests/visual/fixture-manifest.json">fixture manifest</a> · <a href="../../../tests/visual/README.md">test protocol</a></footer>
</main></body></html>"""
    (REPORT_DIR / "index.html").write_text(document)
    print(f"report   {REPORT_DIR / 'index.html'}")
    print(f"renders  {completed} / {len(manifest['renderCases'])} present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
