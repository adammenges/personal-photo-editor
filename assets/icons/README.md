# App icon source

`AppIcon-1024.png` is the single source of truth for the application icon. It must be exactly 1024 × 1024 RGBA with genuinely transparent outer corners. Legacy ICNS consumers do not consistently apply the modern macOS rounded mask, so an opaque edge-to-edge backdrop renders as a square tile in the Dock.

To normalize an existing square artwork file without redrawing its content:

```bash
swift scripts/prepare_app_icon.swift input.png assets/icons/AppIcon-1024.png
swift scripts/validate_app_icon.swift assets/icons/AppIcon-1024.png
```

The preparation step keeps the artwork within an 87.5% optical footprint and clears the surrounding canvas. Always inspect the generated icon at 128 px as well as full size.

Regenerate Tauri's macOS, Windows, iOS, and Android icon set with:

```bash
make icons
```

`scripts/build_macos_app.sh` also regenerates icons when the source is newer than `src-tauri/icons/icon.icns`. If the source is missing on macOS, the build attempts to recreate the included default with `generate_default_icon.swift`.

Commit the generated files in `src-tauri/icons/` so a fresh checkout has a complete icon set.
