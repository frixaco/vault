# Desktop Refactor Plan

## Goal

Make the desktop app easy to re-architect by turning major implementation choices into swappable components. Examples include file watching, search, command palette behavior, file tree rendering, media handling, editor engine, and popup/link handling.

The key architectural rule: app code should depend on Vault-shaped contracts, not library-shaped contracts. Concrete tools like `@parcel/watcher`, `@pierre/trees`, FFF, Koffi, Electron menus, or Tiptap should live behind local adapters.

## Assumptions

- "Component" means a replaceable capability/module, not only a React component.
- The first pass should map boundaries and contracts before moving code.
- Swappability should not create abstraction for its own sake. Split where it isolates a real implementation choice or responsibility.
- Each refactor step should be one logical change and keep existing behavior intact.

## Current Coupling Hotspots

- `desktop/src/main.ts` currently mixes app startup, window creation, IPC route registration, media protocol handling, title search, popup windows, native menus, and service composition.
- `desktop/src/renderer.tsx` currently mixes app shell layout, workspace state, notes list sync, optimistic moves, `@pierre/trees`, Tiptap editor setup, keyboard shortcuts, tabs, command palette mounting, and search jump selection.
- `desktop/src/note-file-service.ts` is a good first extraction, but it still combines file IO, path policy, note registry, `@parcel/watcher`, event batching, and watch patch reduction.
- Search query parsing and title result formatting are duplicated across main/search code.

## Component Map

### Main Process

1. Desktop composition root
   - Owns app startup and chooses concrete implementations.
   - Should become the only place that wires implementations to interfaces.

2. Vault workspace config
   - Owns `notesRoot`, `.vault`, assets root, profile paths, future multi-vault support, and persisted workspace settings.

3. Window manager
   - Owns main window creation, titlebar behavior, preload path, dev reload, app activation, and close behavior.

4. IPC API / bridge contract
   - Owns typed route registration and preload exposure.
   - Should be split by domain: notes, search, media, window, tabs, settings.

5. Note repository
   - Owns read/list/move/resolve operations for notes.
   - Should not care which watcher or index implementation is used.

6. Note registry / index
   - Owns `NoteMeta`, the in-memory note map, sorted note lists, and tree patch application.

7. File watcher adapter
   - Wraps `@parcel/watcher` behind a local watcher interface.
   - Future replacements could be Node watch, polling, Watchman, Rust, or another library.

8. Watch event reducer
   - Owns batching, dedupe, file/directory event normalization, directory rescans, and `NotesTreePatchEvent` creation.

9. Vault path policy
   - Owns path normalization, traversal prevention, OS path conversion, note path conversion, and ignored directory behavior.
   - Should be shared by notes, media, migration, and search.

10. Search facade
    - Public contract for title search, content search, combined search, and selection tracking.
    - Should allow FFF, ripgrep, SQLite, Rust, JS index, or another implementation.

11. Title search provider
    - Owns title-only ranking and filtering.
    - Current code has both cached title search and FFF title search patterns; make this explicit.

12. Content search provider
    - Owns note body search and search jump metadata.
    - Should be independently swappable from title search.

13. Search query parser / result formatter
    - Owns `in:title`, `in:content`, `/query`, `#tag`, normalization, result IDs, display title/directory, and match formatting.

14. FFF native adapter
    - Owns Koffi structs, binary discovery, pointer decoding, native lifecycle, and FFF-specific query calls.
    - Should not leak FFF concepts into app code.

15. Media type registry
    - Owns media extensions, MIME types, and media kind detection.

16. Media resolver
    - Resolves note-relative media, absolute vault asset paths, `.vault/assets` paths, and rejects external paths.

17. Media protocol / stream server
    - Owns `vault-media://`, range requests, HEAD responses, content length, MIME response, and stream errors.

18. Attachment migration tool
    - Owns migration from legacy attachments to note asset directories.
    - Can later become one command in a broader vault maintenance system.

19. External link popup service
    - Owns popup window creation, allowed URL schemes, popup parent behavior, and external navigation policy.

20. Native menu adapter
    - Owns Electron `Menu` usage for tab context menus and future native menus.

### Renderer

21. Renderer API client
    - Wraps `window.vault` behind a typed client module.
    - UI should not know IPC channel names or global bridge details.

22. App shell
    - Owns top-level regions: titlebar drag area, editor pane, sidebar, tabbar, command palette, and settings modal.

23. Keyboard command router
    - Owns shortcuts like `mod+s`, `mod+p`, `mod+n`, `mod+w`, `mod+,`, and Escape.
    - Later can support user-customizable keybindings.

24. Workspace state controller
    - Owns notes list, errors/status, active tab, open note paths, note event subscriptions, optimistic move behavior, and refresh.

25. Tabs model
    - Owns tab state operations: create temp tab, create note tab, activate, close, close others, close right, replace temp with note, remap note paths.

26. Tabs UI
    - Owns bottom tabbar rendering and interaction.
    - Depends on tab state and callbacks only.

27. File tree feature
    - Split into a file tree controller and a view adapter.
    - Current concrete view adapter is `@pierre/trees`; future adapters could be custom React, virtualized tree, native sidebar, etc.

