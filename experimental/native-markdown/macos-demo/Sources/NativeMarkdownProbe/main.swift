import NativeMarkdownFFI

let source = """
---
title: Probe
---

# Rust parsed this

Swift received native block records from Comrak.

- [ ] Render SwiftUI
- [x] Cross the UniFFI bridge
"""

let document = try parseMarkdown(
    source: source,
    options: MarkdownParseOptions(githubFlavored: true, frontMatter: true)
)

print("blocks=\(document.blocks.count)")
for block in document.blocks {
    print("\(block.kind) line=\(block.sourceStartLine) text=\(block.text)")
}
