# Learned film styles

Grainlab can analyze one positive film scan or a directory from one roll and turn the shared scan look into a normal, data-driven stock definition. The work is local: source photographs are read from disk, an analysis proxy is held in memory, and the generated JSON and evidence report stay beneath `artifacts/learned-styles/` unless installation is explicitly requested.

## Quick start

Use several frames from the same roll and scan path when possible:

```bash
./scripts/learn_film_style.sh \
  --input "/path/to/roll-07" \
  --id summer-portra-07 \
  --name "Summer Portra · Roll 07" \
  --stock "Kodak Portra 400" \
  --camera "Mamiya 7 · 80 mm" \
  --scanner "Noritsu HS-1800" \
  --lab "My local lab"
```

The first run creates a reviewable candidate, a complete measurement file, local thumbnails, and an HTML report:

```text
artifacts/learned-styles/summer-portra-07/
  summer-portra-07.json
  analysis.json
  index.html
  previews/
```

Nothing is added to the app yet. Review `index.html`, then rerun the same command with `--install --force`. Installation writes `ui/film-stocks/learned/summer-portra-07.json`. Run `make check` or `cargo check --manifest-path src-tauri/Cargo.toml --locked` afterward so the build script validates the profile and regenerates the library manifest.

For the shortest developer workflow:

```bash
make learn-style INPUT="/path/to/roll-07" ID=summer-portra-07 NAME="Summer Portra · Roll 07"
```

That target installs the result and rebuilds the stock manifest. Direct script use is better when you want to add camera, scanner, stock, laboratory, family, or process metadata.

## What is measured

The analyzer uses robust per-frame measurements and aggregates a roll with medians. It estimates:

- tone percentile spacing for a restrained toe, shoulder, gamma, fade, and scan-contrast starting point;
- low-chroma pixel balance for neutral output tint;
- differences between low-chroma shadows and highlights for conservative channel crossover;
- smooth-region high-pass RMS, tone-binned texture, fine-to-broad energy, tile variation, and RGB residual correlation for apparent grain amount, radius, variance, shadow bias, and color-layer structure;
- monochrome likelihood from source mode and channel agreement;
- four roll-derived palette swatches for the dossier.

Each parameter family gets a confidence score. A single scan can produce a useful sketch, but multiple varied frames improve tone/color stability and allow the report to measure roll agreement.

The source is never changed or used as an editor proxy. `--maximum-edge` affects analysis cost only; Grainlab's editor still retains its full-resolution decoded source buffer.

## What is deliberately not inferred

An ordinary positive scan cannot separate the subject and exposure from the film, development, lab correction, scanner transfer, denoise, sharpening, dust removal, compression, or display encoding. The result is therefore named a **learned scan style**, not a measured film stock profile.

The automatic mapping leaves these parameters neutral:

- exposure, because scene reflectance and camera exposure are unknown;
- halation, because bright subject edges do not prove emulsion backscatter;
- vignette, because scene lighting, lens falloff, cropping, and lab correction are entangled;
- silver retention, because desaturation alone does not identify retained metallic silver;
- scanner flare, because global black level does not isolate optical veiling flare.

Supplying `--stock`, `--camera`, `--scanner`, `--lab`, or `--process-notes` records known provenance; it never changes a measurement into an inferred fact. Use `--family`, `--monochrome`, `--medium`, and `--process` only when those facts are known.

## Better capture protocol

A useful roll set contains varied daylight and artificial light, neutral objects, skin, sky, foliage, deep shadows, highlights, and smooth or defocused areas. Keep every frame on the same film, development, scanner, and lab-correction path. Prefer high-quality TIFF or minimally compressed JPEG scans and disable automatic sharpening or dust removal when you want to study emulsion texture.

For stronger calibration, photograph a grayscale wedge and color target on film and digital under controlled illumination, record exposure and development, scan at a known optical resolution with corrections disabled, and include an unsharpened flat-density area. Paired targets can support claims that an ordinary folder of finished photographs cannot.

## Safety and replacement

Supported inputs are JPG, PNG, WebP, TIFF, and directories containing those formats. Directories are non-recursive unless `--recursive` is passed. Existing artifacts and installed styles are never replaced unless `--force` is explicit. Style ids accept lowercase letters, digits, and hyphens only, preventing path traversal and keeping stock ids portable.

The generated stock uses the same version-1 schema as every built-in profile. There are no learned-style branches in the renderer: after installation, WGSL and CPU fallback process it through the same scene, emulsion, chemistry, scan/output, and image-forming grain stages.
