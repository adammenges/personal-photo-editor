import AppKit
import Foundation

let path = CommandLine.arguments.dropFirst().first ?? "assets/icons/AppIcon-1024.png"
guard let image = NSImage(contentsOfFile: path),
      let data = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: data) else {
    fputs("error: unable to read app icon source at \(path)\n", stderr)
    exit(1)
}

guard bitmap.pixelsWide == 1024, bitmap.pixelsHigh == 1024 else {
    fputs(
        "error: app icon source must be exactly 1024 × 1024; found \(bitmap.pixelsWide) × \(bitmap.pixelsHigh)\n",
        stderr
    )
    exit(1)
}

guard bitmap.hasAlpha else {
    fputs("error: app icon source must have an alpha channel\n", stderr)
    exit(1)
}

func alpha(atX x: Int, y: Int) -> CGFloat {
    bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 1
}

let transparentProbes = [
    (0, 0), (1023, 0), (0, 1023), (1023, 1023),
    (32, 32), (991, 32), (32, 991), (991, 991),
]
guard transparentProbes.allSatisfy({ alpha(atX: $0.0, y: $0.1) < 0.01 }) else {
    fputs(
        "error: app icon corners are opaque; legacy ICNS rendering will show a square tile\n",
        stderr
    )
    exit(1)
}

guard alpha(atX: 512, y: 512) > 0.99 else {
    fputs("error: app icon center must remain opaque\n", stderr)
    exit(1)
}

print("ok    app icon      1024 × 1024 RGBA with transparent corners")
