// swift-tools-version: 5.9
import PackageDescription

// What the app and its extensions share: the App Group store, the queue of
// writes made outside the app, and the reminder plan. Foundation only, so
// `swift test` runs it on a Mac with no simulator (CI does).
let package = Package(
    name: "GlanceKit",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "GlanceKit", targets: ["GlanceKit"])
    ],
    targets: [
        .target(name: "GlanceKit"),
        .testTarget(name: "GlanceKitTests", dependencies: ["GlanceKit"])
    ]
)
