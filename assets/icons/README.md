# App Icon

Place your app icon source here:

- `AppIcon-1024.png` (required for production, 1024x1024 PNG)

Then run:

```bash
./scripts/build_macos_app.sh
```

That command will:

1. Generate `AppIcon.icns`
2. Copy it into `dist/<AppName>.app/Contents/Resources/AppIcon.icns`

If `AppIcon-1024.png` is missing, the build script auto-generates a fallback icon:

1. First tries `scripts/generate_default_icon.swift`.
2. If Swift generation is unavailable, falls back to the macOS generic application icon.
