#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_DIR="$ROOT_DIR/pids"
LOGS_DIR="$ROOT_DIR/logs"
PID_FILE="$PIDS_DIR/yeonjang-macos.pid"
LOG_FILE="$LOGS_DIR/yeonjang-macos.log"
PROFILE="${YEONJANG_PROFILE:-release}"
TARGET_TRIPLE="${YEONJANG_TARGET_TRIPLE:-}"
BINARY_NAME="nobie-yeonjang"
APP_NAME="Yeonjang"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "이 스크립트는 macOS 전용입니다."
  exit 1
fi

mkdir -p "$PIDS_DIR" "$LOGS_DIR"

cleanup_stale_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$PID_FILE"
  fi
}

stop_existing() {
  cleanup_stale_pid
  if [[ ! -f "$PID_FILE" ]]; then
    return
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  echo "기존 Yeonjang GUI를 종료합니다. PID=$pid"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$PID_FILE"
      return
    fi
    sleep 0.25
  done

  echo "기존 Yeonjang GUI가 남아 있어 강제 종료합니다."
  kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
}

resolve_binary_path() {
  local base_dir="$ROOT_DIR/Yeonjang/target"
  local app_binary
  if [[ -n "$TARGET_TRIPLE" ]]; then
    app_binary="$base_dir/$TARGET_TRIPLE/$PROFILE/$APP_NAME.app/Contents/MacOS/$APP_NAME"
    if [[ -x "$app_binary" ]]; then
      echo "$app_binary"
      return
    fi
    echo "$base_dir/$TARGET_TRIPLE/$PROFILE/$BINARY_NAME"
  else
    app_binary="$base_dir/$PROFILE/$APP_NAME.app/Contents/MacOS/$APP_NAME"
    if [[ -x "$app_binary" ]]; then
      echo "$app_binary"
      return
    fi
    echo "$base_dir/$PROFILE/$BINARY_NAME"
  fi
}

echo "Yeonjang macOS GUI 빌드를 확인합니다..."
bash "$ROOT_DIR/scripts/build-yeonjang-macos.sh"

BINARY_PATH="$(resolve_binary_path)"
if [[ ! -x "$BINARY_PATH" ]]; then
  echo "Yeonjang 실행 파일을 찾을 수 없습니다: $BINARY_PATH"
  exit 1
fi

stop_existing
: > "$LOG_FILE"

echo "Yeonjang GUI를 시작합니다..."
(
  cd "$ROOT_DIR"
  exec nohup "$BINARY_PATH" </dev/null
) >>"$LOG_FILE" 2>&1 &

echo "$!" > "$PID_FILE"

sleep 2

if ! kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
  echo "Yeonjang GUI가 시작 중 종료되었습니다."
  echo "로그:"
  tail -n 80 "$LOG_FILE" || true
  rm -f "$PID_FILE"
  exit 1
fi

echo "Yeonjang GUI 실행 완료"
echo "  PID  : $(cat "$PID_FILE")"
echo "  Log  : $LOG_FILE"
echo "  Stop : bash scripts/stop-yeonjang-macos.sh"
