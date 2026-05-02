import SwiftUI

struct ContentView: View {
    @State private var markdown = sampleMarkdown

    var body: some View {
        HSplitView {
            MarkdownEditor(source: $markdown)
                .frame(minWidth: 360)

            MarkdownPreview(source: markdown)
                .frame(minWidth: 420)
        }
        .frame(minWidth: 900, minHeight: 620)
        .background(Color(nsColor: .textBackgroundColor))
    }
}

private struct MarkdownEditor: View {
    @Binding var source: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            EditorHeader()
            TextEditor(text: $source)
                .font(.system(size: 15, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(16)
                .background(Color(nsColor: .textBackgroundColor))
        }
    }
}

private struct MarkdownPreview: View {
    let source: String

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                switch parseResult {
                case .success(let document):
                    ForEach(Array(document.blocks.enumerated()), id: \.offset) { _, block in
                        MarkdownBlockView(block: block)
                    }
                case .failure(let error):
                    Text(error.localizedDescription)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.red)
                        .padding(18)
                }
            }
            .frame(maxWidth: 780, alignment: .leading)
            .padding(28)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var parseResult: Result<MarkdownDocument, Error> {
        Result {
            try parseMarkdown(
                source: source,
                options: MarkdownParseOptions(
                    githubFlavored: true,
                    frontMatter: true,
                    comrakExtensions: true,
                    inlineFootnotes: false
                )
            )
        }
    }
}

private struct EditorHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "square.and.pencil")
                .imageScale(.medium)
                .foregroundStyle(.secondary)
            Text("Markdown")
                .font(.system(size: 13, weight: .semibold))
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block.kind {
        case .frontMatter:
            EmptyView()
        case .heading:
            inlineText(block.inlines, font: headingFont)
                .fontWeight(.semibold)
                .padding(.top, block.level == 1 ? 4 : 18)
                .padding(.bottom, block.level == 1 ? 14 : 10)
        case .paragraph:
            inlineText(block.inlines, font: .system(size: 16))
                .lineSpacing(4)
                .padding(.bottom, 12)
        case .quote:
            inlineText(block.inlines, font: .system(size: 16))
                .foregroundStyle(.secondary)
                .lineSpacing(4)
                .padding(.leading, 14)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(Color.accentColor.opacity(0.45))
                        .frame(width: 3)
                }
                .padding(.leading, CGFloat(block.quoteDepth.saturatingSubtractingOne) * 18)
                .padding(.bottom, 12)
        case .descriptionList:
            EmptyView()
        case .descriptionTerm:
            inlineText(block.inlines, font: .system(size: 16, weight: .semibold))
                .padding(.top, 6)
                .padding(.bottom, 4)
        case .descriptionDetails:
            inlineText(block.inlines, font: .system(size: 15))
                .foregroundStyle(.secondary)
                .padding(.leading, 18)
                .padding(.bottom, 8)
        case .footnoteDefinition:
            inlineText(block.inlines, font: .system(size: 13, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.top, 8)
                .padding(.bottom, 6)
        case .listItem:
            listRow(marker: "•", inlines: block.inlines)
        case .orderedListItem:
            listRow(marker: "\(block.ordinal).", inlines: block.inlines)
        case .taskItem:
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: block.checked ? "checkmark.square.fill" : "square")
                    .foregroundStyle(block.checked ? Color.accentColor : Color.secondary)
                    .frame(width: 18)
                inlineText(block.inlines, font: .system(size: 16))
            }
            .padding(.leading, CGFloat(block.listDepth.saturatingSubtractingOne) * 22)
            .padding(.bottom, 8)
        case .codeBlock:
            VStack(alignment: .leading, spacing: 8) {
                if !block.language.isEmpty {
                    Text(block.language.uppercased())
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                Text(block.text)
                    .font(.system(size: 14, design: .monospaced))
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.bottom, 14)
        case .htmlBlock:
            Text(block.text)
                .font(.system(size: 14, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.bottom, 12)
        case .table:
            MarkdownTableView(rows: block.tableRows)
        case .alert:
            HStack(spacing: 8) {
                Image(systemName: block.alertType.symbolName)
                    .foregroundStyle(block.alertType.tint)
                    .frame(width: 18)
                Text(block.title.isEmpty ? block.alertType.title : block.title)
                    .font(.system(size: 15, weight: .semibold))
            }
            .padding(.top, 6)
            .padding(.bottom, 8)
        case .subtext:
            inlineText(block.inlines, font: .system(size: 13))
                .foregroundStyle(.secondary)
                .padding(.bottom, 8)
        case .blockDirective:
            Text(block.info)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.top, 8)
                .padding(.bottom, 6)
        case .divider:
            Divider()
                .padding(.vertical, 16)
        }
    }

    private var headingFont: Font {
        switch block.level {
        case 1:
            return .system(size: 34, weight: .semibold, design: .rounded)
        case 2:
            return .system(size: 26, weight: .semibold, design: .rounded)
        case 3:
            return .system(size: 21, weight: .semibold, design: .rounded)
        default:
            return .system(size: 18, weight: .semibold, design: .rounded)
        }
    }

    private func listRow(marker: String, inlines: [MarkdownInline]) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(marker)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .trailing)
            inlineText(inlines, font: .system(size: 16))
                .lineSpacing(4)
        }
        .padding(.leading, CGFloat(block.listDepth.saturatingSubtractingOne) * 22)
        .padding(.bottom, 8)
    }
}

