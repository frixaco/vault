# Research Notes

This is a living notebook for desktop memory, packaging, and architecture
research for Vault.

## Goal

Vault should feel like a modern Obsidian competitor while keeping the desktop
app lean:

- avoid unnecessary always-on processes;
- keep the renderer focused on UI;
- package only production build outputs;
- measure real release memory instead of guessing;
- preserve a clean path for a future CLI.

## Current Vault Baseline

The first signed Apple Silicon release measurement was produced by:

```sh
pnpm measure-desktop-mac
```

Result:

- app size: `215.42 MB`;
- DMG size: `87.62 MB`;
- ZIP size: `92.61 MB`;
- average RSS: `383.2 MB`;
- peak RSS: `383.2 MB`;
- process count: `4`.

Important context:

- the current desktop app is still a tiny starter Electron app;
- the installed size is dominated by Electron Framework, not app code;
- `app.asar` is tiny today;
- Activity Monitor's Memory column is not the same as summing process-tree RSS
  with `ps`, so our benchmark numbers can look much larger than Activity
  Monitor row values.

## T3 Code Findings

Repository inspected: `pingdotgg/t3code`.

Installed app inspected: `/Applications/T3 Code (Alpha).app`.

Measured behavior:

- installed app size: about `397 MB`;
- initial sampled summed RSS: about `860 MB` average, `1067 MB` peak;
- later settled process tree: about `730 MB` summed RSS across `5` processes;
- it launched a backend server process:

```text
/Applications/T3 Code (Alpha).app/Contents/Resources/app.asar/apps/server/dist/bin.mjs --bootstrap-fd 3
```

Notable issue:

- quitting the UI left the server process orphaned under PID 1 during the
  measurement run; it had to be killed manually.

### Useful T3 Code Build Pattern

T3 Code's most useful lesson is its release staging approach:

1. Build desktop, server, and web outputs first.
2. Create a temporary staged app directory.
3. Copy only the required build outputs and resources into the stage.
4. Write a minimal staged `package.json`.
5. Install production dependencies only.
6. Run `electron-builder` from the staged app directory.

Files and packages observed:

- custom build script: `scripts/build-desktop-artifact.ts`;
- desktop build output: `apps/desktop/dist-electron`;
- server build output: `apps/server/dist`;
- server package publishes only `dist`;
- internal packages are bundled with `tsdown` using `noExternal`;
- app web assets are served from the built server output;
- desktop spawns the backend with `process.execPath` and
  `ELECTRON_RUN_AS_NODE=1`, reusing Electron as the Node runtime.

### What To Copy From T3 Code

- Stage release artifacts instead of packaging the workspace tree.
- Copy only runtime build outputs, resources, and production dependencies.
- Avoid packaging repo source, tests, dev-only files, root `node_modules`, and
  sourcemaps unless a production feature explicitly needs them.
- If a backend-like process is ever needed, consider reusing Electron as Node
  rather than bundling a separate Node runtime.

### What Not To Copy Blindly

- Do not adopt an always-on server/client architecture just because T3 Code has
  one.
- Do not let background processes survive after the UI exits.
- Do not assume T3 Code is aggressively size-optimized. Its app bundle still
  had large dependencies, sourcemaps, and unpacked native package payloads.

## VS Code Findings

Repository inspected: `microsoft/vscode`.

Useful source areas:

- curated packaging resources: `build/gulpfile.vscode.ts`;
- production dependency filtering and ASAR packaging:
  `build/gulpfile.vscode.ts`;
- bundle/minify/mangle pipeline: `build/gulpfile.vscode.ts`;
- startup lifecycle phases:
  `src/vs/workbench/common/contributions.ts`;
- delayed service instantiation:
  `src/vs/platform/instantiation/common/instantiationService.ts`;
- startup performance marks and code cache setup: `src/main.ts`;
- user-facing performance diagnostics: VS Code Performance Issues wiki.

### Useful VS Code Build Lessons

VS Code does not rely on broad package globs. It curates release contents:

- explicit resource lists;
- explicit dependency filtering;
- production dependency graph only;
- pruning of tests, lockfiles, sources, and sourcemaps where safe;
- native, WASM, and binary files unpacked as needed;
- main/preload/renderer code bundled for release;
- minification and property mangling in production builds.

