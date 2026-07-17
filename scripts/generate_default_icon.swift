import AppKit

let outputPath = CommandLine.arguments.dropFirst().first ?? "assets/icons/AppIcon-1024.png"
let outputURL = URL(fileURLWithPath: outputPath)
let fileManager = FileManager.default

try fileManager.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)

let canvasSize = NSSize(width: 1024, height: 1024)
let canvasRect = NSRect(origin: .zero, size: canvasSize)

guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: 1024,
    pixelsHigh: 1024,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
), let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("Failed to allocate icon image.\n", stderr)
    exit(1)
}

bitmap.size = canvasSize
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphics

NSGraphicsContext.saveGraphicsState()
let silhouetteRect = canvasRect.insetBy(dx: 64, dy: 64)
let silhouette = NSBezierPath(roundedRect: silhouetteRect, xRadius: 160, yRadius: 160)
silhouette.addClip()

if let gradient = NSGradient(
    colors: [
        NSColor(calibratedRed: 0.09, green: 0.28, blue: 0.72, alpha: 1.0),
        NSColor(calibratedRed: 0.16, green: 0.12, blue: 0.33, alpha: 1.0)
    ]
) {
    gradient.draw(in: canvasRect, angle: -45.0)
} else {
    NSColor(calibratedRed: 0.09, green: 0.28, blue: 0.72, alpha: 1.0).setFill()
    canvasRect.fill()
}

let cardRect = canvasRect.insetBy(dx: 90, dy: 90)
let cardPath = NSBezierPath(roundedRect: cardRect, xRadius: 210, yRadius: 210)
NSColor(calibratedWhite: 1.0, alpha: 0.08).setFill()
cardPath.fill()

if let baseSymbol = NSImage(systemSymbolName: "sparkles", accessibilityDescription: nil),
   let configured = baseSymbol.withSymbolConfiguration(.init(pointSize: 440, weight: .medium)) {
    let tinted = NSImage(size: configured.size)
    tinted.lockFocus()
    configured.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1)
    NSColor.white.setFill()
    NSRect(origin: .zero, size: configured.size).fill(using: .sourceAtop)
    tinted.unlockFocus()
    let symbolRect = NSRect(x: 292, y: 292, width: 440, height: 440)
    tinted.draw(in: symbolRect)
} else {
    let fallback = NSString(string: "APP")
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center

    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.boldSystemFont(ofSize: 220),
        .foregroundColor: NSColor.white,
        .paragraphStyle: paragraph
    ]

    fallback.draw(in: NSRect(x: 210, y: 360, width: 604, height: 260), withAttributes: attributes)
}

NSGraphicsContext.restoreGraphicsState()
graphics.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
    fputs("Failed to render icon image.\n", stderr)
    exit(1)
}

do {
    try pngData.write(to: outputURL)
    print("Generated default icon at \(outputPath)")
} catch {
    fputs("Failed to write icon: \(error)\n", stderr)
    exit(1)
}
