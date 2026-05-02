#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPERIMENTS_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
NATIVE_MARKDOWN_DIR="$EXPERIMENTS_DIR/native-markdown"
GENERATED_DIR="$PROJECT_DIR/NativeMarkdownGenerated"
APP_DIR="$PROJECT_DIR/vault-mac"

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

case "$(uname -m)" in
  arm64|aarch64)
    RUST_TARGET="aarch64-apple-darwin"
    ;;
  x86_64)
    RUST_TARGET="x86_64-apple-darwin"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if ! command -v cargo >/dev/null 2>&1; then
  echo "Cargo is required to build the native Markdown bridge." >&2
  echo "Looked in PATH: $PATH" >&2
  echo "If Rust is installed somewhere else, add it to scripts/sync-native-markdown.sh." >&2
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required to verify the native Markdown Rust target." >&2
  echo "Looked in PATH: $PATH" >&2
  exit 1
fi

if ! rustup target list --installed | grep -qx "$RUST_TARGET"; then
  echo "Missing Rust target '$RUST_TARGET'. Run: rustup target add $RUST_TARGET" >&2
  exit 1
fi

mkdir -p "$GENERATED_DIR/include" "$GENERATED_DIR/lib"

cd "$NATIVE_MARKDOWN_DIR"

echo "==> Building native-markdown-ffi host dylib for UniFFI"
cargo build -p native-markdown-ffi

echo "==> Generating Swift bindings"
cargo run -p native-markdown-uniffi-bindgen -- generate \
  --library target/debug/libnative_markdown_ffi.dylib \
  --language swift \
  --out-dir "$GENERATED_DIR/include"

cp "$GENERATED_DIR/include/native_markdown_ffiFFI.modulemap" "$GENERATED_DIR/include/module.modulemap"
cp "$GENERATED_DIR/include/native_markdown_ffi.swift" "$APP_DIR/GeneratedNativeMarkdown.swift"

echo "==> Building native-markdown-ffi static library for $RUST_TARGET"
cargo rustc -p native-markdown-ffi --target "$RUST_TARGET" --crate-type staticlib
cp "target/$RUST_TARGET/debug/libnative_markdown_ffi.a" "$GENERATED_DIR/lib/libnative_markdown_ffi.a"
