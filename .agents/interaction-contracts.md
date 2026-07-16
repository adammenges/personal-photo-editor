# Interaction contracts

These are user-visible invariants. Preserve them across refactors unless the user explicitly changes the product behavior.

## Native macOS window behavior

- Non-interactive space in the top toolbar must drag the native window.
- Toolbar text must not become selected while initiating a window drag.
- Buttons, fields, and other interactive descendants must keep their normal behavior and must not start a window drag.
- `data-tauri-drag-region` alone is not considered sufficient verification. The app grants `core:window:allow-start-dragging` and calls `startDragging()` explicitly from appropriate toolbar pointer handling.
- Verify window movement in the packaged macOS application. A browser-only test does not prove native dragging works.

The top bar should visually blend with the app background rather than reading as a disconnected browser title strip.

## Full-resolution image invariant

- Decode the complete source image once and retain it.
- The editing canvas backing width and height must equal the decoded source dimensions at every zoom level.
- Do not substitute a fit-sized proxy, adaptive preview, Retina-limited preview, fixed thumbnail, or downsampled raster for editing.
- CSS may scale the full-resolution canvas for display. Zoom changes the displayed geometry, not which source pixels exist.
- GPU and CPU processing both receive the full source buffer.
- Thumbnails may be downsampled because they are not the editing source.
- Export may intentionally enforce its documented 4096-pixel long-edge policy, but this must not alter the in-editor source.

When debugging image quality, compare decoded dimensions, canvas backing dimensions, CSS bounds, and the original file before changing sharpening or grain.

## Zoom behavior

- Scrolling or a trackpad gesture over the photograph zooms in and out.
- Zoom is anchored to the actual pointer location over the current on-screen photograph.
- The normalized source coordinate beneath an off-center pointer should remain stable as zoom changes.
- Double-click toggles detail zoom at the click location.
- The Fit control resets zoom and pan to the centered full-image view.
- Zoom should not trigger original comparison.

Verify cursor anchoring against the photo element’s real bounding rectangle, not the surrounding stage or an assumed center.

## Pan behavior

- A zoomed photograph can be dragged directly.
- Holding `Space` allows an explicit pan drag.
- At fit zoom, an ordinary click/drag should not unexpectedly move the image unless Space is held or another deliberate gesture is active.
- Pan limits include inspection overscroll. Every corner of a zoomed image must be draggable into the central viewing area, not merely allowed to touch the viewport edge.
- The cursor should communicate grab/grabbing state.
- Crop manipulation takes precedence over panning while Crop view is active.

## Original comparison

- Clicking the photograph does not show the original.
- The original appears only through the explicit Before button or `B` hold shortcut.
- Releasing `B`, window blur, or leaving the compare gesture restores the developed preview.
- Comparison must copy the source exactly rather than running it through the film pipeline.

## Crop

- Crop must be functional whenever its controls are shown.
- Free, original-ratio, and square modes must update the draggable selection coherently.
- Crop handles and bounds must remain usable at fit and zoomed views.
- Reset returns to the complete frame.
- Export uses the active crop.
- Crop changes participate in per-frame history and survive filmstrip navigation.

## History and undo

- Every frame owns its own edit history.
- History is visible in the panel at the bottom of the left sidebar.
- Entries name the action in photographer-readable terms.
- Clicking an entry restores the state before that action and truncates newer history.
- `Cmd+Z` restores the most recent snapshot.
- Stock, adjustment, grain/process, crop, reset, and relevant view-edit actions should snapshot before mutation.
- Switching frames saves and restores the frame’s stock, adjustments, grain traits, crop, and history.

## Import and filmstrip

- `Cmd+O`, the Open button, the add-frame button, drop, and paste accept individual JPG, PNG, and WEBP files.
- `Shift+Cmd+O` and Add Folder accept a complete directory selection.
- Folder contents are filtered to supported image types and naturally sorted by relative path/name before being added.
- Invalid or empty selections should produce clear feedback without breaking the current frame.
- Each frame retains its original object URL and independent edit state.

## Controls and direct manipulation

- UI text outside actual text fields should not be accidentally selectable during toolbar dragging, image panning, slider manipulation, crop, or filmstrip interaction.
- Slider changes update output text, console status, history, technical readouts where relevant, and rendering.
- Per-group reset affects only that group. Reset Frame restores Clean Scan, defaults, crop, and stock-matched grain traits.
- The process readout updates live when push/pull, halation, flare, or lab traits change.
- Auto Tone must remain absent from the interface and keyboard map.

## Responsive layout and visual integrity

- Preserve visible borders on cards, tabs, and filter controls at every supported width; clipped right edges are bugs.
- Keep the central photograph centered and the filmstrip usable.
- Sidebars may reflow at narrow widths but controls cannot overlap, disappear behind fixed footers, or become unreachable.
- The right controls rail must remain scrollable independently when its content exceeds the viewport.
- Maintain accessible labels and keyboard focus for primary actions.

## Runtime QA checklist

For material UI changes, exercise the packaged app and verify:

1. The top toolbar moves the real window.
2. Open and folder import both work.
3. Filmstrip edits remain independent.
4. Scroll zoom holds an off-center pointer anchor.
5. Direct drag and Space-drag reach all four corners.
6. Before shows the exact source and releases correctly.
7. Crop changes the exported bounds.
8. History entries restore the expected state.
9. The active renderer reads `WGSL / GPU` on supported hardware or clearly reports `CPU / SAFE`.
10. Narrow-window layout retains complete borders and reachable controls.
