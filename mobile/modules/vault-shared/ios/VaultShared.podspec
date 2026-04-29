Pod::Spec.new do |s|
  s.name           = 'VaultShared'
  s.version        = '1.0.0'
  s.summary        = 'Vault shared native module'
  s.description    = 'Expo module bridge for shared Rust features.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.preserve_paths = '../../../../crates/vault-shared/Cargo.toml', '../../../../crates/vault-shared/Cargo.lock', '../../../../crates/vault-shared/src/**/*'
  s.source_files = '*.{h,m,mm,swift,hpp,cpp}'
  s.frameworks = 'Security', 'SystemConfiguration'
  s.libraries = 'c++', 'z', 'iconv'

  s.script_phase = {
    :name => 'Build VaultShared Rust',
    :execution_position => :before_compile,
    :input_files => [
      '${PODS_TARGET_SRCROOT}/VaultSharedModule.swift',
      '${PODS_TARGET_SRCROOT}/../../../../crates/vault-shared/Cargo.toml',
      '${PODS_TARGET_SRCROOT}/../../../../crates/vault-shared/Cargo.lock',
      '${PODS_TARGET_SRCROOT}/../../../../crates/vault-shared/src'
    ],
    :output_files => [
      '${PODS_CONFIGURATION_BUILD_DIR}/VaultShared/libvault_shared_ffi.a'
    ],
    :script => <<-SCRIPT
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"

RUST_ROOT="${PODS_TARGET_SRCROOT}/../../../../crates/vault-shared"
OUT_DIR="${PODS_CONFIGURATION_BUILD_DIR}/VaultShared"
LIB_NAME="libvault_shared_ffi.a"

mkdir -p "$OUT_DIR"

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: Cargo is required to build VaultShared Rust." >&2
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "error: rustup is required to verify installed VaultShared Rust targets." >&2
  exit 1
fi

ensure_target_installed() {
  local target="$1"
  if ! rustup target list --installed | grep -qx "$target"; then
    echo "error: missing Rust target '$target'. Run: rustup target add $target" >&2
    exit 1
  fi
}

build_target() {
  local target="$1"
  ensure_target_installed "$target"
  export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-15.1}"
  cargo build --manifest-path "$RUST_ROOT/Cargo.toml" --release --target "$target"
}

copy_or_lipo() {
  rm -f "$OUT_DIR/$LIB_NAME"
  if [ "$#" -eq 1 ]; then
    cp "$1" "$OUT_DIR/$LIB_NAME"
  else
    lipo -create "$@" -output "$OUT_DIR/$LIB_NAME"
  fi
}

case "${PLATFORM_NAME}" in
  iphoneos)
    build_target "aarch64-apple-ios"
    copy_or_lipo "$RUST_ROOT/target/aarch64-apple-ios/release/$LIB_NAME"
    ;;
  iphonesimulator)
    libs=()
    for arch in ${ARCHS}; do
      case "$arch" in
        arm64)
          build_target "aarch64-apple-ios-sim"
          libs+=("$RUST_ROOT/target/aarch64-apple-ios-sim/release/$LIB_NAME")
          ;;
        x86_64)
          build_target "x86_64-apple-ios"
          libs+=("$RUST_ROOT/target/x86_64-apple-ios/release/$LIB_NAME")
          ;;
      esac
    done
    if [ "${#libs[@]}" -eq 0 ]; then
      echo "Unsupported simulator architecture set for VaultShared Rust: ${ARCHS}" >&2
      exit 1
    fi
    copy_or_lipo "${libs[@]}"
    ;;
  *)
    echo "Unsupported platform for VaultShared Rust build: ${PLATFORM_NAME}"
    exit 1
    ;;
esac
    SCRIPT
  }

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'LIBRARY_SEARCH_PATHS' => '$(inherited) "$(PODS_CONFIGURATION_BUILD_DIR)/VaultShared"',
    'OTHER_LDFLAGS' => '$(inherited) -lvault_shared_ffi',
  }
  s.user_target_xcconfig = {
    'LIBRARY_SEARCH_PATHS' => '$(inherited) "$(PODS_CONFIGURATION_BUILD_DIR)/VaultShared"',
    'OTHER_LDFLAGS' => '$(inherited) -lvault_shared_ffi',
  }
end
