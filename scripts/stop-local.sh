#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_DIR="$ROOT_DIR/pids"

GATEWAY_PID_FILE="$PIDS_DIR/nobie-gateway.pid"
WEBUI_PID_FILE="$PIDS_DIR/nobie-webui.pid"

GATEWAY_PORT="${NOBIE_GATEWAY_PORT:-18888}"
WEBUI_PORT="${NOBIE_WEBUI_PORT:-5173}"

read_pid() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] && cat "$pid_file" 2>/dev/null || true
}

pid_alive() {
  local pid="$1"
  [[ -z "$pid" ]] && return 1
  kill -0 "$pid" >/dev/null 2>&1 && return 0
  if command -v lsof >/dev/null 2>&1 && lsof -p "$pid" >/dev/null 2>&1; then
    return 0
  fi
  if ps -p "$pid" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

pid_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

pid_cwd() {
  local pid="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true
  fi
}

pid_belongs_to_repo() {
  local pid="$1"
  local cwd cmd
  cwd="$(pid_cwd "$pid")"
  cmd="$(pid_command "$pid")"
  [[ "$cwd" == "$ROOT_DIR"* ]] && return 0
  [[ "$cmd" == *"$ROOT_DIR"* ]] && return 0
  return 1
}

pids_for_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
  fi
}

terminate_pid() {
  local name="$1"
  local pid="$2"

  if ! pid_alive "$pid"; then
    echo "$name 프로세스가 이미 종료되었습니다. PID=$pid"
    return 0
  fi

  echo "$name 종료 중... PID=$pid"
  if kill -0 -- "-$pid" >/dev/null 2>&1; then
    kill -TERM -- "-$pid" >/dev/null 2>&1 || true
  else
    kill -TERM "$pid" >/dev/null 2>&1 || true
  fi

  for _ in $(seq 1 20); do
    if ! pid_alive "$pid"; then
      echo "$name 종료 완료"
      return 0
    fi
    sleep 0.5
  done

  echo "$name 정상 종료가 지연되어 강제 종료합니다. PID=$pid"
  if kill -0 -- "-$pid" >/dev/null 2>&1; then
    kill -KILL -- "-$pid" >/dev/null 2>&1 || true
  else
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi
  echo "$name 강제 종료 완료"
}

stop_process() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo "$name PID 파일이 없습니다."
    return 0
  fi

  local pid
  pid="$(read_pid "$pid_file")"

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo "$name PID 파일이 비어 있어 정리했습니다."
    return 0
  fi

  if ! pid_alive "$pid"; then
    rm -f "$pid_file"
    echo "$name 프로세스가 이미 종료되어 PID 파일만 정리했습니다."
    return 0
  fi

  if ! pid_belongs_to_repo "$pid"; then
    echo "$name PID 파일이 현재 repo가 아닌 프로세스를 가리켜 종료하지 않았습니다. PID=$pid"
    echo "  cwd=$(pid_cwd "$pid")"
    echo "  cmd=$(pid_command "$pid")"
    return 1
  fi

  terminate_pid "$name" "$pid"
  rm -f "$pid_file"
}

stop_repo_owned_port_orphans() {
  local name="$1"
  local port="$2"
  local pid_file="$3"
  local known_pid
  known_pid="$(read_pid "$pid_file")"

  local pids
  pids="$(pids_for_port "$port")"
  [[ -z "$pids" ]] && return 0

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    [[ -n "$known_pid" && "$pid" == "$known_pid" ]] && continue
    if pid_belongs_to_repo "$pid"; then
      echo "$name 포트 orphan 프로세스를 종료합니다. port=$port PID=$pid"
      terminate_pid "$name orphan" "$pid"
    else
      echo "$name 포트가 다른 프로세스에 의해 계속 점유 중입니다. port=$port PID=$pid"
      echo "  cwd=$(pid_cwd "$pid")"
      echo "  cmd=$(pid_command "$pid")"
    fi
  done <<< "$pids"
}

stop_process "WebUI" "$WEBUI_PID_FILE"
stop_process "Gateway" "$GATEWAY_PID_FILE"

stop_repo_owned_port_orphans "WebUI" "$WEBUI_PORT" "$WEBUI_PID_FILE"
stop_repo_owned_port_orphans "Gateway" "$GATEWAY_PORT" "$GATEWAY_PID_FILE"
