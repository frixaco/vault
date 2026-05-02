---
title: Native Markdown Proof
tags:
  - rust
  - swiftui
---

# Native Markdown Proof

This document was parsed by **Rust** using Comrak, crossed into Swift with UniFFI, and is being rendered by native SwiftUI views.

> The important part is that this is not HTML in a web view. The parser and renderer are separate, typed layers.

## What Works In This Spike

- [x] Comrak parses Markdown into an AST
- [x] Rust converts the AST into owned records
- [x] UniFFI generates Swift bindings
- [ ] Rich inline spans are still flattened for now

```swift
Text("SwiftUI owns the pixels")
    .font(.system(.body, design: .rounded))
```

| Markdown block | SwiftUI surface |
| --- | --- |
| Heading | Text with native font |
| Task item | SF Symbol plus Text |
| Code block | Monospaced native Text |

---

Plain Markdown stays the contract here; wikilinks are intentionally out of scope.