This aligns with the T3 Code staging lesson: release packaging should be an
intentional artifact, not a copy of the development workspace.

### Useful VS Code Runtime Lessons

VS Code treats startup as a budgeted lifecycle:

- `Starting`: only critical early work;
- `Ready`: work needed once the workbench is usable;
- `Restored`: work after visible restoration;
- `Eventually`: delayed non-critical work.

It also uses delayed service instantiation so heavy services are not created
until they are actually used.

For Vault, this suggests:

- define startup phases early;
- require each service/plugin contribution to declare when it can run;
- keep vault scanning, indexing, sync, and plugin activation out of the first
  paint path whenever possible;
- add performance marks from the first main-process line;
- provide diagnostics similar to `code --status` for our future `vault` CLI.

### What To Copy From VS Code

- Curated release packaging.
- Bundled/minified release code.
- Explicit startup lifecycle phases.
- Lazy service construction.
- Activation-event-based plugin loading.
- First-class performance diagnostics.
- Process/memory visibility for debugging user reports.

### What Not To Copy Blindly

- VS Code's full build system complexity.
- Shared process and remote-agent architecture before Vault needs it.
- Extension-host machinery before the plugin model exists.
- Large architectural abstractions that are only justified at VS Code scale.

## CLI Direction

The desired CLI can follow Obsidian-style app commands without requiring an
always-on desktop server.

Preferred shape:

```text
packages/vault-core
  filesystem, markdown, metadata, links, tags, search, tasks

desktop
  imports core directly

cli
  imports core directly for disk/index commands
  uses local app IPC only for commands needing live UI state
```

Direct CLI commands should handle things like:

- create/open notes by path;
- search vault contents;
- inspect backlinks/tags/tasks;
- run vault diagnostics;
- rebuild or inspect the local index.

Live-app IPC should be reserved for things like:

- opening a note in the running desktop UI;
- focusing windows/tabs;
- running UI commands;
- querying currently open workspace state.

This keeps the CLI path open without forcing Vault into a permanent
server/client desktop architecture.

## Rust And WASM Direction

Rust/WASM should be used as a specialized engine layer, not as a blanket rewrite.

The main rule:

> Rust/WASM helps only when it avoids a large JavaScript dependency graph, keeps
> heavy work out of the renderer, or lets expensive work run briefly and then be
> released.

It will not significantly reduce Electron's fixed baseline. Chromium renderer,
GPU, network service, crashpad, and Electron framework costs remain.

### Good Candidates

- vault file scanning;
- Markdown parsing;
- frontmatter parsing;
- wikilink extraction;
- backlink graph construction;
- tag and task extraction;
- search indexing;
- fuzzy search;
- SQLite/FST index maintenance;
- encryption, compression, and sync delta logic;
- import/export pipelines.

These areas are likely to become heavy in a serious notes app and should not all
live as always-loaded renderer JavaScript.

### Rust Native Vs WASM

| Approach                | Good for                        | Memory impact            | Tradeoff                    |
| ----------------------- | ------------------------------- | ------------------------ | --------------------------- |
| Rust native binary      | CLI, scanning, indexing, search | Good if short-lived      | Extra process if always-on  |
| Rust N-API addon        | hot desktop paths               | Good, no sidecar process | Native packaging complexity |
| WASM in worker          | portable parsing/search engines | Good if lazy-loaded      | WASM memory is still memory |
| WASM in renderer        | small isolated engines          | mixed                    | can still bloat renderer    |
| Rust for whole app core | possible long-term              | risky early              | slows iteration             |

### Preferred First Target

The best first Rust/WASM target is the vault index/search engine.

Reasons:

- central to the product;
- obvious performance pressure;
- easy to test with golden files;
- usable by both desktop and CLI;
- can run away from the renderer thread;
- can replace a pile of heavy JavaScript parsing/search dependencies;
- can be lazy-loaded only after a vault is opened.

Possible shape:

