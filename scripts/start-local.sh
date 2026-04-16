#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_DIR="$ROOT_DIR/pids"
LOGS_DIR="$ROOT_DIR/logs"

GATEWAY_PID_FILE="$PIDS_DIR/nobie-gateway.pid"
WEBUI_PID_FILE="$PIDS_DIR/nobie-webui.pid"

GATEWAY_LOG_FILE="$LOGS_DIR/nobie-gateway.log"
WEBUI_LOG_FILE="$LOGS_DIR/nobie-webui.log"

STATE_DIR="${NOBIE_STATE_DIR:-${WIZBY_STATE_DIR:-${HOWIE_STATE_DIR:-$HOME/.nobie}}}"
GATEWAY_HOST="${NOBIE_GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${NOBIE_GATEWAY_PORT:-18888}"
WEBUI_HOST="${NOBIE_WEBUI_HOST:-127.0.0.1}"
WEBUI_PORT="${NOBIE_WEBUI_PORT:-5173}"

mkdir -p "$PIDS_DIR" "$LOGS_DIR"

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
  local cwd=""
  if command -v lsof >/dev/null 2>&1; then
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
  fi
  printf '%s' "$cwd"
}

pid_belongs_to_repo() {
  local pid="$1"
  local cmd cwd
  cmd="$(pid_command "$pid")"
  cwd="$(pid_cwd "$pid")"

  [[ "$cwd" == "$ROOT_DIR"* ]] && return 0
  [[ "$cmd" == *"$ROOT_DIR"* ]] && return 0
  [[ "$cmd" == *"@nobie/cli"* || "$cmd" == *"packages/cli/dist/index.js serve"* || "$cmd" == *"@nobie/webui"* ]] && [[ "$cwd" == "$ROOT_DIR"* ]] && return 0
  return 1
}

pids_for_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
  fi
}

describe_pid() {
  local pid="$1"
  local cwd cmd
  cwd="$(pid_cwd "$pid")"
  cmd="$(pid_command "$pid")"
  echo "  PID=$pid"
  echo "    cwd=${cwd:-unknown}"
  echo "    cmd=${cmd:-unknown}"
}

cleanup_stale_pid() {
  local name="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid="$(read_pid "$pid_file")"
  if ! pid_alive "$pid"; then
    rm -f "$pid_file"
    echo "$name stale PID 파일을 정리했습니다: ${pid:-empty}"
    return
  fi

  if ! pid_belongs_to_repo "$pid"; then
    echo "$name PID 파일이 현재 repo가 아닌 프로세스를 가리킵니다. start를 중단합니다."
    describe_pid "$pid"
    exit 1
  fi
}

is_running() {
  local name="$1"
  local pid_file="$2"
  cleanup_stale_pid "$name" "$pid_file"
  local pid
  pid="$(read_pid "$pid_file")"
  pid_alive "$pid"
}

assert_port_available() {
  local name="$1"
  local port="$2"
  local expected_pid_file="${3:-}"
  local expected_pid=""
  [[ -n "$expected_pid_file" ]] && expected_pid="$(read_pid "$expected_pid_file")"

  local pids
  pids="$(pids_for_port "$port")"
  [[ -z "$pids" ]] && return 0

  local conflict=0
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    if [[ -n "$expected_pid" && "$pid" == "$expected_pid" ]]; then
      continue
    fi
    conflict=1
  done <<< "$pids"

  [[ "$conflict" -eq 0 ]] && return 0

  echo "$name 포트가 이미 점유되어 start를 중단합니다: port=$port"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    if pid_belongs_to_repo "$pid"; then
      echo "현재 repo의 orphan 프로세스일 가능성이 있습니다. 먼저 scripts/stop-local.sh 또는 kill 후 재시도하세요."
    else
      echo "다른 프로세스가 포트를 점유하고 있습니다. 포트 또는 해당 프로세스를 확인하세요."
    fi
    describe_pid "$pid"
  done <<< "$pids"
  exit 1
}

truncate_logs() {
  : > "$GATEWAY_LOG_FILE"
  : > "$WEBUI_LOG_FILE"
}

build_workspace() {
  echo "Gateway 실행 파일을 빌드합니다..."
  (
    cd "$ROOT_DIR"
    pnpm --filter @nobie/core build
    pnpm --filter @nobie/cli build
  )
}

extract_status_field() {
  local field="$1"
  node -e '
    const field = process.argv[1]
    let raw = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => raw += chunk)
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(raw)
        const value = field.split(".").reduce((current, key) => current?.[key], data)
        if (value === undefined || value === null) process.exit(2)
        process.stdout.write(String(value))
      } catch {
        process.exit(1)
      }
    })
  ' "$field"
}

