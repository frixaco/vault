// swift-tools-version: 6.2
import Foundation
import PackageDescription

let packageRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
let generatedHeaders = "\(packageRoot)/Generated"
let nativeLibrary = "\(packageRoot)/Build"

let package = Package(
    name: "NativeMarkdownDemo",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "NativeMarkdownDemo", targets: ["NativeMarkdownDemo"]),
        .executable(name: "NativeMarkdownProbe", targets: ["NativeMarkdownProbe"])
    ],
    targets: [
        .target(
            name: "NativeMarkdownFFI",
            path: "Sources/NativeMarkdownFFI",
            swiftSettings: [
                .unsafeFlags(["-I", generatedHeaders])
            ],
            linkerSettings: [
                .unsafeFlags(["-L", nativeLibrary, "-lnative_markdown_ffi"])
            ]
        ),
        .executableTarget(
            name: "NativeMarkdownDemo",
            dependencies: ["NativeMarkdownFFI"],
            path: "Sources/NativeMarkdownDemo",
            resources: [
                .process("Resources")
            ],
            swiftSettings: [
                .unsafeFlags(["-I", generatedHeaders])
            ]
        ),
        .executableTarget(
            name: "NativeMarkdownProbe",
            dependencies: ["NativeMarkdownFFI"],
            path: "Sources/NativeMarkdownProbe",
            swiftSettings: [
                .unsafeFlags(["-I", generatedHeaders])
            ]
        )
    ]
)