private struct MarkdownTableView: View {
    let rows: [MarkdownTableRow]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.cells.enumerated()), id: \.offset) { _, cell in
                            inlineText(
                                cell.inlines,
                                font: .system(size: 14),
                                forceStrong: row.isHeader
                            )
                            .lineLimit(nil)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .frame(
                                minWidth: 120,
                                maxWidth: 240,
                                alignment: cell.alignment.swiftAlignment
                            )
                            .background(row.isHeader ? Color(nsColor: .controlBackgroundColor) : Color.clear)
                            .overlay {
                                Rectangle()
                                    .stroke(Color(nsColor: .separatorColor).opacity(0.55), lineWidth: 0.5)
                            }
                        }
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.bottom, 14)
    }
}

private func inlineText(
    _ inlines: [MarkdownInline],
    font: Font,
    forceStrong: Bool = false
) -> Text {
    inlines.reduce(Text("")) { partial, inline in
        var run = Text(displayText(for: inline))
            .font(inline.usesMonospacedPresentation ? .system(size: 14, design: .monospaced) : font)

        if inline.strong || forceStrong {
            run = run.bold()
        }
        if inline.emphasis {
            run = run.italic()
        }
        if inline.strikethrough {
            run = run.strikethrough()
        }
        if inline.underline {
            run = run.underline()
        }
        if inline.superscript {
            run = run.baselineOffset(5)
        }
        if inline.`subscript` {
            run = run.baselineOffset(-3)
        }
        if inline.inserted {
            run = run.underline(pattern: .dash)
        }
        if inline.highlight {
            run = run.foregroundColor(.yellow)
        }
        if inline.spoiler {
            run = run.foregroundColor(.secondary)
        }
        if inline.kind == .link || inline.kind == .wikiLink {
            run = run.foregroundColor(.accentColor).underline()
        }
        if inline.kind == .image {
            run = run.foregroundColor(.secondary).italic()
        }
        if inline.kind == .footnoteReference {
            run = run.foregroundColor(.accentColor).baselineOffset(5)
        }

        return partial + run
    }
}

private func displayText(for inline: MarkdownInline) -> String {
    switch inline.kind {
    case .softBreak:
        return " "
    case .lineBreak:
        return "\n"
    case .image:
        if inline.text.isEmpty {
            return "[image: \(inline.url)]"
        }
        return "[image: \(inline.text)]"
    case .footnoteReference:
        return "[\(inline.text)]"
    case .math:
        return inline.mathDisplay ? "\n\(inline.text)\n" : inline.text
    default:
        return inline.text
    }
}

private extension MarkdownInline {
    var usesMonospacedPresentation: Bool {
        code || kind == .code || kind == .html || kind == .math
    }
}

private extension MarkdownAlertType {
    var title: String {
        switch self {
        case .none:
            return ""
        case .note:
            return "Note"
        case .tip:
            return "Tip"
        case .important:
            return "Important"
        case .warning:
            return "Warning"
        case .caution:
            return "Caution"
        }
    }

    var symbolName: String {
        switch self {
        case .none, .note:
            return "info.circle"
        case .tip:
            return "lightbulb"
        case .important:
            return "exclamationmark.circle"
        case .warning:
            return "exclamationmark.triangle"
        case .caution:
            return "xmark.octagon"
        }
    }

    var tint: Color {
        switch self {
        case .none, .note:
            return .accentColor
        case .tip:
            return .green
        case .important:
            return .purple
        case .warning:
            return .orange
        case .caution:
            return .red
        }
    }
}

private extension MarkdownTableAlignment {
    var swiftAlignment: Alignment {
        switch self {
        case .none, .left:
            return .leading
        case .center:
            return .center
        case .right:
            return .trailing
        }
    }
}

private extension UInt32 {
    var saturatingSubtractingOne: UInt32 {
        self == 0 ? 0 : self - 1
    }
}

private let sampleMarkdown = """
---
title: Native Vault
---

# Native Markdown Editor

Type Markdown on the left. The right side is native SwiftUI rendered from Rust/Comrak blocks.

> This is an in-memory proof. No files, no database, no WebView.

## Tasks

- [x] Parse with Rust
- [x] Bridge with UniFFI
- [ ] Keep editing in memory
  - Nested list item stays separate

This paragraph has **bold**, *emphasis*, ~~strikethrough~~, `code`, [a link](https://example.com), and ![diagram](diagram.png "Diagram").

A hard break ends this line  
and continues here.

==Highlighted==, ++inserted++, e = mc^2^, H~2~O, __underlined__, ||spoiler||, $x + y$, [[Daily Note|today]], and a footnote[^proof].

[^proof]: Footnotes are parsed by Rust too.

> [!warning]
> GitHub-style alerts come through as typed native blocks.

Term

: Description list details stay exposed.

-# Subtext is a Comrak extension.

:::note
Block directives are typed too.
:::

```swift
Text("Native renderer")
    .font(.system(size: 16))
```

| Layer | Owner | Status |
| :--- | :---: | ---: |
| Parser | Rust | Done |
| Rendering | SwiftUI | Native |

---
"""

#Preview {
    ContentView()
}