28. Command palette feature
    - Split search orchestration, keyboard selection, result rendering, and popup presentation.
    - Search backend and palette UI should be independently replaceable.

29. Editor engine adapter
    - Hides Tiptap setup behind a local markdown editor component/interface.
    - Owns editor creation, extensions, markdown load/save, and link click behavior.

30. Editor document sync
    - Owns setting editor content from active tab, avoiding update loops, applying external file updates, and scrolling/focus behavior.

31. Search jump highlighter
    - Converts `SearchJump` into an editor selection.
    - Should be editor-adapter-specific.

32. Editor media extensions
    - Owns Obsidian media syntax, markdown image behavior, `vault-media://` rendering, and media node serialization.

33. Editor embed extensions
    - Owns embed rendering in the editor.
    - Should use an embed provider registry rather than hardcoding provider parsing inside editor code.

34. Embed provider registry
    - Owns YouTube/X/etc. URL parsing and descriptor creation.
    - Providers should be addable/removable without changing editor internals.

35. Settings / command panel
    - Owns settings UI and action execution.
    - Should eventually render registered settings/actions instead of hardcoding migration forever.

36. Design system / theme tokens
    - Owns tokens, editor typography, sidebar styling, embeds, component motion, and reusable UI primitives.
    - Split after feature modules exist so CSS follows real boundaries.

## Suggested Refactor Order

1. Extract shared domain types and utilities.
   - Path policy.
   - Search query parsing.
   - Search result formatting.
   - Note display helpers.

2. Split `main.ts`.
   - Composition root.
   - Window manager.
   - IPC route modules.
   - Media service/protocol.
   - Popup and native menu services.

3. Split `NoteFileService`.
   - Note repository.
   - Note registry.
   - Watcher adapter.
   - Watch event reducer.

4. Introduce search provider interfaces.
   - Keep current behavior.
   - Make FFF one implementation.
   - Make cached title search one implementation.

5. Split `renderer.tsx`.
   - App shell.
   - Workspace controller hook.
   - File tree feature.
   - Markdown editor adapter.
   - Tabs UI.
   - Keyboard commands.

6. Split command palette.
   - Search orchestration.
   - Selection state.
   - Result list rendering.
   - Popup shell.

7. Split editor media/embed internals.
   - Tiptap adapter.
   - Media markdown extension.
   - Embed provider registry.
   - Popup/open-link dependency.

8. Consider a true implementation registry.
   - Only after the first split proves the contracts.
   - Could support runtime feature flags or build-time provider choices.

## Review Questions

- Which components should be runtime-swappable versus code-swappable?
- Should search be one provider or separate title/content providers?
- Should notes storage be strictly filesystem-based for now, or should the repository interface anticipate database-backed notes?
- Should the editor adapter expose markdown strings only, or a richer document/change model?
- Should the file tree model be app-owned, with third-party tree libraries as pure views?
- Should media/embed providers live in renderer only, main only, or a shared domain module?

## Review Round 1 Decisions

### Swappability Level

For now, components should be code-swappable, not runtime-swappable.

Runtime-swappable means the app can switch implementations while running or from config/plugins/feature flags without changing app code. For example, a settings value could choose between a Parcel watcher, Watchman watcher, or polling watcher.

Code-swappable means the app has clean local interfaces, but the composition root chooses one implementation at build/runtime startup. Replacing a library is easy, but still requires changing the implementation binding and shipping a new app build.

Prefer code-swappable first. Runtime swappability can come later if there is a real plugin/settings use case.

### Search Shape

Use one search service/facade that composes separate providers:

- `TitleSearchProvider`
- `ContentSearchProvider`
- optional future `BestMatchProvider` or `CommandProvider`

This keeps the UI flexible. The command palette can show title and content together, separately, or in different tabs/sections without caring whether both come from the same engine. The implementation can still use one backend if that is best, but the app contract should not require title and content search to be coupled.

### Notes Storage And Future Sync

Notes are strictly local filesystem-based for now.

The architecture should still be ready for future sync API support by treating file changes as one source of note events, not the only source. Local user edits, filesystem watcher updates, and future remote sync updates should all flow through the same note mutation/event path.

Use a light single-writer note mutation coordinator, not a broad sync abstraction yet.

The current watcher batching is good enough for filesystem noise, but future user/API concurrency needs one small place that serializes note mutations and dedupes watcher echoes. Avoid CRDTs, operation logs, background job frameworks, or generalized event buses until sync actually exists.

Prefer a coordinator that can:

- apply local user operations,
- apply filesystem watcher patches,
- apply future sync/API patches,
- refresh open notes,
- prevent duplicate/conflicting event handling where possible.

The repository can stay filesystem-backed, but event metadata should eventually be able to distinguish source, revision/hash/mtime, and operation identity. A practical first version can keep the existing watcher debounce and add a narrow per-note operation queue around writes/moves/deletes.

### Persistence

Persist:

- open tabs,
- active/selected note,
- sidebar expansion state,
- per-note scroll position.

Do not persist command palette history for now.

