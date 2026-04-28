# Vault - clean, modern, beautiful Obsidian killer

TODO:

- [ ] Editor media: resize image/video rectangles inline
- [ ] Editor media: left/center/right magnetic alignment with clean gutter controls
- [ ] Editor media: edit media URL/path from the gutter control rail
- [ ] Editor media: reversible delete from note and media file
- [ ] Preserve workspace state: tabs, active note, sidebar expansion, and per-note scroll position
- [ ] Conflict protection for external disk/sync updates while a note has local edits
- [ ] Add a narrow note mutation queue/coordinator for writes, moves, deletes, watcher echoes, and future sync updates
- [ ] Split editor behind a swappable editor adapter boundary
- [ ] Split command palette search orchestration from palette UI
- [ ] Make attachment migration AST-aware so image syntax inside code blocks is not rewritten
- [ ] File locking for external access by AI + explore in app AI integration
- [ ] CMD+Z behavior

## Packages

- `desktop/` is the Electron desktop app.
- `mobile/` is the Expo mobile app.
- `sync-api/` is the local sync API.

## Scripts

- `pnpm dev-desktop` starts the Electron app.
- `pnpm dev-mobile` starts the Expo app.
- `pnpm dev-sync-api` starts the sync API on port `4000`.
- `pnpm fmt` checks formatting.
- `pnpm fmt-fix` writes formatting fixes.
- `pnpm lint` runs oxlint.
- `pnpm typecheck` runs package typechecks.
