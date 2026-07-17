# Grainlab visual calibration suite

This suite tests whether Grainlab forms texture with the image instead of placing animated noise over it. It combines three kinds of evidence because no single photograph can validate the model:

1. **Controlled charts** isolate tone response, grain spectrum, and highlight scatter.
2. **iPhone source photographs** expose interaction with real computational-photography artifacts, skies, water, foliage, skin, deep shadows, and point highlights.
3. **Real film scans** anchor perceptual structure and spatial-frequency balance.

All source images are local, licensed, checksummed fixtures. They are downloaded into the ignored `artifacts/visual-tests/` directory and are never uploaded by the application or test scripts. Exact authorship, license, source page, dimensions, capture notes, and SHA-256 values live in [`fixture-manifest.json`](fixture-manifest.json).

## Run the suite

```bash
make visual-test
open artifacts/visual-tests/report/index.html
```

The first command:

- fetches or verifies the five licensed source files;
- creates 2048-pixel iPhone QA fixtures without altering the originals;
- creates deterministic middle-gray, step-wedge, and highlight-edge charts;
- runs the fixed-field grain-model regression;
- measures the stock's fixed-field crystal-activation response across the same 16 exposure patches;
- measures every available Grainlab baseline and builds the HTML report.

The full-resolution originals are retained in `artifacts/visual-tests/sources/`. The 2048-pixel files are distinct test inputs, not editor proxies: Grainlab still decodes and renders every pixel in each fixture. The Tri-X flat-field case also stores a centered 100% browser capture for spatial-frequency analysis; fit-view screenshots are never used for that comparison.

## Refresh renderer baselines

Render baselines through Grainlab itself. Do not reproduce the pipeline in a test-only image script; that would test a second implementation. The in-app browser workflow stores a whole-window screenshot plus layout metadata at `capturePath`; `scripts/extract_visual_captures.py` then cuts out the exact fit-view canvas without resampling it again. A packaged-app export may instead be placed directly at `outputPath`.

For each `renderCases` entry in the manifest:

1. Open `sourcePath` in the packaged app or local browser build.
2. Select `presetId` and leave its stock defaults unchanged.
3. Confirm the engine label says `WGSL / GPU` when GPU calibration is intended.
4. Export the frame to `outputPath`, or save a browser screenshot and its layout metadata at `capturePath`.
5. Re-run `make visual-test` and inspect the paired crops and charts.

The six baseline cases cover Portra 400 over sky and daylight, Tri-X over daylight and a flat field, Vision3 500T over a night scene, and Portra over a 16-patch wedge.

## What is a hard failure

- A source checksum or expected dimension changes unexpectedly.
- A rerender with the same frame, seed, stock, and settings changes its grain pattern.
- Moving grain strength causes the stochastic pattern to translate, warp, or reseed.
- Silver-image grain produces colored speckle.
- Smooth blue sky reveals tiling, rosettes, a high-frequency digital-noise shelf, or a uniform-opacity veil.
- The step wedge shows essentially identical grain energy at every exposure.
- Grain scale changes when only the fixture's display zoom changes.

## What requires visual judgment

Power spectra are normalized because the real scans and Grainlab outputs do not share a known film-area-to-pixel scale. The suite compares spectral shape and pathologies, not literal pixel-size equality. Real scan grain also includes developer, scanner aperture, sharpening, compression, and enlargement effects. Treat the real-film images as anchors, not as pixel-perfect targets.

Review every renderer change at both fit view and 100%. For temporal QA, record a stationary crop while moving Grain, Push/Pull, and apparent-size controls slowly. The same clumps should become stronger or crossfade in place; they must not crawl across the photograph.