Persistence should be a small workspace state store, not mixed into React component internals. It can start local-only and later move into workspace/profile config if needed.

### Editor Writes And Conflicts

Write editor changes on every change with debounce for now.

Autosave debounce target: 1 second after typing stops.

Reliable automatic merge is only practical in constrained cases. A future merge can be safe when Vault knows:

- the base content originally loaded into the editor,
- the current local edited content,
- the new external disk/sync content,
- enough metadata to know which external change caused the update.

Without that base/local/remote shape, automatic merge can corrupt notes. Initial conflict policy should protect user text first:

- if the open note has no local edits, apply external updates automatically;
- if local edits exist and an external update arrives, do not blindly overwrite;
- surface a conflict state and preserve both versions until a better merge/review UI exists.

The current implementation can stay simpler while save support is basic, but the editor/write architecture should leave room for this.

### Editor Adapter Meaning

An editor adapter is the local boundary around Tiptap.

The rest of the app should not know Tiptap commands, extension setup, ProseMirror positions, or markdown parsing details. It should talk to a Vault-shaped editor API such as:

- set markdown content,
- read markdown content,
- listen for changes,
- focus,
- scroll to top,
- select a search jump,
- expose media/embed editing actions.

This makes it possible to replace Tiptap later with another editor engine, or to change the Tiptap internals without rewriting workspace state, tabs, search, file tree, or command palette code.

Based on `RESEARCH.md`, keep Tiptap as the first serious editor implementation, ProseMirror direct as the escape hatch, and Lexical as the comparison spike if Tiptap feels too heavy or awkward. The adapter is what makes that swap realistic.

### App-Owned File Tree Model

Research result: do not treat `@pierre/trees` as a pure/dumb renderer.

`@pierre/trees` is path-first and exposes both a model and renderer. It handles virtualization, focus, selection, expansion, search, rename, drag/drop, mutation methods, and context-menu composition. Its public API is keyed by canonical paths, which fits Vault well.

Sources checked: installed `@pierre/trees@1.0.0-beta.3` README/types/source in `node_modules`, plus the public docs at `https://trees.software/`.

The target boundary should be:

- Vault owns source-of-truth note paths and metadata.
- Vault owns path policy, move/rename permissions, persistence, optimistic rollback, and note-opening behavior.
- The tree adapter owns `@pierre/trees` setup and transient UI interaction state: focus, keyboard navigation, expansion, internal drag session, inline rename input, and virtualization.
- `@pierre/trees` callbacks emit domain operations back to Vault, such as open note, move note, rename note/folder, create note, delete note, and context menu action.

This is still code-swappable because the rest of the renderer depends on a Vault file-tree feature boundary, not directly on `@pierre/trees`. But the adapter should preserve the library's useful behavior instead of reimplementing drag/drop, rename, and accessibility early.

Practical first boundary:

- `FileTreeFeature` or `NotesSidebar` owns app-level props and callbacks.
- `PierreFileTreeAdapter` owns `useFileTree`, `<FileTree>`, injected CSS, density, context-menu composition, drag/drop config, and rename config.
- Keep selection/expansion inside Pierre initially unless Vault needs persistent sidebar state later.
- Use `resetPaths` for external note list refreshes first; only optimize to incremental `add/remove/move/batch` if profiling or UX demands it.
- Do not add new tree operations in the refactor. Preserve the current move/rename/open behavior and current lack of create/delete/new-folder tree operations.

### Media Editing Direction

Media and embeds should be represented as structured editor nodes with explicit attributes, not as raw markdown strings during editing.

Concrete near-term media editing features:

- image/video rectangle resize inside the editor,
- drag-to-align left/right/center with magnetic attachment,
- edit URL/path,
- delete from the note and delete the actual media file.

Media deletion must be reversible. The exact UX and storage mechanism are deferred, but do not implement permanent one-way deletion as the default behavior.

Avoid Obsidian-style controls that cause content shifting or noisy inline UI. Prefer a clean left-gutter media control rail shown for the selected/hovered media block:

- edit URL/path button,
- align left button,
- align center button,
- align right button,
- delete button.

Needed attributes for image/video nodes likely include:

- source/path/url,
- media kind,
- markdown style/raw target for round-tripping,
- width/height or width preset,
- aspect ratio,
- alignment,
- caption/alt/title.

Use editor node views for resizing, URL/path editing, and alignment. The node view should own the drag handles, selected-state chrome, URL popover, and magnetic alignment interaction. Markdown serialization should convert the structured node back to the preferred markdown representation. If markdown cannot represent visual settings cleanly, use a stable Vault-specific convention rather than hiding state in ad hoc text parsing.

Prioritize best UX over Obsidian compatibility for media layout metadata. Keep markdown readable where possible, but do not accept layout jank or hostile editing behavior just to mimic Obsidian syntax.

### Search Index Freshness

Search index updates can run whenever cheap.

Initial approach: update/debounce search indexing from note/file events without blocking visible tree updates or editor typing. If the current provider makes updates cheap, keep it near-immediate. If a future provider is expensive, debounce/lazy-index separately from the visible note registry.
