# Vault Mac Experiment Progress

## Goal

Use the Rust/Comrak/UniFFI native Markdown bridge from `experimental/native-markdown` inside the Xcode macOS app at `experimental/vault-mac`.

## Current State

- App is a basic in-memory Markdown editor.
- Left pane: editable Markdown source with `TextEditor`.
- Right pane: native SwiftUI preview rendered from Rust/Comrak block records.
- No file persistence, no database, no WebView.
- Bold/emphasis/code/strikethrough spans are rendered from Rust-provided inline records.
- Tables render as native SwiftUI `Grid` rows/cells from Rust-provided table records.
- Blockquotes use an overlay accent rule so wrapped text stays aligned at narrow widths.
- Links, images, soft/hard breaks, inline HTML, and table alignment are consumed from the regenerated FFI model.
- Comrak extensions are now consumed from the regenerated FFI model where the current proof UI has an obvious native representation: alerts, description lists, footnotes, subtext, block directives, wikilinks, math, escaped spans, and additional inline style flags.
- The bundled sample Markdown includes extension syntax so the app exercises the broader bridge on launch.

## Bridge Setup

- `scripts/sync-native-markdown.sh` builds `../native-markdown/native-markdown-ffi`.
- The script regenerates UniFFI Swift bindings and headers.
- Generated Swift is copied to `vault-mac/GeneratedNativeMarkdown.swift`.
- Headers/modulemap are written to `NativeMarkdownGenerated/include`.
- Static Rust library is written to `NativeMarkdownGenerated/lib/libnative_markdown_ffi.a`.
- The Xcode target has a pre-build phase named `Sync Native Markdown Bridge`.
- Target build settings include:
  - `SWIFT_INCLUDE_PATHS = $(PROJECT_DIR)/NativeMarkdownGenerated/include`
  - `LIBRARY_SEARCH_PATHS = $(PROJECT_DIR)/NativeMarkdownGenerated/lib`
  - `OTHER_LDFLAGS = -lnative_markdown_ffi`

## Verified

```sh
cargo test -p native-markdown-ffi
xcodebuild -project vault-mac.xcodeproj -scheme vault-mac -configuration Debug -destination 'platform=macOS' build
```

The built app was smoke-launched and stopped successfully.

## Notes

- `NativeMarkdownGenerated/lib/` is ignored because the static library is rebuilt by the script.
- Root `README.md` was already dirty before this work and was not touched.