verify_gateway_status() {
  local expected_pid="$1"
  local body pid state_dir cwd display_version prompt_checksum
  body="$(curl -fsS "http://$GATEWAY_HOST:$GATEWAY_PORT/api/status" 2>/dev/null || true)"
  [[ -z "$body" ]] && return 1

  pid="$(printf '%s' "$body" | extract_status_field runtime.pid || true)"
  state_dir="$(printf '%s' "$body" | extract_status_field paths.stateDir || true)"
  cwd="$(printf '%s' "$body" | extract_status_field runtime.cwd || true)"
  display_version="$(printf '%s' "$body" | extract_status_field displayVersion || true)"
  prompt_checksum="$(printf '%s' "$body" | extract_status_field promptSources.checksum || true)"

  if [[ "$pid" != "$expected_pid" ]]; then
    echo "Gateway health 응답 PID가 새 프로세스와 다릅니다. expected=$expected_pid actual=${pid:-unknown}"
    return 1
  fi
  if [[ "$state_dir" != "$STATE_DIR" ]]; then
    echo "Gateway stateDir가 예상과 다릅니다. expected=$STATE_DIR actual=${state_dir:-unknown}"
    return 1
  fi
  if [[ "$cwd" != "$ROOT_DIR"* ]]; then
    echo "Gateway cwd가 현재 repo가 아닙니다. expected=$ROOT_DIR actual=${cwd:-unknown}"
    return 1
  fi

  echo "Gateway health 확인 완료: pid=$pid version=${display_version:-unknown} stateDir=$state_dir promptChecksum=${prompt_checksum:-none}"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local pid_file="$3"
  local verify_gateway="${4:-false}"

  if ! command -v curl >/dev/null 2>&1; then
    sleep 3
    return 0
  fi

  local pid
  pid="$(read_pid "$pid_file")"

  for _ in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      if ! pid_alive "$pid"; then
        echo "$name 프로세스가 시작 중 종료되었습니다. 기존 프로세스나 포트 점유 상태를 확인해 주세요."
        return 1
      fi
      if [[ "$verify_gateway" == "true" ]]; then
        verify_gateway_status "$pid" && return 0
      else
        return 0
      fi
    fi

    if ! pid_alive "$pid"; then
      echo "$name 프로세스가 시작 중 종료되었습니다."
      return 1
    fi

    sleep 1
  done

  echo "$name 준비 대기 시간이 초과되었습니다: $url"
  return 1
}

start_gateway() {
  if is_running "Gateway" "$GATEWAY_PID_FILE"; then
    echo "Gateway는 이미 실행 중입니다. PID=$(cat "$GATEWAY_PID_FILE")"
    return 0
  fi

  assert_port_available "Gateway" "$GATEWAY_PORT"
  build_workspace

  echo "Gateway를 시작합니다..."
  (
    cd "$ROOT_DIR"
    export NOBIE_STATE_DIR="$STATE_DIR"
    export NOBIE_LOG_LEVEL="${NOBIE_LOG_LEVEL:-debug}"
    exec nohup node packages/cli/dist/index.js serve </dev/null
  ) >>"$GATEWAY_LOG_FILE" 2>&1 &
  echo "$!" > "$GATEWAY_PID_FILE"

  if ! wait_for_http "Gateway" "http://$GATEWAY_HOST:$GATEWAY_PORT/api/status" "$GATEWAY_PID_FILE" true; then
    echo "Gateway 로그:"
    tail -n 100 "$GATEWAY_LOG_FILE" || true
    return 1
  fi
}

start_webui() {
  if is_running "WebUI" "$WEBUI_PID_FILE"; then
    echo "WebUI는 이미 실행 중입니다. PID=$(cat "$WEBUI_PID_FILE")"
    return 0
  fi

  assert_port_available "WebUI" "$WEBUI_PORT"

  echo "WebUI를 시작합니다..."
  (
    cd "$ROOT_DIR"
    export NOBIE_LOG_LEVEL="${NOBIE_LOG_LEVEL:-debug}"
    exec nohup pnpm --filter @nobie/webui exec vite --host "$WEBUI_HOST" --port "$WEBUI_PORT" --strictPort </dev/null
  ) >>"$WEBUI_LOG_FILE" 2>&1 &
  echo "$!" > "$WEBUI_PID_FILE"

  if ! wait_for_http "WebUI" "http://$WEBUI_HOST:$WEBUI_PORT" "$WEBUI_PID_FILE" false; then
    echo "WebUI 로그:"
    tail -n 100 "$WEBUI_LOG_FILE" || true
    return 1
  fi
}

cleanup_stale_pid "Gateway" "$GATEWAY_PID_FILE"
cleanup_stale_pid "WebUI" "$WEBUI_PID_FILE"

if is_running "Gateway" "$GATEWAY_PID_FILE" || is_running "WebUI" "$WEBUI_PID_FILE"; then
  echo "기존 스폰지 노비 · Sponzey Nobie 프로세스를 정리하고 다시 시작합니다..."
  bash "$ROOT_DIR/scripts/stop-local.sh"
fi

assert_port_available "Gateway" "$GATEWAY_PORT"
assert_port_available "WebUI" "$WEBUI_PORT"
truncate_logs

start_gateway
start_webui

echo
echo "스폰지 노비 · Sponzey Nobie 로컬 실행이 완료되었습니다."
echo "  Gateway : http://$GATEWAY_HOST:$GATEWAY_PORT"
echo "  WebUI   : http://$WEBUI_HOST:$WEBUI_PORT"
echo "  State   : $STATE_DIR"
echo "  Logs    : $GATEWAY_LOG_FILE / $WEBUI_LOG_FILE"
echo "  Status  : bash scripts/status-local.sh"
echo "  Stop    : bash scripts/stop-local.sh"
