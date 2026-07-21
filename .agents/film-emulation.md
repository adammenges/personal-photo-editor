# Film emulation context

## Goal

Grainlab models film as a connected image-formation pipeline. Avoid implementing a stock as unrelated contrast, color, blur, and noise sliders. Parameters should live in the stage where the physical or scanning behavior occurs, and a named process should couple the consequences that occur together.

All GPU photo processing uses WGSL for performance and reliability. `ui/shaders/photo.wgsl` is the primary renderer. `ui/gpu.js` owns device initialization, the uniform layout, buffer upload, dispatch, and readback. `ui/main.js` and `ui/grain.js` retain the JavaScript CPU compatibility path with the same conceptual stage order.

## Stage model

### 1. Scene and capture

Start by decoding sRGB input to scene-linear light. Apply:

- exposure in stops;
- white-balance gains;
- per-channel emulsion sensitivity or monochrome channel weighting;
- optional uniform pre-exposure/flashing.

Do not apply exposure or white balance after the display transform merely because it is convenient.

### 2. Emulsion response

The emulsion stage owns:

- toe behavior in low exposure;
- shoulder compression in high exposure;
- midtone/development gamma;
- shadow and highlight channel crossover;
- chroma-dependent saturation compression;
- image-forming medium and grain-density behavior, sampled from local scene exposure before display encoding.

Granularity is part of image formation. Derive an approximate crystal-activation probability from local scene-linear exposure, use the stock's correlated stochastic field to perturb exposure before the H-D response, and carry a restrained developed-density floor immediately after that response. The toe, shoulder, crossover, chemistry, scan contrast, and output controls must therefore transform the image and its granularity together. Do not restore a post-sRGB grain overlay.

Grainlab uses a normalized H-D-style approximation rather than claiming measured sensitometry. Clean Scan must remain close to identity; stock values should shape the image without stacking extreme contrast on top of the older creative controls.

Halation begins here as exposure scattered back into the emulsion from strong neighboring scene highlights. Threshold scene-linear highlights, use a resolution-scaled radius, and add the halo before the film curve. Color-film halation is red/orange biased; monochrome halation is neutral. It should remain subtle at normal values.

### 3. Lab and chemistry

The lab stage owns coupled process behavior:

- push and pull development;
- chemical fog/base lift;
- local density contrast/acutance approximation;
- retained metallic silver;
- process-driven crossover and grain changes.

A push is not a contrast preset. It combines underexposure with increased development: missing shadow exposure stays missing while gamma, fog, grain prominence, radius variance, shadow bias, and sometimes crossover increase. A pull combines extra exposure with softer development and finer-looking grain.

Bleach bypass is retained silver over the dye image. Model a neutral silver component, stronger density contrast, reduced chroma, and silver-like texture. Do not implement it as ordinary desaturation.

Cross processing should introduce density-dependent crossover and altered development, not only a global hue rotation.

Motion-picture behavior should favor smooth multi-layer dye structure, controlled chroma noise, broad highlight handling, and stable texture. Remjet-backed camera stocks generally warrant less aggressive halation than a remjet-removed aesthetic.

### 4. Scan and output

The output stage owns:

- scanner/optical flare as veiling light;
- output tint or paper/base color;
- scan contrast;
- the user’s final creative tone/color adjustments;
- fade and vignette;
- encoding back to display sRGB.

Spatial grain correlation represents emulsion thickness and scanner/enlarger aperture. Scale its effective radius from a fixed reference edge so changing scan resolution changes how many pixels resolve a clump, not the simulated clump's physical size.

Keep output tint separate from scene sensitivity. Scanner behavior should not pretend to change which crystals received photons.

## Physical grain requirements

The former repeated circular/rosette grain artifact was unacceptable. Preserve these invariants:

- Never use a short-period modulo hash, tiled lookup texture, repeating bitmap, or fixed pattern.
- Grain covers the entire developed image, including flat highlights and shadows, with physically plausible density modulation.
- Use non-periodic stochastic fields with spatial correlation across multiple radii.
- Seed grain deterministically per frame so rerenders do not shimmer or randomly replace the image structure.
- Keep every stochastic population spatially anchored while controls change. Strength scales density/contrast, and radius or development crossfades fixed fine/medium/coarse fields; never warp noise coordinates or change the strength-dependent field mixture in a way that makes grain swim over a stationary image.
- Keep grain signal-dependent. A Boolean exposure/development model produces the strongest variance around intermediate density, with a floor across the frame.
- Condition color-layer uncertainty on each channel's local scene exposure; a blue sky and a red surface must not receive identical RGB statistics.
- Grain must enter before display encoding. A small developed-density floor may follow the curve, but it remains upstream of chemistry, scan/output tone, and sRGB.
- Underexposed/pushed shadows may show additional prominence, but “shadow bias” must not become digital chroma noise.
- Calibrate at both fit view and 100%. At fit view grain should read as texture, not snowfall; at 100% clumps may be inspected without forming wallpaper geometry.

### Silver image

Traditional black-and-white processing leaves developed metallic silver. It should read as crisp, neutral, and comparatively well-defined. Cubic-grain materials may be irregular and clumpy; engineered flat-grain materials should be finer and more uniform.

### Color dye image

Normally processed color film removes silver and leaves cyan, magenta, and yellow dye clouds. The visible texture is softer and rounder than metallic silver. Most energy should be a shared luminance/density variation with only weak independent chroma-layer variation. Strong RGB speckle is digital noise, not convincing dye grain.

### Crystal and emulsion traits

