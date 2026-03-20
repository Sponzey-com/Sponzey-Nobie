#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_DIR="$ROOT_DIR/pids"

GATEWAY_PID_FILE="$PIDS_DIR/nobie-gateway.pid"
WEBUI_PID_FILE="$PIDS_DIR/nobie-webui.pid"

stop_process() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name PID 파일이 없습니다."
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "$name PID 파일이 비어 있어 정리했습니다."
    return 0
  fi

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$pid_file"
    echo "$name 프로세스가 이미 종료되어 PID 파일만 정리했습니다."
    return 0
  fi

  echo "$name 종료 중... PID=$pid"

  if kill -0 -- "-$pid" >/dev/null 2>&1; then
    kill -TERM -- "-$pid" >/dev/null 2>&1 || true
  else
    kill -TERM "$pid" >/dev/null 2>&1 || true
  fi

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$pid_file"
      echo "$name 종료 완료"
      return 0
    fi
    sleep 0.5
  done

  echo "$name 정상 종료가 지연되어 강제 종료합니다."
  if kill -0 -- "-$pid" >/dev/null 2>&1; then
    kill -KILL -- "-$pid" >/dev/null 2>&1 || true
  else
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$pid_file"
  echo "$name 강제 종료 완료"
}

stop_process "WebUI" "$WEBUI_PID_FILE"
stop_process "Gateway" "$GATEWAY_PID_FILE"
