# SF Symbols Assets

Use this folder for SF Symbol exports used inside the app UI.

Recommended workflow:

1. Open Apple's SF Symbols app.
2. Export symbols as SVG.
3. Save them in this directory with stable names.
4. Reference them from Rust UI code (for example with `iced` SVG/image widgets).

Keep icon style consistent:

- use similar optical weight per screen
- avoid mixing unrelated icon families
- prefer monochrome or restrained palette
