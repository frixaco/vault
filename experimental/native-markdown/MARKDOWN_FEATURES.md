# Native Markdown Feature Contract

This file tracks the Markdown syntax that Comrak can parse and that Rust must expose to native renderers. Rust owns parsing through Comrak. SwiftUI owns presentation and must not re-parse Markdown strings.

## Blocks

| Feature | Source | Rust exposure | SwiftUI rendering |
| --- | --- | --- | --- |
| Front matter | Comrak extension used by Vault notes | `FrontMatter` block with raw text | Hidden in the editor proof |
| Paragraph | CommonMark | `Paragraph` with inline runs | Native text |
| Heading | CommonMark ATX/setext | `Heading`, `level` | Native heading text |
| Thematic break | CommonMark | `Divider` | Native `Divider` |
| Block quote | CommonMark | Child blocks with `quote_depth` | Native text with quote rule |
| Multiline block quote | Comrak extension | Same quote model with `quote_depth` | Native quote rendering |
| Bullet list | CommonMark | `ListItem`, `list_depth` | Native list row |
| Ordered list | CommonMark | `OrderedListItem`, `ordinal`, `list_depth` | Native numbered row |
| Task list | GFM | `TaskItem`, `checked`, `list_depth` | Native checkbox row |
| Code block | CommonMark fenced/indented | `CodeBlock`, `language`, raw text | Native monospaced code block |
| HTML block | CommonMark | `HtmlBlock`, raw text | Native monospaced raw HTML |
| Table | GFM | `Table` with rows/cells/alignment | Native SwiftUI grid |
| Description list | Comrak extension | `DescriptionList`, `DescriptionTerm`, `DescriptionDetails` | Native term/detail text |
| Footnote definition | Comrak extension | `FootnoteDefinition`, `name`, child blocks | Native footnote section text |
| Alert | Comrak extension | `Alert`, `alert_type`, `title`, child blocks | Native callout heading/body |
| Subtext | Comrak extension | `Subtext` with inline runs | Native subdued text |
| Block directive | Comrak extension | `BlockDirective`, `info`, child blocks | Native directive container label/body |

## Inlines

| Feature | Source | Rust exposure | SwiftUI rendering |
| --- | --- | --- | --- |
| Text | CommonMark | `Text` inline | Native text span |
| Emphasis | CommonMark | `emphasis` flag on inline span | Italic span |
| Strong | CommonMark | `strong` flag on inline span | Bold span |
| Code span | CommonMark | `Code` inline and `code` flag | Monospaced span |
| Soft break | CommonMark | `SoftBreak` inline | Space in flowing text |
| Hard break | CommonMark | `LineBreak` inline | Newline in native text |
| Link | CommonMark + GFM autolink | `Link` inline with `url` and `title` | Accent, underlined native span |
| Image | CommonMark | `Image` inline with `url`, `title`, and alt text | Native image placeholder span |
| Inline HTML | CommonMark raw HTML | `Html` inline | Monospaced raw span |
| Strikethrough | GFM | `strikethrough` flag on inline span | Struck span |
| Highlight | Comrak extension | `highlight` flag on inline span | Marked span |
| Insert | Comrak extension | `inserted` flag on inline span | Inserted span |
| Superscript | Comrak extension | `superscript` flag on inline span | Superscript-styled span |
| Underline | Comrak extension | `underline` flag on inline span | Underlined span |
| Subscript | Comrak extension | `subscript` flag on inline span | Subscript-styled span |
| Spoiler | Comrak extension | `spoiler` flag on inline span | Muted spoiler span |
| Footnote reference | Comrak extension | `FootnoteReference` inline with name | Superscript reference span |
| Inline footnote | Comrak extension | Optional parse mode; becomes footnote reference + definition | Native footnote rendering |
| Math | Comrak extension | `Math` inline with display/dollar metadata | Monospaced/math placeholder span |
| Wikilink | Comrak extension | `WikiLink` inline with target and label | Link-styled native span |
| Escaped char span | Comrak parse option | `escaped` flag on inline span | Native text span |

## Syntax That Collapses Into Existing Nodes

| Syntax | Render contract |
| --- | --- |
| Backslash escapes | Comrak resolves escaped text into normal text nodes |
| Character/entity references | Comrak resolves them into text nodes |
| Link reference definitions | Comrak resolves references into `Link`/`Image` inlines |
| Autolinks | GFM autolinks resolve into `Link` inlines |
| Tight vs loose lists | Current proof renders item rows using the same block records; list density can be added as a field if the production renderer needs it |
| CJK-friendly emphasis | Comrak changes parsing behavior; output still uses `emphasis`/`strong` spans |
| Tagfilter | HTML sanitizer behavior for HTML output; native renderer exposes raw HTML as typed HTML spans/blocks |
| Link/image URL rewriters | Comrak render hooks, not AST syntax; native URL policy should live above the parser model |

## Build-Feature-Gated Comrak Support

Shortcodes and Phoenix HEEx are gated behind Comrak crate features. The current experiment builds Comrak with `default-features = false`, so those AST nodes are not compiled in yet. If Vault enables those features, they must be added to this contract and exposed just like the rest.

## Known Syntax Conflict

Comrak supports both superscript and inline footnotes, but inline footnotes use `^` syntax too. The default native parser keeps `inline_footnotes` off so superscript works. `inline_footnotes` is exposed as a parse option and can be enabled when that behavior is desired.
