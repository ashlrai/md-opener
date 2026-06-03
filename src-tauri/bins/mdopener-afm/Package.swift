// swift-tools-version: 6.0
// Requires Xcode 26 / Swift 6.2+ (macOS 26 SDK) to build.
// Runtime: degrades gracefully on macOS < 26 (prints {"available":false,...} and exits).

import PackageDescription

let package = Package(
    name: "mdopener-afm",
    platforms: [
        // Deployment target is 15 so the binary runs and gracefully reports
        // unavailable on older systems. The macOS 26 SDK is required at
        // *build* time (Xcode 26), but the resulting binary works everywhere.
        .macOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "mdopener-afm",
            path: "Sources/mdopener-afm",
            // FoundationModels is a system framework on macOS 26 SDK.
            // SwiftPM resolves it automatically via the SDK — no explicit
            // linkerSettings needed when building with Xcode 26 toolchain.
            swiftSettings: [
                // Enable strict concurrency for Swift 6 compatibility.
                .swiftLanguageMode(.v6)
            ]
        )
    ]
)
