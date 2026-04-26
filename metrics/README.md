# Desktop Release Metrics

`desktop-memory-runs.jsonl` stores one JSON object per macOS release memory run.

Generate a new run with:

```sh
APPLE_KEYCHAIN_PROFILE=vault-notary pnpm measure-desktop-mac
```

The script builds the Apple Silicon release app, installs it, launches it, samples
the Electron process tree memory, appends a JSONL record, and prints the delta
against the previous run.
