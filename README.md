# Vault - clean, modern, beautiful Obsidian killer

TODO:

- [x] Editor media: resize image/video rectangles inline
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
- [ ] Horizontal swipe on Android goes back

## Packages

- `desktop/` is the Electron desktop app.
- `mobile/` is the Expo mobile app.
- `sync-api/` is the local sync API.
- `crates/vault-shared/` is the shared Rust crate used by desktop, Android, and iOS.

## Native Architecture

- `crates/vault-shared` is the single Rust source of truth.
- The Rust package is `vault-shared-ffi`.
- The native library artifact is `libvault_shared_ffi`.
- The desktop CLI artifact is `vault-shared`.
- Android builds the shared Rust crate from the Expo module Gradle build and packages `libvault_shared_ffi.so`.
- iOS builds the shared Rust crate from the `VaultShared` podspec and links `libvault_shared_ffi.a`.
- Desktop builds and stages the `vault-shared` binary under `desktop/build/vault-shared/bin/`.
- The Expo native module is `mobile/modules/vault-shared` and exposes `VaultShared`.

## Scripts

- `pnpm android` runs the Expo Android app.
- `pnpm ios` runs the Expo iOS app.
- `pnpm build-native` builds the shared Rust desktop binary.
- `pnpm build-vault-shared` is the underlying Rust build/stage script.
- `pnpm build-desktop` builds the Electron app code and shared native binary, but does not package a `.app`, `.dmg`, or installer.
- `pnpm dev-desktop` starts the Electron app.
- `pnpm dev-mobile` starts the Expo app.
- `pnpm dev-sync-api` starts the sync API on port `4000`.
- `pnpm dist-desktop-mac-arm64` creates macOS release artifacts under `desktop/dist/`.
- `pnpm dist-desktop-linux` creates Linux release artifacts under `desktop/dist/`.
- `pnpm dist-desktop-win-x64` creates Windows release artifacts under `desktop/dist/`.
- `pnpm fmt` checks formatting.
- `pnpm fmt-fix` writes formatting fixes.
- `pnpm lint` runs oxlint.
- `pnpm typecheck` runs package typechecks.
