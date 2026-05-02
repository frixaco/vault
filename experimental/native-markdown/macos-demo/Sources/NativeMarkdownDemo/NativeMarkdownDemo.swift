import NativeMarkdownFFI
import SwiftUI

@main
struct NativeMarkdownDemoApp: App {
    var body: some Scene {
        WindowGroup {
            MarkdownPreviewScreen()
                .frame(minWidth: 760, minHeight: 640)
        }
        .windowStyle(.hiddenTitleBar)
    }
}

struct MarkdownPreviewScreen: View {
    @State private var state = MarkdownPreviewState.loading

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                switch state {
                case .loading:
                    ProgressView()
                        .controlSize(.large)
                        .frame(maxWidth: .infinity, minHeight: 420)
                case .loaded(let document):
                    ForEach(Array(document.blocks.enumerated()), id: \.offset) { _, block in
                        MarkdownBlockView(block: block)
                    }
                case .failed(let message):
                    Text(message)
                        .font(.system(.body, design: .rounded))
                        .foregroundStyle(.red)
                        .padding(24)
                }
            }
            .frame(maxWidth: 820, alignment: .leading)
            .padding(32)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .task {
            state = MarkdownPreviewState.load()
        }
    }
}

struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block.kind {
        case .frontMatter:
            EmptyView()
        case .heading:
            Text(block.text)
                .font(headingFont)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
                .padding(.top, headingTopPadding)
                .padding(.bottom, headingBottomPadding)
        case .paragraph:
            Text(block.text)
                .font(.system(size: 16))
                .lineSpacing(4)
                .padding(.bottom, 12)
        case .quote:
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Rectangle()
                    .fill(Color.accentColor.opacity(0.45))
                    .frame(width: 3)
                Text(block.text)
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .lineSpacing(4)
            }
            .padding(.leading, CGFloat(block.quoteDepth.saturatingSubtractingOne) * 18)
            .padding(.bottom, 12)
        case .listItem:
            listRow(marker: "•", text: block.text)
        case .orderedListItem:
            listRow(marker: "\(block.ordinal).", text: block.text)
        case .taskItem:
            taskRow
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
            Text(block.text)
                .font(.system(size: 14, design: .monospaced))
                .textSelection(.enabled)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding(.bottom, 14)
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

    private var headingTopPadding: CGFloat {
        block.level == 1 ? 10 : 18
    }

    private var headingBottomPadding: CGFloat {
        block.level == 1 ? 14 : 10
    }

    private var taskRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: block.checked ? "checkmark.square.fill" : "square")
                .foregroundStyle(block.checked ? Color.accentColor : Color.secondary)
                .imageScale(.medium)
                .frame(width: 18)
            Text(block.text)
                .font(.system(size: 16))
        }
        .padding(.leading, CGFloat(block.listDepth.saturatingSubtractingOne) * 22)
        .padding(.bottom, 8)
    }

    private func listRow(marker: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(marker)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .trailing)
            Text(text)
                .font(.system(size: 16))
                .lineSpacing(4)
        }
        .padding(.leading, CGFloat(block.listDepth.saturatingSubtractingOne) * 22)
        .padding(.bottom, 8)
    }
}

enum MarkdownPreviewState {
    case loading
    case loaded(MarkdownDocument)
    case failed(String)

    static func load() -> MarkdownPreviewState {
        guard let url = Bundle.module.url(forResource: "sample", withExtension: "md") else {
            return .failed("sample.md is missing from the app bundle.")
        }

        do {
            let source = try String(contentsOf: url, encoding: .utf8)
            let options = MarkdownParseOptions(
                githubFlavored: true,
                frontMatter: true
            )
            let document = try parseMarkdown(source: source, options: options)
            return .loaded(document)
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}

private extension UInt32 {
    var saturatingSubtractingOne: UInt32 {
        self == 0 ? 0 : self - 1
    }
}