```text
packages/vault-core-ts
  app-facing types, commands, persistence contracts

crates/vault-index
  markdown/frontmatter/link/tag/task extraction
  incremental index updates
  search primitives

desktop
  loads the index engine in a worker after vault open

cli
  uses the same engine for search/index/doctor commands
```

### What Not To Move Early

- UI state;
- editor state;
- command palette logic;
- settings schema;
- plugin API surface;
- small Markdown transforms;
- routing and window behavior.

Those are easier to evolve in TypeScript and are not likely to produce enough
memory savings to justify early Rust complexity.

## Markdown Editor Research

Research date: `2026-04-26`.

Assumption: Vault's source of truth should remain Markdown files. The visible
editor can use an internal document model, but import/export must be covered by
golden tests before we trust it with user notes.

### How Editor Size Matters In Electron

Small JavaScript bundle differences will not meaningfully change the installed
size while Electron itself dominates the baseline. They still matter because the
renderer must download from `app.asar`, parse, compile, instantiate, retain
module graphs, and keep editor state alive.

The practical size budget should focus on:

- renderer startup cost;
- long-note editing memory;
- amount of code loaded before first note open;
- transitive dependencies that get packaged into `app.asar`;
- sourcemaps, tests, locales, themes, examples, and generated assets that can
  accidentally ship;
- whether optional editor features can be lazy-loaded.

For Vault, runtime shape matters more than package headline size. A tiny wrapper
around a large dependency graph is still a large editor.

Package metadata checked with `npm view`:

| Option             | Current package signal                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tiptap             | `@tiptap/react@3.22.4` is about `470 KB` unpacked; `@tiptap/markdown@3.22.4` is about `321 KB`; `@tiptap/starter-kit` pulls many modular Tiptap extensions and `@tiptap/pm`.    |
| CKEditor           | `ckeditor5@48.0.1` is about `40 MB` unpacked and depends on a broad official plugin set.                                                                                        |
| Plate              | `platejs@53.0.0` is a tiny umbrella package, but real use pulls Plate, Slate, React helpers, and Markdown conversion dependencies.                                              |
| BlockNote          | `@blocknote/core@0.49.0` is about `7.2 MB`; `@blocknote/react@0.49.0` about `1.7 MB`; it pulls Tiptap, ProseMirror, Yjs, emoji, unified/remark/rehype, and UI-related packages. |
| Novel              | `novel@1.0.2` is a small wrapper package, but it pulls Tiptap 2, Radix, cmdk, jotai, `react-markdown`, `react-moveable`, `react-tweet`, KaTeX, and Tippy.                       |
| ProseMirror direct | A basic set of `prosemirror-*` modules for state/view/model/markdown/schema/list/history/keymap/inputrules is roughly a couple MB unpacked before bundling.                     |
| Lexical            | `lexical@0.43.0` is about `1.6 MB`; common packages like `@lexical/react`, `@lexical/markdown`, list/link/rich-text/code add more, but the system is modular.                   |
| Comrak/Rust        | Comrak is a Rust CommonMark/GFM parser-renderer, not a browser editor framework.                                                                                                |

### Tiptap

Docs checked:

