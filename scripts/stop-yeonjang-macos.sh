#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/pids/yeonjang-macos.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Yeonjang PID 파일이 없습니다."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"

if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  echo "Yeonjang PID 파일이 비어 있어 정리했습니다."
  exit 0
fi

if ! kill -0 "$PID" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "Yeonjang 프로세스가 이미 종료되어 PID 파일만 정리했습니다."
  exit 0
fi

echo "Yeonjang GUI 종료 중... PID=$PID"
kill "$PID" >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    rm -f "$PID_FILE"
    echo "Yeonjang GUI 종료 완료"
    exit 0
  fi
  sleep 0.25
done

echo "Yeonjang GUI가 남아 있어 강제 종료합니다."
kill -9 "$PID" >/dev/null 2>&1 || true
rm -f "$PID_FILE"
echo "Yeonjang GUI 강제 종료 완료"
