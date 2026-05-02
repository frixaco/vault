# Native Markdown Experiment Progress

## Goal

Prove that Vault can parse Markdown in Rust with Comrak, expose the parsed document to Swift through UniFFI, and render it as native SwiftUI views on Apple platforms.

## Current Decision

- First proof target: macOS SwiftUI app built with SwiftPM.
- Rust stays inside `experimental/native-markdown`.
- Rust returns a typed, owned document model instead of HTML.
- SwiftUI owns actual rendering.
- Wikilinks are intentionally out of scope for this experiment.

## Dependency Check

- `comrak = 0.52.0`: current crates.io search result; CommonMark/GFM parser and formatter, Rust 1.85 minimum.
- `uniffi = 0.31.1`: current crates.io search result; same family as `../litter`'s UniFFI bridge.

## Checklist

- [x] Create experiment workspace and progress tracker.
- [x] Implement Rust Comrak parser surface.
- [x] Add Rust tests proving parsed block output.
- [x] Generate Swift UniFFI bindings.
- [x] Build macOS static library and SwiftPM demo.
- [x] Render sample Markdown in native SwiftUI.
- [x] Add one-command verification script.

## Verified Commands

```sh
cargo test -p native-markdown-ffi
swift build
swift run NativeMarkdownProbe
./macos-demo/.build/debug/NativeMarkdownDemo
```

The SwiftUI app executable was smoke-launched and stopped successfully.

## Follow-Up Fixes

- Removed the public `wikilinks` parse option and Comrak wikilink handling.
- Fixed nested list item text extraction so a parent item does not absorb child list text.
- Added inline span records for bold, emphasis, code, and strikethrough so SwiftUI can render styled native text instead of collapsed plain strings.
- Added structured table rows/cells to the FFI model so SwiftUI can render native tables instead of monospaced pipe text.
- Added `MARKDOWN_FEATURES.md` as the CommonMark + GFM renderer contract.
- Extended inline FFI records with semantic inline kind, URL, title, image alt text, soft/hard breaks, inline HTML, and table cell alignment.
- Expanded the contract from CommonMark/GFM to Comrak-supported syntax compiled into the current crate.
- Added typed exposure for description lists, footnotes, alerts, subtext, block directives, wikilinks, math, escaped spans, and Comrak inline styles such as highlight/insert/superscript/underline/subscript/spoiler.
- Added `inline_footnotes` as an explicit parse option because it conflicts with superscript caret syntax when enabled globally.

`NativeMarkdownProbe` printed:

```text
blocks=5
frontMatter line=1 text=---
title: Probe
---
heading line=5 text=Rust parsed this
paragraph line=7 text=Swift received native block records from Comrak.
taskItem line=9 text=Render SwiftUI
taskItem line=10 text=Cross the UniFFI bridge
```

## Notes For Future Sessions

- Do not touch `README.md`; it was already modified before this experiment.
- Keep generated/build artifacts inside `experimental/native-markdown`.
- If continuing after compaction, start by reading this file and running `git status --short`.
