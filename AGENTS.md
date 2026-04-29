# AGENTS.md

## Goal

Clean, minimal, beautiful Obsidian killer. Best note-taking app.

## Instruction Priority

- Follow the user's instructions strictly and literally.
- If the user gives an exact set of actions, do only those actions.
- Do not add extra safety checks, formatting, tests, commits, or other workflow steps unless the user asks for them or they are strictly required to complete the exact requested action.
- When the user says "don't do anything else", treat that as a hard boundary.
- If an instruction is ambiguous, ask one concise clarifying question instead of guessing and doing extra work.

## Project Shape

- Root workspace uses `pnpm@11.0.0`.
- Packages live directly at the repo root:
  - `desktop/` - Electron desktop app.
  - `mobile/` - Expo mobile app.
  - `sync-api/` - sync API.
- Shared Rust code lives at `crates/vault-shared/`.
- `crates/vault-shared` is the single Rust crate reused by desktop, Android, and iOS.
- Keep desktop app code and desktop release configuration inside `desktop/`.
- Root scripts should only orchestrate workspace packages or repo-level tooling.

## Style And Tooling

- Use dash-separated script names, never colon-separated names.
- Use `oxfmt` for formatting and `oxlint` for linting.
- Do not add ESLint or Prettier.
- Use `@typescript/native-preview` and `tsgo` for TypeScript checks.
- Keep the repo fully ESM unless a tool explicitly requires another format.
- Prefer current official docs before making version-sensitive setup changes.

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
- Do not reintroduce a separate `crates/files` crate or a Rust crate nested under `mobile/modules/vault-shared/rust`.
- Android and iOS must build from `crates/vault-shared`.
- Android packages `libvault_shared_ffi.so` through `mobile/modules/vault-shared/android/build.gradle`.
- iOS links `libvault_shared_ffi.a` through `mobile/modules/vault-shared/ios/VaultShared.podspec`.
- The Expo native module name is `VaultShared`.
- Keep search-specific TypeScript API compatibility in `mobile/modules/vault-shared`, but add future shared native features to the shared module rather than creating one native binary per feature.

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

## Mobile

- Mobile is an Expo app created from:

```sh
pnpm create expo-app mobile --template default@sdk-55
```

- Use Expo commands for Expo dependency alignment.
- Prefer `expo install --check` and `expo install --fix` for SDK-correct mobile dependency checks.
- Do not manually replace Expo-managed dependency versions with npm latest unless the user explicitly asks for that tradeoff.

## Dependency And Build Script Policy

- Check current package versions before adding new dependencies.
- Keep `pnpm-workspace.yaml` `allowBuilds` accurate when dependencies need install-time scripts.
- After dependency changes, verify:

```sh
pnpm install --frozen-lockfile
pnpm fmt
pnpm lint
pnpm typecheck
```

## Git And Generated Files

- Do not revert user changes unless explicitly asked.
- Ignore unrelated dirty files.
- Do not commit generated build output such as `desktop/dist/`, `dist/`, `out/`, `node_modules/`, or Expo cache output.
- The metrics JSONL file is intentionally committed.

## Pre-Handoff Checklist

- `pnpm fmt` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm install --frozen-lockfile` passes after dependency changes.
- No unintended unrelated changes are included.
