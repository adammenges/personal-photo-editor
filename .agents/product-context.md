# Product context

## Product identity

The application is **Grainlab**, a local-first film-development console for macOS. It began from a generic Rust/Tauri template and took visual inspiration from an external photo editor, but it is not intended to be a clone. The source was inspiration for the overall category and workflow; Grainlab’s code, styling, interaction model, and information architecture should feel native to this repository.

The product is a foundation the owner can build on and iterate. Favor coherent primitives, discoverable data interfaces, and clear extension points over one-off effects that are difficult to evolve.

## Core promise

Grainlab should make film emulation feel like development, not filter shopping:

- a photograph remains full resolution throughout editing;
- film stocks describe physical and artistic behavior, not only a color LUT;
- edits are explicit, reversible, and visible in history;
- the interface is fast with keyboard, mouse, and trackpad;
- processing stays on the user’s Mac;
- the app is useful immediately but legible enough to extend.

## Experience direction

The visual direction is a dark, terminal-inspired macOS utility: compact, slightly hacky, and technically literate without becoming hostile. Monospaced type, terse labels, console-like feedback, and ASCII motifs are welcome when they remain accessible. The product should still inherit good Apple-platform behavior: predictable gestures, native window movement, clear focus, consistent spacing, and no accidental text selection during direct manipulation.

The three-pane hierarchy is intentional:

1. Film library and edit history on the left.
2. Photograph, view controls, crop workspace, and filmstrip in the center.
3. Histogram, development controls, emulsion model, and process controls on the right.

At smaller supported widths the layout should adapt cleanly rather than merely shrink until controls become unusable. Preserve a centered photograph and clear primary actions.

## Primary workflow

1. Open individual photographs, paste/drop them, or open an entire folder.
2. Move between frames in the filmstrip; every frame preserves independent edits.
3. Browse or search the film library, choose a stock, and optionally read its dossier.
4. Make explicit tone, color, texture, and process adjustments.
5. Inspect native detail with cursor-centered zoom and pan.
6. Crop when needed.
7. Revisit edits from the visible history or undo.
8. Export the active developed frame.

The bundled demo photograph exists so a fresh build is immediately understandable without opening a file.

## Film library philosophy

Film stocks should be both technically rich and artistically useful. A stock is not complete when it only has numeric rendering settings. It also needs a dossier that tells a photographer:

- what physical material or process inspired it;
- how the image is formed;
- how exposure and development change its behavior;
- what colors, tones, and subjects it favors;
- what can go wrong;
- where technical claims came from;
- which parts are interpretive rather than measured.

Write for serious film enthusiasts without losing clarity. The prose may be curatorial and evocative, but technical claims should stay bounded by source literature and explicit caveats. Do not imply manufacturer endorsement or exact reproduction.

## Deliberate product decisions

- **No Auto Tone.** It was intentionally removed. Grainlab should not silently solve the photograph through an opaque button.
- **Before is explicit.** Clicking the photo must not reveal the original. Use the Before control or `B` shortcut.
- **History is part of the interface.** It belongs at the bottom of the left sidebar and must remain actionable, not merely logged internally.
- **Folder import is first class.** The filmstrip is meant for a body of images, not only a single-file demo.
- **Stock definitions are plug-in-like data.** Adding a valid file under `ui/film-stocks/` should add a menu option after the manifest is regenerated.
- **The right rail exposes physical structure.** Grain and process controls should remain understandable as emulsion/lab choices, not collapse into a generic “amount” preset.

## Current scope and honest limitations

Grainlab currently supports JPG, PNG, and WEBP input plus JPEG export. RAW decoding, high-bit-depth intermediates, measured scanner profiles, ICC-managed printing, masks, curves, and batch export are future work, not implied current capabilities.

The emulator is physically informed but not a spectral reconstruction or a promise of exact manufacturer color. Visible-RGB input cannot recreate information outside the captured spectrum; the infrared stock must retain this caveat.

## Product-quality bar

A feature displayed in the interface must work. Placeholder controls, selectable labels where dragging is expected, cropped borders, low-resolution zoom artifacts, inaccessible image corners, and decorative history are product bugs, not polish items.

When reviewing a change, assess both the default demo and realistic edge cases: high-resolution imports, multiple frames, extreme aspect ratios, zoomed corners, narrow windows, long stock metadata, strong highlights, flat walls where grain is visible, and exports after crop.
