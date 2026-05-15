#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/pids/yeonjang-linux.pid"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "이 스크립트는 Linux 전용입니다."
  exit 1
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "Yeonjang Linux PID 파일이 없습니다."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"

if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  echo "Yeonjang Linux PID 파일이 비어 있어 정리했습니다."
  exit 0
fi

if ! kill -0 "$PID" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "Yeonjang Linux 프로세스가 이미 종료되어 PID 파일만 정리했습니다."
  exit 0
fi

echo "Yeonjang Linux GUI를 종료합니다. PID=$PID"
kill "$PID" >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    rm -f "$PID_FILE"
    echo "Yeonjang Linux GUI 종료 완료"
    exit 0
  fi
  sleep 0.5
done

echo "Yeonjang Linux GUI가 남아 있어 강제 종료합니다."
kill -9 "$PID" >/dev/null 2>&1 || true
rm -f "$PID_FILE"
echo "Yeonjang Linux GUI 강제 종료 완료"
