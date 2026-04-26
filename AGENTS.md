# AGENTS.md

## Project Shape

- Root workspace uses `pnpm@11.0.0-rc.5`.
- Packages live directly at the repo root:
  - `desktop/` - Electron desktop app.
  - `mobile/` - Expo mobile app.
  - `sync-api/` - sync API.
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

- `pnpm dev-desktop` starts the Electron app.
- `pnpm dev-mobile` starts the Expo app.
- `pnpm dev-sync-api` starts the sync API.
- `pnpm fmt` checks formatting.
- `pnpm fmt-fix` writes formatting fixes.
- `pnpm lint` runs oxlint.
- `pnpm typecheck` runs script and package typechecks.

## Desktop Release Builds

- Desktop release packaging uses `electron-builder`, not Electron Forge.
- The desktop release scripts are defined in `desktop/package.json`.
- Root desktop release scripts forward to `@vault/desktop`.
- Mac release artifacts are written under `desktop/dist/`.
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
