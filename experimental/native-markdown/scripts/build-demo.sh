#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPERIMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_DIR="$EXPERIMENT_DIR/macos-demo"
GENERATED_DIR="$DEMO_DIR/Generated"
BUILD_DIR="$DEMO_DIR/Build"

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

cd "$EXPERIMENT_DIR"

if ! rustup target list --installed | grep -qx "$RUST_TARGET"; then
  echo "Missing Rust target '$RUST_TARGET'. Run: rustup target add $RUST_TARGET" >&2
  exit 1
fi

echo "==> Testing Rust parser"
cargo test -p native-markdown-ffi

echo "==> Building host dylib for UniFFI metadata"
cargo build -p native-markdown-ffi

echo "==> Generating Swift bindings"
mkdir -p "$GENERATED_DIR"
cargo run -p native-markdown-uniffi-bindgen -- generate \
  --library target/debug/libnative_markdown_ffi.dylib \
  --language swift \
  --out-dir "$GENERATED_DIR"
cp "$GENERATED_DIR/native_markdown_ffiFFI.modulemap" "$GENERATED_DIR/module.modulemap"
cp "$GENERATED_DIR/native_markdown_ffi.swift" "$DEMO_DIR/Sources/NativeMarkdownFFI/native_markdown_ffi.swift"

echo "==> Building Rust static library for $RUST_TARGET"
mkdir -p "$BUILD_DIR"
cargo rustc -p native-markdown-ffi --target "$RUST_TARGET" --crate-type staticlib
cp "target/$RUST_TARGET/debug/libnative_markdown_ffi.a" "$BUILD_DIR/libnative_markdown_ffi.a"

echo "==> Building SwiftUI demo and probe"
cd "$DEMO_DIR"
swift build

echo "==> Running bridge probe"
swift run NativeMarkdownProbe

echo "==> Done"
echo "SwiftUI demo executable: $DEMO_DIR/.build/debug/NativeMarkdownDemo"
