#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
YEONJANG_DIR="$ROOT_DIR/Yeonjang"
MANIFEST_PATH="$YEONJANG_DIR/Cargo.toml"
BINARY_NAME="nobie-yeonjang"
PROFILE="${YEONJANG_PROFILE:-release}"
TARGET_TRIPLE="${YEONJANG_TARGET_TRIPLE:-}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "이 스크립트는 Linux 전용입니다."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo 를 찾을 수 없습니다. Rust 도구체인을 먼저 설치하세요."
  exit 1
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Yeonjang Cargo.toml 을 찾을 수 없습니다: $MANIFEST_PATH"
  exit 1
fi

BUILD_CMD=(cargo build --manifest-path "$MANIFEST_PATH")
if [[ "$PROFILE" == "release" ]]; then
  BUILD_CMD+=(--release)
fi
if [[ -n "$TARGET_TRIPLE" ]]; then
  BUILD_CMD+=(--target "$TARGET_TRIPLE")
fi

echo "Yeonjang Linux 바이너리를 빌드합니다..."
(
  cd "$ROOT_DIR"
  "${BUILD_CMD[@]}"
)

if [[ -n "$TARGET_TRIPLE" ]]; then
  BINARY_PATH="$YEONJANG_DIR/target/$TARGET_TRIPLE/$PROFILE/$BINARY_NAME"
else
  BINARY_PATH="$YEONJANG_DIR/target/$PROFILE/$BINARY_NAME"
fi

if [[ ! -x "$BINARY_PATH" ]]; then
  echo "빌드는 끝났지만 실행 파일을 찾지 못했습니다: $BINARY_PATH"
  exit 1
fi

echo "빌드 완료:"
echo "  Binary : $BINARY_PATH"
