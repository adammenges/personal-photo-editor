# Film stock definitions

Every `.json` file below this directory is one film stock. Category folders keep the library legible; the folder name does not control behavior—the `type` field does.

The researched Century 100 profiles also include a `catalog` block with the stable `century-100-v1` edition, unique rank, introduction era, origin, and selection rationale. The build requires that edition to contain all 100 ranks. Unranked house, utility, and experimental profiles omit `catalog` and remain fully supported. See [`docs/film-stock-century-canon.md`](../../docs/film-stock-century-canon.md) for methodology and the complete selection.

`src-tauri/build.rs` discovers the files recursively, validates required fields, and regenerates `index.json`. Adding a valid definition and running `make dev`, `make check`, or `make build-app` makes it appear in the Film Library automatically.

```json
{
  "id": "example-400",
  "name": "Example 400",
  "maker": "Archive",
  "type": "color",
  "group": "DAYLIGHT / COLOR",
  "sort": 35,
  "settings": {
    "exposure": 0.1,
    "contrast": -4,
    "saturation": -6,
    "temperature": 7,
    "fade": 4,
    "grain": 11
  },
  "grainProfile": {
    "medium": "dye",
    "crystal": "tabular",
    "emulsion": "core-shell",
    "scale": "medium",
    "process": "standard"
  },
  "pipeline": {
    "version": 1,
    "family": "c41",
    "monochrome": false,
    "scene": {
      "sensitivity": [1.02, 1.0, 0.97],
      "flash": 0.002
    },
    "curve": {
      "toe": 0.06,
      "shoulder": 0.35,
      "gamma": 0.98,
      "saturationCompression": 0.18
    },
    "crossover": {
      "shadows": [0.01, -0.004, -0.006],
      "highlights": [0.008, 0.002, -0.01]
    },
    "chemistry": {
      "silverRetention": 0.0,
      "fog": 0.003,
      "flare": 0.005,
      "localContrast": 0.02
    },
    "optics": {
      "halation": 0.035,
      "halationRadius": 5.0,
      "halationThreshold": 0.9
    },
    "output": {
      "tint": [1.015, 1.0, 0.985],
      "scanContrast": 0.96
    },
    "grain": {
      "meanRadius": 0.95,
      "radiusVariance": 0.28,
      "shadowBias": 0.5,
      "chroma": 0.045
    }
  },
  "dossier": {
    "version": 1,
    "reference": {
      "stock": "Physical reference stock or process",
      "manufacturer": "Manufacturer / laboratory",
      "relationship": "Interpretive emulation; not a measured profile",
      "status": "Current, discontinued, process variant, or digital utility"
    },
    "tagline": "One artistic sentence.",
    "portrait": "A longer curatorial description of how the material feels.",
    "facts": [
      { "label": "NOMINAL SPEED", "value": "ISO 400 / 27°", "note": "Daylight rating" }
    ],
    "palette": [
      { "name": "memory red", "hex": "#b94d3d" }
    ],
    "chapters": [
      {
        "eyebrow": "EMULSION ANATOMY",
        "title": "How the image is physically made",
        "lede": "A readable technical introduction.",
        "details": [
          { "label": "Image-forming material", "value": "Metallic silver or CMY dye clouds." }
        ],
        "notes": ["Important caveats and physical nuance live here."]
      }
    ],
    "bestFor": ["Subjects and lighting where the interpretation is useful."],
    "watchFor": ["Failure modes, exposure traps, and category mistakes."],
    "fieldNotes": ["Original contact-sheet marginalia or an artistic shooting prompt."],
    "sources": [
      {
        "title": "Manufacturer technical publication",
        "publisher": "Primary source publisher",
        "url": "https://example.com/official-technical-data"
      }
    ],
    "verified": "YYYY-MM-DD",
    "disclaimer": "State clearly what the emulation does and does not reproduce."
  }
}
```

Allowed `type` values are `color`, `mono`, and `utility`. Pipeline families are `utility`, `bw`, `c41`, `e6`, `ecn2`, and `print`. Grain traits use the same values exposed by the Emulsion Model controls; process values are `standard`, `push`, `pull`, `motion`, `bleach`, and `cross`.

The render model follows physical stage boundaries:

1. `scene` operates in linear light and describes channel sensitivity plus uniform pre-exposure or flashing.
2. `curve` and `crossover` describe emulsion response: toe, shoulder, development gamma, color-record crossover, and saturation compression.
3. `chemistry` describes lab effects: retained silver, chemical fog, scanner flare, and density-edge acutance. `silverRetention` is the bleach-bypass mechanism; it is not implemented as ordinary desaturation.
4. `optics` derives halation from thresholded neighboring scene highlights before the curve. Radius is specified in pixels at a 2048-pixel long edge and scales with image resolution.
5. `grain` controls the emulsion's mean clump radius, radius distribution, extra shadow uncertainty, and dye-layer chroma variance. Its stochastic exposure modulation enters before the film curve; its small developed-density floor remains upstream of chemistry and output. `output` then models the chosen positive/scan path.

Keep stage ownership honest. Exposure and white balance belong before the emulsion; push/pull changes exposure, curve shape, fog, crossover, and grain together; output tint should not be baked into channel sensitivity. The build script rejects missing blocks, non-finite values, invalid vectors, unsupported families, and values outside intentionally conservative physical/artistic ranges.

The dossier is part of the stock interface, not optional decoration. `src-tauri/build.rs` rejects missing core sections, malformed palette colors, empty chapter details, non-HTTPS references, and incomplete source metadata. The reader renders any number of facts, swatches, chapters, details, notes, field uses, cautions, marginalia, and sources without application-specific code.

Use primary manufacturer literature for technical claims. Keep measurements tied to their stated conditions, distinguish ISO from a chosen exposure index, name whether an entry is a camera stock or a laboratory process, and say when a grain mapping is an inference. The artistic writing should be original and useful in the field—not copied product language.
