# Vault - clean, modern, beautiful Obsidian killer

TODO:
- [ ] Resize image like in Notion
- [ ] Alignment rulers to move around images
- [ ] Make attachment migration AST-aware so image syntax inside code blocks is not rewritten

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