- [Simple Editor template](https://tiptap.dev/docs/ui-components/templates/simple-editor)
- [Markdown extension](https://tiptap.dev/docs/editor/markdown/getting-started)
- [Tiptap and ProseMirror](https://tiptap.dev/docs/editor/core-concepts/prosemirror)

Relevant facts:

- Tiptap is a headless editor framework built on ProseMirror.
- The Simple Editor template is free, MIT licensed, React-friendly, and already
  includes common controls: formatting, headings, lists, links, image upload,
  undo/redo, responsive layout, and light/dark support.
- Tiptap 3 has an official Markdown package, currently documented as beta, that
  supports Markdown parsing and serialization.
- Tiptap can expose underlying ProseMirror packages through `@tiptap/pm`, which
  gives us an escape hatch if we need lower-level behavior later.

Pros for Vault:

- Best practical speed-to-quality ratio.
- Lets us ship a polished editor quickly without owning every selection,
  clipboard, toolbar, input-rule, IME, and schema edge case.
- ProseMirror foundation is proven for structured docs and collaborative
  editing.
- Good path to a custom Vault editing experience: start from Simple Editor,
  delete features we do not need, then add note-specific behavior.
- Strong escape hatch into raw ProseMirror if we outgrow the Tiptap abstraction.

Risks:

- Markdown support is still labeled beta, so round-trip fidelity must be tested
  aggressively.
- The Simple Editor template is a starting point, not a final product surface.
- Easy to over-install extensions and accidentally build a heavy Notion-like
  editor when Vault needs a focused Markdown editor.

Verdict:

- Top pick for the first serious editor prototype.
- Use the Simple Editor template as reference code, then curate the extension
  set and lazy-load optional tools.
- Store Markdown on disk, but keep editor state in ProseMirror/Tiptap JSON while
  editing.

### CKEditor

Docs checked:

- [CKEditor licensing](https://ckeditor.com/docs/ckeditor5/latest/getting-started/licensing/license-and-legal.html)
- [CKEditor Markdown output](https://ckeditor.com/docs/ckeditor5/latest/features/markdown.html)

Relevant facts:

- CKEditor 5 is dual-licensed: GPL 2+ or commercial.
- Its Markdown plugin changes the data processor to Markdown/GFM, but CKEditor's
  own docs warn that Markdown does not cover every rich-text feature and that
  advanced formatting can be stripped.
- The current `ckeditor5` npm package has a large direct unpacked size and a
  broad official dependency set.

Pros for Vault:

- Mature, accessible, production-oriented rich text editor.
- Strong plugin ecosystem and polished behavior.
- Good if Vault were a document editor with complex enterprise rich-text needs.

Risks:

- Licensing is awkward for a commercial closed-source desktop app unless we buy
  or negotiate the right license.
- Large dependency surface compared with the alternatives.
- HTML remains CKEditor's preferred rich-text data format; Markdown is supported
  but not the center of gravity.

Verdict:

- Not a good default for Vault.
- Keep in mind only if we decide paid/editor-vendor polish is worth the bundle,
  license, and data-model tradeoffs.

### Plate

Docs checked:

- [Plate Markdown](https://platejs.org/docs/markdown)

Relevant facts:

- Plate is built on Slate.
- Its Markdown package provides two-way Markdown conversion and uses the
  unified/remark ecosystem.
- The Markdown architecture is rich and customizable: Markdown to mdast, remark
  plugins, mdast to Slate/Plate nodes, and back again.

Pros for Vault:

- Very powerful for bespoke rich-text editing.
- Strong Markdown conversion story via remark plugins.
- Useful if we need deep custom blocks, comments, suggestions, AI editing, or
  structured document workflows.

Risks:

- More framework and plugin surface than Vault needs for the first editor.
- Slate/Plate behavior means we are choosing a different editing substrate from
  the ProseMirror ecosystem used by Tiptap and BlockNote.
- The example/editor-kit direction encourages broad feature composition, which
  can grow the renderer quickly.

Verdict:

- Serious contender for a heavy rich-doc product, but not ideal for a lean
  Obsidian-style Markdown app.
- Revisit only if Tiptap/ProseMirror cannot support a key Vault interaction.

### BlockNote

Docs checked:

- [BlockNote introduction](https://www.blocknotejs.org/docs)
- [BlockNote Markdown](https://www.blocknotejs.org/docs/features/import/markdown)

Relevant facts:

- BlockNote is a block-based React rich-text editor built on ProseMirror and
  Tiptap.
- It is designed for a Notion-like out-of-the-box experience with ready-made UI
  components, collaboration, and structured blocks.
- It can import/export Markdown, but its native mental model is blocks.

Pros for Vault:

- Fastest path to a Notion-like block editor.
- Built-in UI and collaboration affordances.
- Good for apps where block manipulation is the main UX.

Risks:

- It pulls a larger dependency graph than plain Tiptap.
- Block-first editing may fight a Markdown-file-first product.
- Ready-made UI is useful, but Vault likely needs a calmer, denser,
  note-native editor.

Verdict:

- Not a top pick for a lean Obsidian competitor.
- Good reference for block interactions, drag handles, and command menus.

### Novel

Docs checked:

- [Novel introduction](https://novel.sh/docs)

Relevant facts:

- Novel is a headless Notion-style WYSIWYG editor built on Tiptap, TypeScript,
  Radix UI, and cmdk.
- The current npm dependency graph pulls Tiptap 2-era packages plus extra UI,
  media, Markdown, movement, tweet, KaTeX, and tooltip dependencies.

Pros for Vault:

- Useful as an example of a productized Tiptap editor.
- Slash command and Notion-style UX ideas may be worth studying.

Risks:

- It is not the best foundation now that Tiptap has its own Simple Editor
  template.
- It brings a lot of product-specific assumptions and dependencies.

Verdict:

- Use as inspiration only.
- Do not base Vault on Novel.

### ProseMirror Direct

Docs checked:

- [ProseMirror guide](https://prosemirror.net/docs/guide/)
- [prosemirror-markdown](https://github.com/ProseMirror/prosemirror-markdown)

Relevant facts:

- ProseMirror gives full control over schema, transactions, plugins, view, and
  document updates.
- Its own guide explicitly frames it as a toolkit rather than a drop-in editor.
- `prosemirror-markdown` provides a CommonMark-like schema plus parser and
  serializer between Markdown and ProseMirror documents.

Pros for Vault:

- Best control/performance ceiling among the JavaScript options.
- Smallest curated dependency set if we build only what Vault needs.
- Strong fit for a Markdown-first editor where schema, plugin activation, and
  serialization rules are product-defining.
- Avoids Tiptap abstraction cost while staying in the same underlying ecosystem.

Risks:

- Much more engineering work before the editor feels good.
- We would own toolbar behavior, commands, menus, paste rules, node views,
  Markdown shortcuts, accessibility polish, and many editing edge cases.
- Easy to spend months rebuilding what Tiptap already gives us.

Verdict:

- Best long-term escape hatch if Tiptap becomes limiting.
- Not the fastest first implementation unless the product bet is "we are an
  editor company first and everything else second."

### Lexical

Docs checked:

- [Lexical home](https://lexical.dev/)
- [`@lexical/markdown`](https://www.npmjs.com/package/%40lexical/markdown)

Relevant facts:

- Lexical is a lean editor framework from Meta.
- The core is intentionally minimal; rich text, toolbars, Markdown, and UI live
  in plugins.
- `@lexical/markdown` supports import, export, and Markdown shortcuts through
  transformers.

Pros for Vault:

- Strong performance-oriented architecture.
- Modular and React-friendly.
- Good if we want to own more of the UX while avoiding raw `contenteditable`
  pain.
- Potentially excellent for a custom, focused writing surface.

Risks:

- Less Markdown-file-native than the ProseMirror/Tiptap path.
- Smaller ecosystem for Obsidian-like Markdown editor patterns.
- More custom work than Tiptap to reach a full notes-editor experience.

Verdict:

- Top-three option.
- Best alternative if we dislike ProseMirror/Tiptap ergonomics after a
  prototype.

### Custom Or Rust-Based Editor

Docs checked:

- [Comrak](https://comrak.ee/)

Relevant facts:

- Comrak is a Rust CommonMark/GFM-compatible parser and renderer.
- It can be used as a CLI, Rust library, or via WASM.
- It solves Markdown parsing/rendering, not browser text editing.

Pros for Vault:

- Excellent candidate for preview rendering, import/export, vault indexing,
  wikilink/tag/task extraction, diagnostics, and CLI commands.
- Rust native can be short-lived for CLI/indexing.
- WASM can be lazy-loaded in a worker for parse-heavy work.

Risks:

- A parser does not provide selection, IME, undo/redo, clipboard, decorations,
  accessibility, scrolling, input rules, composition events, collaboration, or
  plugin UI.
- A custom editor would force us into years of browser editing edge cases.
- WASM crossing and serialization can erase wins if called on every keystroke.

Verdict:

- Do not build the primary interactive editor in Rust.
- Use Rust/WASM beside the editor for parsing/indexing/preview/export, with
  batch APIs and golden tests.

### Top Three For Vault

1. Tiptap, starting from the Simple Editor template.
   - Best balance of speed, quality, ecosystem, customization, and future
     escape hatch.
   - Recommended first prototype.
2. ProseMirror direct.
   - Best control and long-term performance ceiling.
   - Recommended fallback if Tiptap adds too much abstraction or bundle/runtime
     cost.
3. Lexical.
   - Best non-ProseMirror contender for a lean custom editor.
   - Recommended comparison prototype if we want to validate editing feel and
     renderer memory against the ProseMirror path.

Not recommended as foundations right now:

- CKEditor: too large/licensing-heavy and not Markdown-first enough.
- Plate: powerful, but likely too much framework surface for a lean note app.
- BlockNote: excellent Notion-style shortcut, but too block/product-opinionated.
- Novel: useful inspiration, but less attractive than modern Tiptap directly.
- Custom/Rust editor: wrong level of abstraction for interactive editing.

Recommended prototype plan:

1. Build one Tiptap Simple Editor prototype with a curated extension list.
2. Add Markdown round-trip golden tests using real Obsidian-style notes.
3. Measure renderer memory and built app size with the same release benchmark
   discipline used for desktop memory.
4. If Tiptap feels heavy or round-tripping is poor, build a narrow ProseMirror
   direct spike before trying another high-level editor.
5. Use Rust/WASM for indexing/search/preview experiments independently of the
   interactive editor choice.

### Customization And Notion-Like Behavior

Question: which option is most "library-like" if Vault wants Markdown-first
editing with Notion-like behavior for some elements?

Ranking:

1. Tiptap.
   - Best customization/productivity balance.
   - It is built on ProseMirror but gives a much nicer extension API.
   - Custom nodes, marks, commands, keyboard shortcuts, input rules, paste
     rules, React node views, slash menus, drag handles, embeds, and Markdown
     serialization hooks are all natural fits.
   - Best fit if Vault wants a Markdown editor where certain blocks become
     richer: callouts, images, embeds, task blocks, backlinks, slash commands,
     block actions, and future structured elements.
2. Plate.
   - Probably the most batteries-included for Notion-like rich document
     behavior.
   - Very customizable and has many prebuilt editor patterns.
   - Better if the product direction becomes "Notion-like document editor" more
     than "Markdown-first notes app."
   - Risk: more framework surface, more plugin surface, and likely more bundle
     growth than Vault needs early.
3. ProseMirror direct.
   - Maximum control and best long-term performance ceiling.
   - Least ergonomic; we would build our own editor library layer before
     product work moves quickly.
   - Best fallback if Tiptap's abstraction gets in the way.
4. Lexical.
   - Clean, modular, React-friendly, and performance-minded.
   - Customizable, but Vault would write more editor infrastructure from
     scratch than with Tiptap.
   - Strong comparison spike, but less naturally aligned with Markdown-first
     note-editor patterns than the ProseMirror/Tiptap path.

Customization conclusion:

- Tiptap is the best default for "mostly Markdown, selectively Notion-like."
- Plate is the best alternative only if the product becomes broadly block-doc
  oriented.
- ProseMirror direct is the escape hatch for deep control.
- Lexical is the smallest serious alternative, but likely requires more
  product-specific editor work.

### Top Three Bundle Size Check

Measured on `2026-04-26` with `esbuild`, `bundle: true`, `minify: true`,
`treeShaking: true`, `platform: browser`, and representative Markdown-capable
editor entrypoints.

React was measured both ways:

- `editor-only`: `react`, `react-dom`, and `react/jsx-runtime` externalized,
  because React is likely app baseline;
- `with-react`: React bundled where the editor entrypoint imports it.

Representative entrypoints:

- Tiptap: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`;
- ProseMirror direct: state/view/model/basic schema/list/history/keymap/commands
  /inputrules/markdown;
- Lexical: `lexical`, `@lexical/react`, rich text, Markdown, list, link, code,
  history.

Result:

| Option      | Minified editor-only | Gzip editor-only | Brotli editor-only | Minified with React | Gzip with React | Brotli with React |
| ----------- | -------------------- | ---------------- | ------------------ | ------------------- | --------------- | ----------------- |
| Lexical     | `338.6 KB`           | `112.9 KB`       | `93.2 KB`          | `350.9 KB`          | `116.6 KB`      | `96.5 KB`         |
| ProseMirror | `361.8 KB`           | `119.0 KB`       | `101.0 KB`         | `361.8 KB`          | `119.0 KB`      | `101.0 KB`        |
| Tiptap      | `422.4 KB`           | `133.2 KB`       | `113.9 KB`         | `434.1 KB`          | `136.6 KB`      | `117.0 KB`        |

Interpretation:

- Lexical is the smallest of the top three in this harness.
- ProseMirror direct is close and keeps the most control.
- Tiptap is bigger, but the delta is small in Electron terms: about `20 KB`
  brotli over ProseMirror and about `21 KB` brotli over Lexical in the
  editor-only measurement.
- Installed Electron app size will barely move from these differences, but
  renderer parse/compile/runtime memory can still be affected.
- The real danger is not choosing Tiptap; it is letting the editor grow into a
  broad plugin/UI dependency graph with tables, embeds, AI, collaboration,
  syntax highlighters, emoji, drag UI, and media upload loaded at startup.

Bundle-size conclusion:

- Bundle size does not overturn the recommendation.
- Start with Tiptap, but curate extensions and lazy-load optional features.
- Keep ProseMirror direct as the performance/control fallback.
- Use Lexical as the smallest serious comparison spike.

## UI Framework Vs Vanilla

Research date: `2026-04-26`.

Assumption: Vault is a local-first Markdown desktop app. The important UI
performance targets are:

- first usable note quickly;
- low idle CPU while typing, reading, or sitting in the tray;
- stable long-session memory;
- responsive editor input, scrolling, search, and file-tree navigation;
- predictable plugin/customization model.

### Initial Take

Do not build the whole product in raw vanilla DOM just to avoid framework
overhead.

For an app like Vault, framework overhead is usually not the dominant battery
cost. The larger risks are:

- running too much code at startup;
- keeping too many renderer windows or workers alive;
- global state updates that repaint broad parts of the UI;
- long lists without virtualization;
- background indexing/sync work while idle;
- editor plugins that observe or transform every transaction;
- animations/timers/listeners that keep the renderer busy;
- loading optional panels, embeds, graph views, syntax highlighting, and AI UI
  before the user opens them.

Vanilla DOM can be faster in small isolated controls, but a full app with panes,
tabs, modals, settings, command palette, file tree, plugin surfaces, and a rich
editor tends to grow its own informal framework. That can become harder to
profile and maintain than using a small, well-understood UI layer.

### Clarifying Framework Costs

- React does not use Shadow DOM. Its main cost is the React runtime, component
  tree reconciliation, and mistakes that cause broad re-renders.
- Solid-style signals are not inherently expensive. Fine-grained reactivity can
  be very efficient, but it still needs discipline around subscriptions and
  long-lived computations.
- Svelte compiles components ahead of time and can be lean, but the ecosystem
  around editor UI templates and React-based libraries is thinner.
- Vue's proxy/reactivity model is also not automatically a battery problem; bad
  dependency graphs and eager watchers are.
- Shadow DOM is mainly a Web Components choice. It can help encapsulation, but
  it is not required for a fast app and can complicate styling, focus, and
  plugin integration.

The practical rule is:

> Keep the editor and hot paths transaction-driven and narrow; keep the app
> shell reactive enough to build quickly, but never let global state changes
> redraw the editor surface.

### What T3 Code Uses

T3 Code is not vanilla.

Current inspected stack:

- desktop shell: Electron;
- web app: React `19`, React DOM, Vite, Tailwind;
- routing/data/UI state: TanStack Router, TanStack Query, Zustand;
- UI/helpers: Base UI React, dnd-kit, lucide-react, auto-animate;
- editor/text surfaces: Lexical, React Markdown, xterm.

Sources checked:

- `https://github.com/pingdotgg/t3code`;
- `https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/web/package.json`;
- `https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/web/vite.config.ts`;
- `https://www.mintlify.com/pingdotgg/t3code/introduction`.

T3 Code's lesson is not "React is free." It is that a React app can still be
acceptable when:

- the product is interaction-heavy;
- the team benefits from ecosystem speed;
- build output is staged carefully;
- heavy work lives outside the renderer hot path.

But the earlier memory check showed T3 Code is not a low-memory gold standard;
it still had a substantial process tree and a backend process. Its framework
choice is not the main optimization trick.

### What VS Code Uses

VS Code is also not "vanilla" in the simple sense.

Current inspected stack:

- desktop shell: Electron;
- app code: TypeScript/JavaScript/CSS;
- workbench UI: custom VS Code framework built on browser DOM utilities,
  services, observables, lifecycle phases, and lazy contributions;
- editor core: Monaco-derived editor code from the VS Code source tree;
- terminal: xterm;
- native/WASM helpers: ripgrep, sqlite, oniguruma, tree-sitter WASM, native file
  watching, node-pty, and similar targeted packages.

VS Code does not depend on React, Vue, Svelte, or Solid in its main app
dependency list. It effectively built its own UI platform because it is a large
editor product with unusual requirements and a long-lived team.

Sources checked:

- `https://raw.githubusercontent.com/microsoft/vscode/main/package.json`;
- `https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/base/browser/dom.ts`;
- `https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/common/contributions.ts`;
- `https://github.com/microsoft/monaco-editor`;
- `https://www.electronjs.org/docs/latest/tutorial/performance`.

VS Code's lesson is not "use vanilla." It is:

- own the hot editor/workbench paths;
- defer non-critical contributions;
- use lifecycle phases;
- instantiate services lazily;
- measure startup, CPU, and memory continuously;
- isolate heavy work outside the UI thread.

Building a VS Code-style custom UI framework early would likely slow Vault down.
Copy the discipline, not the entire architecture.

### Recommendation For Vault

Use a UI library/framework, but keep it on a short leash.

Preferred near-term path:

1. Use React if we choose Tiptap Simple Editor as the first Markdown editor
   prototype.
2. Treat React as the app shell and control surface, not as the owner of every
   editor transaction.
3. Keep editor state inside the editor engine; only publish small derived state
   to the app, such as selection mode, active note id, dirty flag, and visible
   command availability.
4. Use selector-based state subscriptions so a note title change does not redraw
   the sidebar, editor, and command palette.
5. Virtualize large file lists, backlinks, search results, and graph-adjacent
   views.
6. Lazy-load optional surfaces: graph, plugin manager, settings panes, importers,
   AI panels, media viewers, syntax highlighters, and collaboration.
7. Use vanilla DOM only for tiny hot widgets if profiling shows framework
   overhead, not as a founding ideology.

Decision:

- Do not go full vanilla for the app shell.
- Do not adopt a heavy UI component framework that brings broad runtime and
  styling assumptions.
- Use lightweight/headless components where useful.
- Prefer React + curated Tiptap for the first serious prototype because it best
  matches the editor research and gives us the fastest path to product-quality
  behavior.
- Keep ProseMirror direct as the lower-level escape hatch if React/Tiptap
  boundaries become too costly.

Performance budget to enforce later:

- idle CPU should be effectively zero when no sync/indexing is active;
- typing should not trigger app-wide renders;
- opening one note should not load every feature;
- background indexing should run in a worker or native/WASM engine with explicit
  scheduling;
- memory benchmarks should compare release builds, not dev servers.

## Recommended Direction For Vault

Near-term:

1. Keep the app TypeScript-first.
2. Use staged desktop release packaging.
3. Bundle/minify production main/preload/renderer code.
4. Strip sourcemaps and dev-only files from release artifacts.
5. Avoid a permanent backend process.
6. Define startup phases before adding heavy services.
7. Keep benchmark scripts as the source of truth for memory numbers.

Medium-term:

1. Create shared app/core boundaries that both desktop and CLI can use.
2. Add a CLI without forcing a server/client app model.
3. Move vault indexing/search into a lazy worker.
4. Evaluate Rust/WASM for the index/search engine with benchmarks.
5. Add `vault --status`-style diagnostics for process, memory, startup, and
   indexing state.

Bias:

```text
TypeScript app shell
+ staged Electron release packaging
+ lazy services
+ Rust/WASM index/search core
+ direct CLI core usage
+ local app IPC only where live UI state is required
```

That path keeps Vault lightweight without making the architecture prematurely
distributed.
