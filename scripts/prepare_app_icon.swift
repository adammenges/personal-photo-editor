import AppKit
import Foundation

let arguments = CommandLine.arguments.dropFirst()
guard arguments.count == 2 else {
    fputs("usage: swift scripts/prepare_app_icon.swift <input.png> <output.png>\n", stderr)
    exit(2)
}

let inputPath = String(arguments[arguments.startIndex])
let outputPath = String(arguments[arguments.index(after: arguments.startIndex)])

guard let source = NSImage(contentsOfFile: inputPath) else {
    fputs("error: unable to read \(inputPath)\n", stderr)
    exit(1)
}

let pixelSize = 1024
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixelSize,
    pixelsHigh: pixelSize,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fputs("error: unable to allocate icon bitmap\n", stderr)
    exit(1)
}

bitmap.size = NSSize(width: pixelSize, height: pixelSize)
guard let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("error: unable to create icon graphics context\n", stderr)
    exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics
graphics.imageInterpolation = .high
graphics.cgContext.setShouldAntialias(true)
graphics.cgContext.setAllowsAntialiasing(true)

// Legacy ICNS consumers don't consistently apply the modern system mask.
// Keep the artwork inside the same 87.5% optical footprint as Apple's bundled
// macOS icons and make the outer canvas genuinely transparent.
let iconBounds = NSRect(x: 64, y: 64, width: 896, height: 896)
let silhouette = NSBezierPath(roundedRect: iconBounds, xRadius: 160, yRadius: 160)
silhouette.addClip()
source.draw(
    in: NSRect(x: 0, y: 0, width: pixelSize, height: pixelSize),
    from: .zero,
    operation: .copy,
    fraction: 1,
    respectFlipped: true,
    hints: [.interpolation: NSImageInterpolation.high]
)

graphics.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fputs("error: unable to encode icon PNG\n", stderr)
    exit(1)
}

do {
    try FileManager.default.createDirectory(
        at: URL(fileURLWithPath: outputPath).deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try png.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
} catch {
    fputs("error: unable to write \(outputPath): \(error)\n", stderr)
    exit(1)
}

print("prepared 1024 × 1024 transparent icon: \(outputPath)")
