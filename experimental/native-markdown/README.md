# Native Markdown Experiment

This is a self-contained proof that Markdown can be parsed by Rust/Comrak and rendered by native SwiftUI through UniFFI.

The intended proof path:

1. Build `native-markdown-ffi`, a Rust crate that exposes `parse_markdown`.
2. Generate Swift bindings with UniFFI.
3. Build a static macOS library from the Rust crate.
4. Link that library into a SwiftPM macOS SwiftUI demo.
5. Render `Resources/sample.md` as native SwiftUI views.

Run:

```sh
./scripts/build-demo.sh
```

Then launch the native SwiftUI proof app:

```sh
./macos-demo/.build/debug/NativeMarkdownDemo
```

The terminal proof is:

```sh
cd macos-demo
swift run NativeMarkdownProbe
```
