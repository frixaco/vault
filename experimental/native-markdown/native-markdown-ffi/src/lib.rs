use comrak::{
    nodes::{
        AlertType as ComrakAlertType, ListDelimType, ListType, Node, NodeList, NodeValue,
        TableAlignment as ComrakTableAlignment,
    },
    Arena, Options, parse_document,
};

#[uniffi::export]
pub fn parse_markdown(
    source: String,
    options: MarkdownParseOptions,
) -> Result<MarkdownDocument, MarkdownParseError> {
    if source.len() > MAX_MARKDOWN_BYTES {
        return Err(MarkdownParseError::InputTooLarge {
            bytes: source.len() as u64,
            max_bytes: MAX_MARKDOWN_BYTES as u64,
        });
    }

    let arena = Arena::new();
    let parser_options = comrak_options(options);
    let root = parse_document(&arena, &source, &parser_options);
    let mut blocks = Vec::new();
    collect_blocks(root, MarkdownContext::default(), &mut blocks);

    Ok(MarkdownDocument { blocks })
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct MarkdownDocument {
    pub blocks: Vec<MarkdownBlock>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct MarkdownBlock {
    pub kind: MarkdownBlockKind,
    pub text: String,
    pub inlines: Vec<MarkdownInline>,
    pub table_rows: Vec<MarkdownTableRow>,
    pub level: u8,
    pub language: String,
    pub name: String,
    pub title: String,
    pub info: String,
    pub alert_type: MarkdownAlertType,
    pub quote_depth: u32,
    pub list_depth: u32,
    pub ordinal: u32,
    pub checked: bool,
    pub list_tight: bool,
    pub list_delimiter: MarkdownListDelimiter,
    pub source_start_line: u32,
    pub source_end_line: u32,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct MarkdownInline {
    pub kind: MarkdownInlineKind,
    pub text: String,
    pub url: String,
    pub title: String,
    pub strong: bool,
    pub emphasis: bool,
    pub code: bool,
    pub strikethrough: bool,
    pub highlight: bool,
    pub inserted: bool,
    pub superscript: bool,
    pub underline: bool,
    pub subscript: bool,
    pub spoiler: bool,
    pub escaped: bool,
    pub math_display: bool,
    pub math_dollars: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MarkdownInlineKind {
    Text,
    SoftBreak,
    LineBreak,
    Code,
    Html,
    Link,
    Image,
    FootnoteReference,
    WikiLink,
    Math,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct MarkdownTableRow {
    pub is_header: bool,
    pub cells: Vec<MarkdownTableCell>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct MarkdownTableCell {
    pub text: String,
    pub inlines: Vec<MarkdownInline>,
    pub alignment: MarkdownTableAlignment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MarkdownTableAlignment {
    None,
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MarkdownAlertType {
    None,
    Note,
    Tip,
    Important,
    Warning,
    Caution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MarkdownListDelimiter {
    None,
    Period,
    Paren,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MarkdownBlockKind {
    FrontMatter,
    Heading,
    Paragraph,
    Quote,
    DescriptionList,
    DescriptionTerm,
    DescriptionDetails,
    FootnoteDefinition,
    ListItem,
    OrderedListItem,
    TaskItem,
    CodeBlock,
    HtmlBlock,
    Table,
    Alert,
    Subtext,
    BlockDirective,
    Divider,
}

#[derive(Debug, Clone, Copy, uniffi::Record)]
pub struct MarkdownParseOptions {
    pub github_flavored: bool,
    pub front_matter: bool,
    pub comrak_extensions: bool,
    pub inline_footnotes: bool,
}

impl Default for MarkdownParseOptions {
    fn default() -> Self {
        Self {
            github_flavored: true,
            front_matter: true,
            comrak_extensions: true,
            inline_footnotes: false,
        }
    }
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum MarkdownParseError {
    #[error("Markdown input is too large: {bytes} bytes exceeds {max_bytes} bytes")]
    InputTooLarge { bytes: u64, max_bytes: u64 },
}

const MAX_MARKDOWN_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Default)]
struct MarkdownContext {
    quote_depth: u32,
    list_depth: u32,
}

fn collect_blocks<'a>(node: Node<'a>, context: MarkdownContext, blocks: &mut Vec<MarkdownBlock>) {
    let node_data = node.data();
    match &node_data.value {
        NodeValue::Document => collect_child_blocks(node, context, blocks),
        NodeValue::FrontMatter(front_matter) => {
            blocks.push(markdown_block(
                node,
                MarkdownBlockKind::FrontMatter,
                plain_inlines(front_matter.trim().to_string()),
                context,
            ));
        }
        NodeValue::BlockQuote | NodeValue::MultilineBlockQuote(_) => {
            collect_child_blocks(
                node,
                MarkdownContext {
                    quote_depth: context.quote_depth + 1,
                    ..context
                },
                blocks,
            );
        }
        NodeValue::DescriptionList => {
            blocks.push(markdown_block(
                node,
                MarkdownBlockKind::DescriptionList,
                Vec::new(),
                context,
            ));
            collect_child_blocks(node, context, blocks);
        }
        NodeValue::DescriptionTerm => {
            blocks.push(markdown_block(
                node,
                MarkdownBlockKind::DescriptionTerm,
                collect_inlines(node),
                context,
            ));
        }
        NodeValue::DescriptionDetails => {
            blocks.push(markdown_block(
                node,
                MarkdownBlockKind::DescriptionDetails,
                collect_inlines(node),
                context,
            ));
            collect_child_blocks(node, context, blocks);
        }
        NodeValue::FootnoteDefinition(footnote) => {
            let mut block = markdown_block(
                node,
                MarkdownBlockKind::FootnoteDefinition,
                plain_inlines(footnote.name.clone()),
                context,
            );
            block.name = footnote.name.clone();
            blocks.push(block);
            collect_child_blocks(node, context, blocks);
        }
        NodeValue::List(list) => collect_list_blocks(node, *list, context, blocks),
        NodeValue::Paragraph => {
            let kind = if context.quote_depth > 0 {
                MarkdownBlockKind::Quote
            } else {
                MarkdownBlockKind::Paragraph
            };
            let inlines = collect_inlines(node);
            blocks.push(markdown_block(node, kind, inlines, context));
        }
        NodeValue::Heading(heading) => {
            let mut block = markdown_block(
                node,
                MarkdownBlockKind::Heading,
                collect_inlines(node),
                context,
            );
            block.level = heading.level;
            blocks.push(block);
        }
        NodeValue::CodeBlock(code) => {
            let mut block = markdown_block(
                node,
                MarkdownBlockKind::CodeBlock,
                plain_inlines(code.literal.trim_end_matches('\n').to_string()),
                context,
            );
            block.language = code.info.split_whitespace().next().unwrap_or("").to_string();
            blocks.push(block);
        }
        NodeValue::Subtext => {
            blocks.push(markdown_block(
                node,
                MarkdownBlockKind::Subtext,
                collect_inlines(node),
                context,
            ));
        }
        NodeValue::HtmlBlock(html) => {
            blocks.push(markdown_block(
                node,
                MarkdownBlockKind::HtmlBlock,
                plain_inlines(html.literal.trim().to_string()),
                context,
            ));
        }
        NodeValue::Alert(alert) => {
            let mut block = markdown_block(
                node,
                MarkdownBlockKind::Alert,
                plain_inlines(alert.title.clone().unwrap_or_else(|| {
                    alert.alert_type.default_title().to_string()
                })),
                context,
            );
            block.alert_type = markdown_alert_type(alert.alert_type);
            block.title = block.text.clone();
            blocks.push(block);
            collect_child_blocks(node, context, blocks);
        }
        NodeValue::BlockDirective(directive) => {
            let mut block = markdown_block(
                node,
                MarkdownBlockKind::BlockDirective,
                plain_inlines(directive.info.clone()),
                context,
            );
            block.info = directive.info.clone();
            blocks.push(block);
            collect_child_blocks(node, context, blocks);
        }
        NodeValue::Table(_) => {
            let table_rows = collect_table_rows(node);
            let table_text = table_rows
                .iter()
                .map(|row| {
                    row.cells
                        .iter()
                        .map(|cell| cell.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" | ")
                })
                .collect::<Vec<_>>()
                .join("\n");
            let mut block = markdown_block(
                node,
                MarkdownBlockKind::Table,
                plain_inlines(table_text),
                context,
            );
            block.table_rows = table_rows;
            blocks.push(block);
        }
        NodeValue::ThematicBreak => {
            blocks.push(markdown_block(
                node,
                MarkdownBlockKind::Divider,
                Vec::new(),
                context,
            ));
        }
        NodeValue::Item(_) | NodeValue::TaskItem(_) | NodeValue::DescriptionItem(_) => {}
        _ => collect_child_blocks(node, context, blocks),
    }
}

fn collect_list_blocks(
    node: Node<'_>,
    list: NodeList,
    context: MarkdownContext,
    blocks: &mut Vec<MarkdownBlock>,
) {
    let item_context = MarkdownContext {
        list_depth: context.list_depth + 1,
        ..context
    };
    let mut ordinal = list.start as u32;

    for child in node.children() {
        let child_data = child.data();
        let (kind, checked) = match &child_data.value {
            NodeValue::TaskItem(task) => (MarkdownBlockKind::TaskItem, task.symbol.is_some()),
            NodeValue::Item(_) if list.list_type == ListType::Ordered => {
                (MarkdownBlockKind::OrderedListItem, false)
            }
            NodeValue::Item(_) => (MarkdownBlockKind::ListItem, false),
            _ => continue,
        };
        drop(child_data);

        let mut block = markdown_block(
            child,
            kind,
            collect_list_item_inlines(child),
            item_context,
        );
        block.ordinal = if kind == MarkdownBlockKind::OrderedListItem {
            ordinal
        } else {
            0
        };
        block.checked = checked;
        block.list_tight = list.tight;
        block.list_delimiter = markdown_list_delimiter(list.delimiter);
        blocks.push(block);

        if kind == MarkdownBlockKind::OrderedListItem {
            ordinal += 1;
        }

        collect_nested_list_blocks(&child, item_context, blocks);
    }
}

fn collect_nested_list_blocks(
    node: Node<'_>,
    context: MarkdownContext,
    blocks: &mut Vec<MarkdownBlock>,
) {
    for child in node.children() {
        if matches!(child.data().value, NodeValue::List(_)) {
            collect_blocks(child, context, blocks);
        }
    }
}

fn collect_child_blocks(
    node: Node<'_>,
    context: MarkdownContext,
    blocks: &mut Vec<MarkdownBlock>,
) {
    for child in node.children() {
        collect_blocks(child, context, blocks);
    }
}

fn markdown_block(
    node: Node<'_>,
    kind: MarkdownBlockKind,
    inlines: Vec<MarkdownInline>,
    context: MarkdownContext,
) -> MarkdownBlock {
    let sourcepos = node.data().sourcepos;
    let text = text_from_inlines(&inlines);

    MarkdownBlock {
        kind,
        text,
        inlines,
        table_rows: Vec::new(),
        level: 0,
        language: String::new(),
        name: String::new(),
        title: String::new(),
        info: String::new(),
        alert_type: MarkdownAlertType::None,
        quote_depth: context.quote_depth,
        list_depth: context.list_depth,
        ordinal: 0,
        checked: false,
        list_tight: false,
        list_delimiter: MarkdownListDelimiter::None,
        source_start_line: sourcepos.start.line as u32,
        source_end_line: sourcepos.end.line as u32,
    }
}

fn collect_inlines(node: Node<'_>) -> Vec<MarkdownInline> {
    let mut inlines = Vec::new();
    collect_inlines_into(node, InlineContext::default(), false, &mut inlines);
    inlines
}

fn collect_list_item_inlines(node: Node<'_>) -> Vec<MarkdownInline> {
    let mut inlines = Vec::new();
    collect_inlines_into(node, InlineContext::default(), true, &mut inlines);
    inlines
}

fn collect_inlines_into(
    node: Node<'_>,
    context: InlineContext,
    skip_nested_lists: bool,
    inlines: &mut Vec<MarkdownInline>,
) {
    if skip_nested_lists && matches!(node.data().value, NodeValue::List(_)) {
        return;
    }

    match &node.data().value {
        NodeValue::Text(value) => push_text_inline(inlines, value.as_ref(), context),
        NodeValue::Code(code) => push_inline(
            inlines,
            MarkdownInlineKind::Code,
            &code.literal,
            InlineContext {
                code: true,
                ..context
            },
        ),
        NodeValue::Math(math) => push_inline(
            inlines,
            MarkdownInlineKind::Math,
            &math.literal,
            InlineContext {
                math_display: math.display_math,
                math_dollars: math.dollar_math,
                ..context
            },
        ),
        NodeValue::HtmlInline(value) | NodeValue::Raw(value) => {
            push_inline(inlines, MarkdownInlineKind::Html, value, context)
        }
        NodeValue::SoftBreak => push_inline(inlines, MarkdownInlineKind::SoftBreak, " ", context),
        NodeValue::LineBreak => push_inline(inlines, MarkdownInlineKind::LineBreak, "\n", context),
        NodeValue::Emph => collect_children_with_style(
            node,
            InlineContext {
                emphasis: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Strong => collect_children_with_style(
            node,
            InlineContext {
                strong: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Strikethrough => collect_children_with_style(
            node,
            InlineContext {
                strikethrough: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Highlight => collect_children_with_style(
            node,
            InlineContext {
                highlight: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Insert => collect_children_with_style(
            node,
            InlineContext {
                inserted: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Superscript => collect_children_with_style(
            node,
            InlineContext {
                superscript: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Underline => collect_children_with_style(
            node,
            InlineContext {
                underline: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Subscript => collect_children_with_style(
            node,
            InlineContext {
                subscript: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::SpoileredText => collect_children_with_style(
            node,
            InlineContext {
                spoiler: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Escaped | NodeValue::EscapedTag(_) => collect_children_with_style(
            node,
            InlineContext {
                escaped: true,
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Link(link) => collect_children_with_style(
            node,
            InlineContext {
                url: link.url.clone(),
                title: link.title.clone(),
                ..context
            },
            skip_nested_lists,
            inlines,
        ),
        NodeValue::Image(image) => {
            let mut alt_inlines = Vec::new();
            for child in node.children() {
                collect_inlines_into(child, InlineContext::default(), false, &mut alt_inlines);
            }
            let alt = text_from_inlines(&alt_inlines);
            push_inline(
                inlines,
                MarkdownInlineKind::Image,
                &alt,
                InlineContext {
                    url: image.url.clone(),
                    title: image.title.clone(),
                    ..context
                },
            );
        }
        NodeValue::FootnoteReference(footnote) => push_inline(
            inlines,
            MarkdownInlineKind::FootnoteReference,
            &footnote.name,
            context,
        ),
        NodeValue::WikiLink(wikilink) => {
            let mut label_inlines = Vec::new();
            for child in node.children() {
                collect_inlines_into(child, InlineContext::default(), false, &mut label_inlines);
            }
            let label = text_from_inlines(&label_inlines);
            let text = if label.is_empty() {
                wikilink.url.as_str()
            } else {
                label.as_str()
            };
            push_inline(
                inlines,
                MarkdownInlineKind::WikiLink,
                text,
                InlineContext {
                    url: wikilink.url.clone(),
                    ..context
                },
            );
        }
        _ => {
            for child in node.children() {
                collect_inlines_into(child, context.clone(), skip_nested_lists, inlines);
            }
        }
    }
}

fn collect_children_with_style(
    node: Node<'_>,
    context: InlineContext,
    skip_nested_lists: bool,
    inlines: &mut Vec<MarkdownInline>,
) {
    for child in node.children() {
        collect_inlines_into(child, context.clone(), skip_nested_lists, inlines);
    }
}

fn collect_table_rows(node: Node<'_>) -> Vec<MarkdownTableRow> {
    let mut rows = Vec::new();
    let alignments = match &node.data().value {
        NodeValue::Table(table) => table.alignments.clone(),
        _ => Vec::new(),
    };

    for row in node.children() {
        let is_header = match row.data().value {
            NodeValue::TableRow(is_header) => is_header,
            _ => continue,
        };

        let mut cells = Vec::new();
        for (column, cell) in row.children().enumerate() {
            let inlines = collect_inlines(cell);
            cells.push(MarkdownTableCell {
                text: text_from_inlines(&inlines),
                inlines,
                alignment: alignments
                    .get(column)
                    .copied()
                    .map(markdown_table_alignment)
                    .unwrap_or(MarkdownTableAlignment::None),
            });
        }
        rows.push(MarkdownTableRow { is_header, cells });
    }

    rows
}

fn plain_inlines(text: String) -> Vec<MarkdownInline> {
    vec![MarkdownInline {
        kind: MarkdownInlineKind::Text,
        text,
        url: String::new(),
        title: String::new(),
        strong: false,
        emphasis: false,
        code: false,
        strikethrough: false,
        highlight: false,
        inserted: false,
        superscript: false,
        underline: false,
        subscript: false,
        spoiler: false,
        escaped: false,
        math_display: false,
        math_dollars: false,
    }]
}

fn push_text_inline(inlines: &mut Vec<MarkdownInline>, text: &str, context: InlineContext) {
    let kind = if context.url.is_empty() {
        MarkdownInlineKind::Text
    } else {
        MarkdownInlineKind::Link
    };
    push_inline(inlines, kind, text, context);
}

fn push_inline(
    inlines: &mut Vec<MarkdownInline>,
    kind: MarkdownInlineKind,
    text: &str,
    context: InlineContext,
) {
    if text.is_empty() {
        return;
    }

    if let Some(last) = inlines.last_mut() {
        if last.kind == kind
            && last.url == context.url
            && last.title == context.title
            && last.strong == context.strong
            && last.emphasis == context.emphasis
            && last.code == context.code
            && last.strikethrough == context.strikethrough
            && last.highlight == context.highlight
            && last.inserted == context.inserted
            && last.superscript == context.superscript
            && last.underline == context.underline
            && last.subscript == context.subscript
            && last.spoiler == context.spoiler
            && last.escaped == context.escaped
            && last.math_display == context.math_display
            && last.math_dollars == context.math_dollars
        {
            last.text.push_str(text);
            return;
        }
    }

    inlines.push(MarkdownInline {
        kind,
        text: text.to_string(),
        url: context.url,
        title: context.title,
        strong: context.strong,
        emphasis: context.emphasis,
        code: context.code,
        strikethrough: context.strikethrough,
        highlight: context.highlight,
        inserted: context.inserted,
        superscript: context.superscript,
        underline: context.underline,
        subscript: context.subscript,
        spoiler: context.spoiler,
        escaped: context.escaped,
        math_display: context.math_display,
        math_dollars: context.math_dollars,
    });
}

fn text_from_inlines(inlines: &[MarkdownInline]) -> String {
    let mut text = String::new();
    for inline in inlines {
        text.push_str(&inline.text);
    }
    normalize_text(&text)
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Clone, Default)]
struct InlineContext {
    url: String,
    title: String,
    strong: bool,
    emphasis: bool,
    code: bool,
    strikethrough: bool,
    highlight: bool,
    inserted: bool,
    superscript: bool,
    underline: bool,
    subscript: bool,
    spoiler: bool,
    escaped: bool,
    math_display: bool,
    math_dollars: bool,
}

fn markdown_table_alignment(alignment: ComrakTableAlignment) -> MarkdownTableAlignment {
    match alignment {
        ComrakTableAlignment::None => MarkdownTableAlignment::None,
        ComrakTableAlignment::Left => MarkdownTableAlignment::Left,
        ComrakTableAlignment::Center => MarkdownTableAlignment::Center,
        ComrakTableAlignment::Right => MarkdownTableAlignment::Right,
    }
}

fn markdown_alert_type(alert_type: ComrakAlertType) -> MarkdownAlertType {
    match alert_type {
        ComrakAlertType::Note => MarkdownAlertType::Note,
        ComrakAlertType::Tip => MarkdownAlertType::Tip,
        ComrakAlertType::Important => MarkdownAlertType::Important,
        ComrakAlertType::Warning => MarkdownAlertType::Warning,
        ComrakAlertType::Caution => MarkdownAlertType::Caution,
    }
}

fn markdown_list_delimiter(delimiter: ListDelimType) -> MarkdownListDelimiter {
    match delimiter {
        ListDelimType::Period => MarkdownListDelimiter::Period,
        ListDelimType::Paren => MarkdownListDelimiter::Paren,
    }
}

fn comrak_options(options: MarkdownParseOptions) -> Options<'static> {
    let mut comrak_options = Options::default();

    if options.github_flavored {
        comrak_options.extension.strikethrough = true;
        comrak_options.extension.table = true;
        comrak_options.extension.autolink = true;
        comrak_options.extension.tasklist = true;
    }

    if options.front_matter {
        comrak_options.extension.front_matter_delimiter = Some("---".to_string());
    }

    if options.comrak_extensions {
        comrak_options.extension.description_lists = true;
        comrak_options.extension.footnotes = true;
        comrak_options.extension.multiline_block_quotes = true;
        comrak_options.extension.alerts = true;
        comrak_options.extension.math_dollars = true;
        comrak_options.extension.math_code = true;
        comrak_options.extension.wikilinks_title_after_pipe = true;
        comrak_options.extension.superscript = true;
        comrak_options.extension.underline = true;
        comrak_options.extension.subscript = true;
        comrak_options.extension.spoiler = true;
        comrak_options.extension.cjk_friendly_emphasis = true;
        comrak_options.extension.subtext = true;
        comrak_options.extension.highlight = true;
        comrak_options.extension.insert = true;
        comrak_options.extension.block_directive = true;
        comrak_options.parse.relaxed_autolinks = true;
        comrak_options.parse.relaxed_tasklist_matching = true;
        comrak_options.parse.tasklist_in_table = true;
        comrak_options.parse.leave_footnote_definitions = true;
        comrak_options.parse.escaped_char_spans = true;
    }

    if options.inline_footnotes {
        comrak_options.extension.footnotes = true;
        comrak_options.extension.inline_footnotes = true;
    }

    comrak_options
}

uniffi::setup_scaffolding!();

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_headings_tasks_code_and_tables() {
        let document = parse_markdown(
            SAMPLE_MARKDOWN.to_string(),
            MarkdownParseOptions::default(),
        )
        .unwrap();

        let kinds = document
            .blocks
            .iter()
            .map(|block| block.kind)
            .collect::<Vec<_>>();

        assert_eq!(
            kinds,
            vec![
                MarkdownBlockKind::FrontMatter,
                MarkdownBlockKind::Heading,
                MarkdownBlockKind::Paragraph,
                MarkdownBlockKind::Quote,
                MarkdownBlockKind::TaskItem,
                MarkdownBlockKind::TaskItem,
                MarkdownBlockKind::CodeBlock,
                MarkdownBlockKind::Table,
                MarkdownBlockKind::Divider,
            ]
        );
        assert_eq!(document.blocks[1].level, 1);
        assert_eq!(document.blocks[4].text, "Render with SwiftUI");
        assert!(!document.blocks[4].checked);
        assert!(document.blocks[5].checked);
        assert_eq!(document.blocks[6].language, "swift");
        assert!(document.blocks[7].text.contains("Block | Native view"));
        assert_eq!(document.blocks[7].table_rows.len(), 2);
        assert!(document.blocks[7].table_rows[0].is_header);
        assert_eq!(document.blocks[7].table_rows[1].cells[1].text, "Text");
    }

    #[test]
    fn preserves_basic_inline_styles() {
        let document = parse_markdown(
            "Hello **bold** and *emphasis* and `code`.".to_string(),
            MarkdownParseOptions::default(),
        )
        .unwrap();

        let paragraph = &document.blocks[0];

        assert_eq!(paragraph.text, "Hello bold and emphasis and code.");
        assert!(paragraph
            .inlines
            .iter()
            .any(|inline| inline.text == "bold" && inline.strong));
        assert!(paragraph
            .inlines
            .iter()
            .any(|inline| inline.text == "emphasis" && inline.emphasis));
        assert!(paragraph
            .inlines
            .iter()
            .any(|inline| inline.text == "code" && inline.code));
    }

    #[test]
    fn preserves_superscript_extension() {
        let document = parse_markdown(
            "e = mc^2^.\n".to_string(),
            MarkdownParseOptions::default(),
        )
        .unwrap();

        assert!(document.blocks[0]
            .inlines
            .iter()
            .any(|inline| inline.text == "2" && inline.superscript));
    }

    #[test]
    fn exposes_links_images_breaks_html_and_table_alignment() {
        let document = parse_markdown(
            r#"A [link](https://example.com "Example") and ![diagram](diagram.png "Diagram") and <span>html</span>
soft  
hard

| Left | Center | Right |
| :--- | :----: | ---: |
| a | b | c |
"#
            .to_string(),
            MarkdownParseOptions::default(),
        )
        .unwrap();

        let paragraph = &document.blocks[0];

        assert!(paragraph.inlines.iter().any(|inline| {
            inline.kind == MarkdownInlineKind::Link
                && inline.text == "link"
                && inline.url == "https://example.com"
                && inline.title == "Example"
        }));
        assert!(paragraph.inlines.iter().any(|inline| {
            inline.kind == MarkdownInlineKind::Image
                && inline.text == "diagram"
                && inline.url == "diagram.png"
                && inline.title == "Diagram"
        }));
        assert!(paragraph
            .inlines
            .iter()
            .any(|inline| inline.kind == MarkdownInlineKind::Html && inline.text == "<span>"));
        assert!(paragraph
            .inlines
            .iter()
            .any(|inline| inline.kind == MarkdownInlineKind::SoftBreak));
        assert!(paragraph
            .inlines
            .iter()
            .any(|inline| inline.kind == MarkdownInlineKind::LineBreak));

        let table = document
            .blocks
            .iter()
            .find(|block| block.kind == MarkdownBlockKind::Table)
            .unwrap();

        assert_eq!(
            table.table_rows[0]
                .cells
                .iter()
                .map(|cell| cell.alignment)
                .collect::<Vec<_>>(),
            vec![
                MarkdownTableAlignment::Left,
                MarkdownTableAlignment::Center,
                MarkdownTableAlignment::Right,
            ]
        );
    }

    #[test]
    fn exposes_comrak_extension_nodes() {
        let document = parse_markdown(
            r#"Term

: Definition

Hi[^a] and ==mark== ++insert++ H~2~O __under__ ||secret|| $x + y$ [[Daily Note|today]] \@

e = mc^2^.

[^a]: Footnote text.

> [!warning]
> Careful.

-# small print

:::note
Directive body.
:::
"#
            .to_string(),
            MarkdownParseOptions::default(),
        )
        .unwrap();

        assert!(document
            .blocks
            .iter()
            .any(|block| block.kind == MarkdownBlockKind::DescriptionList));
        assert!(document
            .blocks
            .iter()
            .any(|block| block.kind == MarkdownBlockKind::FootnoteDefinition && block.name == "a"));
        assert!(document.blocks.iter().any(|block| {
            block.kind == MarkdownBlockKind::Alert
                && block.alert_type == MarkdownAlertType::Warning
                && block.title == "Warning"
        }));
        assert!(document
            .blocks
            .iter()
            .any(|block| block.kind == MarkdownBlockKind::Subtext));
        assert!(document
            .blocks
            .iter()
            .any(|block| block.kind == MarkdownBlockKind::BlockDirective && block.info == "note"));

        let inlines = document
            .blocks
            .iter()
            .flat_map(|block| block.inlines.iter())
            .collect::<Vec<_>>();

        assert!(inlines
            .iter()
            .any(|inline| inline.kind == MarkdownInlineKind::FootnoteReference));
        assert!(inlines.iter().any(|inline| inline.highlight));
        assert!(inlines.iter().any(|inline| inline.inserted));
        assert!(inlines.iter().any(|inline| inline.superscript));
        assert!(inlines.iter().any(|inline| inline.subscript));
        assert!(inlines.iter().any(|inline| inline.underline));
        assert!(inlines.iter().any(|inline| inline.spoiler));
        assert!(inlines
            .iter()
            .any(|inline| inline.kind == MarkdownInlineKind::Math && inline.math_dollars));
        assert!(inlines.iter().any(|inline| {
            inline.kind == MarkdownInlineKind::WikiLink
                && inline.url == "Daily Note"
                && inline.text == "today"
        }));
        assert!(inlines.iter().any(|inline| inline.escaped));
    }

    #[test]
    fn supports_inline_footnotes_when_enabled() {
        let document = parse_markdown(
            "Hi^[An inline note].".to_string(),
            MarkdownParseOptions {
                inline_footnotes: true,
                ..MarkdownParseOptions::default()
            },
        )
        .unwrap();

        assert!(document
            .blocks
            .iter()
            .any(|block| block.kind == MarkdownBlockKind::FootnoteDefinition));
        assert!(document.blocks.iter().flat_map(|block| block.inlines.iter()).any(
            |inline| inline.kind == MarkdownInlineKind::FootnoteReference
        ));
    }

    #[test]
    fn nested_list_items_do_not_absorb_child_text() {
        let document = parse_markdown(
            "- parent\n  - child\n- sibling".to_string(),
            MarkdownParseOptions::default(),
        )
        .unwrap();

        let items = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.text.as_str(), block.list_depth))
            .collect::<Vec<_>>();

        assert_eq!(
            items,
            vec![
                (MarkdownBlockKind::ListItem, "parent", 1),
                (MarkdownBlockKind::ListItem, "child", 2),
                (MarkdownBlockKind::ListItem, "sibling", 1),
            ]
        );
    }

    #[test]
    fn rejects_oversized_input() {
        let error = parse_markdown(
            "x".repeat(MAX_MARKDOWN_BYTES + 1),
            MarkdownParseOptions::default(),
        )
        .unwrap_err();

        assert!(matches!(error, MarkdownParseError::InputTooLarge { .. }));
    }

    const SAMPLE_MARKDOWN: &str = r#"---
title: Native Markdown
---

# Native Markdown

Hello **Vault** and regular links.

> This quote stays native.

- [ ] Render with SwiftUI
- [x] Parse with Comrak

```swift
Text("native")
```

| Block | Native view |
| --- | --- |
| Heading | Text |

---
"#;
}