- **Cubic:** thicker, irregular, characterful clumps; appropriate to classic silver stocks.
- **Tabular/T-Grain:** thin, efficient plates; finer appearance at a given speed and cleaner edge detail.
- **Delta:** an engineered flat-grain family with smooth, uniform behavior distinct from simply renaming T-Grain.
- **Mixed size:** small, medium, and large crystal populations with density-dependent roles and more natural tonal transitions.
- **Core-shell:** layered crystal chemistry that improves speed/cleanliness without requiring a simple size increase.

These categories overlap. Speed, crystal geometry, image medium, emulsion architecture, development, format, scanner optics, and enlargement all contribute to visible grain. Do not present one enum as a complete physical description of a stock.

### Size and process

Fine, medium, and coarse grain are presentation-scale traits, not separate chemical species. Faster stocks tend toward larger apparent clumps, but exposure and development matter. Push processing increases prominence and contrast; pull processing reduces them; motion-picture stocks favor smoother multi-layer structure.

The current calibrated grain energy was deliberately reduced after live testing showed the first physically parameterized profiles reading like coarse digital noise at fit view. Preserve restraint when adding radius variance or shadow bias.

## Data-driven film stocks

Every stock lives in its own JSON file beneath `ui/film-stocks/`. `src-tauri/build.rs` discovers files recursively, validates the schema, and regenerates `ui/film-stocks/index.json`. The generated index must not become the only edited source.

A stock contains three layers:

1. `settings` — default creative control positions.
2. `grainProfile` and versioned `pipeline` — rendering behavior.
3. `dossier` — reference lineage, technical explanation, artistic guidance, caveats, and sources.

Do not add a stock by editing `PRESETS` or branching on its id in `main.js`. Extend the common pipeline interface if a genuinely new physical capability is needed.

See `ui/film-stocks/README.md` for the canonical schema, allowed families, ranges, and annotated example.

### Learned personal styles

The local learner at `scripts/learn_film_style.sh` converts one positive scan or a same-roll folder into the common stock interface. It is a scan-look estimator, not a second renderer and not a license for stock-specific code paths. A generated definition must pass the same build validation and the GPU and CPU pipelines must treat it like every other stock.

Keep the inference boundary explicit. Unpaired finished photographs entangle subject reflectance, exposure, film, development, lab correction, scanner optics/profile, denoise, sharpening, compression, and output encoding. Automatic learning may conservatively map tone spacing, low-chroma output balance, density-dependent crossover, and apparent smooth-region texture. It must not claim measured sensitometry, spectral sensitivity, halation, vignette, retained silver, scanner flare, or a film/process identity from those pixels alone. Known provenance may be supplied as metadata; it must not be presented as image inference.

Every learned run writes raw measurements, confidence labels, source previews, the candidate stock, and an HTML report beneath `artifacts/learned-styles/`. Default operation is review-only. Installation and replacement require explicit flags, and installed definitions belong under `ui/film-stocks/learned/`. See `docs/learned-film-styles.md` for capture guidance and workflow.

## Dossier standard

Stock dossiers should feel complete to a film enthusiast and useful in the field. Include:

- nominal speed or exposure index with correct terminology;
- camera stock, print material, utility, or lab-process identity;
- image-forming material and crystal/emulsion description;
- tone curve, latitude, under/overexposure, and development behavior;
- color signature or monochrome spectral behavior;
- lab and scan advice;
- subjects/lighting where it excels;
- failure modes and category mistakes;
- original artistic notes;
- primary manufacturer or authoritative technical sources;
- explicit disclaimer that the profile is interpretive and independent.

Do not copy marketing language. Separate documented facts from inference, and never imply that a core-shell or mixed-crystal claim is printed on a box when it is an inferred/internal technology.

## Calibration and evaluation

Use more than the demo photograph when materially changing the renderer. A useful evaluation set includes:

- grayscale step wedge for toe, gamma, shoulder, fog, and clipping;
- ColorChecker-like patches for channel crossover and hue stability;
- varied skin tones for red/magenta behavior;
- foliage and sky for green/blue separation;
- night scenes with point highlights for halation and pushed shadows;
- specular highlights for shoulder and halo thresholds;
- flat walls, skies, and defocused regions for grain structure;
- 100% crops plus fit-view screenshots.

Look for histogram pathologies, clipped channels, halos that ignore highlight thresholds, colored speckle, repeated geometry, resolution-dependent grain scale, and stocks that differ only by one global cast.

The checked-in protocol at `tests/visual/README.md` defines the licensed calibration set, render matrix, and interpretation limits. `make visual-test` verifies real Portra and Tri-X sources, creates iPhone and synthetic fixtures, runs the deterministic fixed-field regression, measures smooth-region and tone-binned granularity, compares normalized grain power spectra, and writes a local HTML report beneath `artifacts/visual-tests/`.

Keep hard gates separate from calibration evidence. Checksums, deterministic rerenders, neutral silver structure, and anchored controls may fail the build or review. Absolute grain size must not be matched directly between an unknown real scan chain and a generated output; scanner aperture, enlargement, developer, sharpening, and film-area scale make that comparison underdetermined. Use normalized spectrum shape and visible pathologies as calibration guidance instead.

For deeper future validation, add color-difference comparisons, measured film-area scaling, more developers/scanners, and spatial-autocorrelation confidence bands.

## Performance and reliability

- Keep the primary pipeline in WGSL and compile it before creating the WebGPU compute pipeline.
- Preserve the `WGSL / GPU` and `CPU / SAFE` runtime labels; fallback should be explicit.
- Uniform layouts in `gpu.js` and `photo.wgsl` must be changed together with correct WGSL alignment.
- Avoid extra full-resolution allocations and passes without measuring the need.
- Uniform branches for disabled halation/local-density work are preferable to always paying for neighboring samples.
- Preserve the exact source-copy path for Before comparison.
- Full-resolution correctness is more important than hiding latency behind a low-resolution preview.
