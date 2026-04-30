# AGENTS.md for Vault monorepo project

## General Rules

- No fallbacks, no MVP/v1/v2 implementations. There is only one version and it's the final one. It either works or it does not.
- Do not be afraid to refactor existing code when implementing some feature/fix, if it will result in cleaner, more robust, more maintainable and simpler code.
- Do NOT use margins for styling. Use only padding and layout changes to achieve same result.
- The codebase should stay "code swappable", meaning I should be able to change any core component if I want.

## Goal

Clean, minimal, beautiful Obsidian (the note-taking, personal knowledge management app) killer. The one and only one.

## Project Shape

- Root workspace uses `pnpm@11.0.0`.
- Packages live directly at the repo root:
  - `desktop/` - Electron desktop app.
  - `mobile/` - Expo mobile app.
  - `sync-api/` - sync API.
- `crates/vault-shared` is the single Rust crate reused by desktop, Android, and iOS.

## Workspace Scripts

- `pnpm android` runs the Expo Android app via `@vault/mobile`.
- `pnpm ios` runs the Expo iOS app via `@vault/mobile`.
- `pnpm build-native` builds the shared Rust desktop binary.
- `pnpm build-vault-shared` runs [scripts/build-vault-shared.mjs](scripts/build-vault-shared.mjs), which builds `crates/vault-shared` and stages the desktop `vault-shared` binary under `desktop/build/vault-shared/bin/`.
- `pnpm build-desktop` builds the desktop app code and shared native binary, but does not create release artifacts.
- `pnpm dev-desktop` starts the Electron app.
- `pnpm dev-mobile` starts the Expo app.
- `pnpm dev-sync-api` starts the sync API.
- `pnpm dist-desktop-*` scripts package desktop release artifacts under `desktop/dist/`.
- `pnpm fmt` checks formatting.
- `pnpm fmt-fix` writes formatting fixes.
- `pnpm lint` runs oxlint.
- `pnpm typecheck` runs script and package typechecks.

## Shared Rust And Native Modules

- The shared Rust package is `vault-shared-ffi`.
- The Rust library crate name is `vault_shared_ffi`.
- The desktop binary name is `vault-shared`.
- Android and iOS must build from `crates/vault-shared`.
- Android packages `libvault_shared_ffi.so` through `mobile/modules/vault-shared/android/build.gradle`.
- iOS links `libvault_shared_ffi.a` through `mobile/modules/vault-shared/ios/VaultShared.podspec`.
- The Expo native module name is `VaultShared`.
- Add future shared native features to `VaultShared` rather than creating one native binary per feature.

## Desktop Release Builds

- Desktop release packaging uses `electron-builder`, not Electron Forge.
- The desktop release scripts are defined in `desktop/package.json`.
- Root desktop release scripts forward to `@vault/desktop`.
- Mac release artifacts are written under `desktop/dist/`.
- Desktop release builds run `pnpm build-vault-shared` first and package `desktop/build/vault-shared/bin/vault-shared` as an extra resource.
- `pnpm build-desktop` is a build step only. It writes `desktop/dist-electron/`, `desktop/dist-renderer/`, and `desktop/build/vault-shared/bin/`, but does not create `.app`, `.dmg`, `.zip`, or installer artifacts.
- Apple Silicon macOS release build:

```sh
APPLE_KEYCHAIN_PROFILE=vault-notary pnpm dist-desktop-mac-arm64
```

- Unsigned local-only macOS build:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist-desktop-mac-arm64
```

- Signed/notarized builds are for sharing or release.
- Unsigned builds are only for local packaging checks.
- Do not commit `desktop/dist/` release artifacts.
- Future desktop release packaging should use a staged app directory, following the useful part of T3 Code's approach: build desktop/runtime artifacts first, copy only the build outputs and required resources into the stage, write a minimal package manifest there, install production-only runtime dependencies, then run `electron-builder` from that stage.
- Do not package the workspace source tree, repo root `node_modules`, tests, sourcemaps, or dev-only files into desktop releases unless explicitly needed for a production feature.
- A future CLI does not require a bundled always-on server/client architecture. Prefer shared core libraries used by both desktop and CLI; add local app IPC only for commands that need live UI state.

## Desktop Memory Metrics

- Release memory measurements are automated by:

```sh
pnpm measure-desktop-mac
```

- The script is [scripts/desktop-release-memory.ts](scripts/desktop-release-memory.ts).
- Metrics history is committed in [metrics/desktop-memory-runs.jsonl](metrics/desktop-memory-runs.jsonl).
- The script builds the signed Apple Silicon release, installs `Vault.app`, launches it, samples the full Electron process tree RSS, appends a JSONL metric, and prints the delta from the previous run.
- Do not invent or estimate memory numbers. Run the script and report its output.
- Do not run the measurement script unless the user asks for a build/install/measurement run.
- Useful variants:

```sh
pnpm measure-desktop-mac -- --unsigned
pnpm measure-desktop-mac -- --skip-build
pnpm measure-desktop-mac -- --keep-running
pnpm measure-desktop-mac -- --install-path ~/Applications/Vault.app
```
