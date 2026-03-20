#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_DIR="$ROOT_DIR/pids"
LOGS_DIR="$ROOT_DIR/logs"

GATEWAY_PID_FILE="$PIDS_DIR/nobie-gateway.pid"
WEBUI_PID_FILE="$PIDS_DIR/nobie-webui.pid"

GATEWAY_LOG_FILE="$LOGS_DIR/nobie-gateway.log"
WEBUI_LOG_FILE="$LOGS_DIR/nobie-webui.log"

STATE_DIR="${NOBIE_STATE_DIR:-${WIZBY_STATE_DIR:-${HOWIE_STATE_DIR:-${NOBIE_STATE_DIR:-$HOME/.nobie}}}}"
GATEWAY_HOST="${NOBIE_GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${NOBIE_GATEWAY_PORT:-18888}"
WEBUI_HOST="${NOBIE_WEBUI_HOST:-127.0.0.1}"
WEBUI_PORT="${NOBIE_WEBUI_PORT:-5173}"

mkdir -p "$PIDS_DIR" "$LOGS_DIR"

truncate_logs() {
  : > "$GATEWAY_LOG_FILE"
  : > "$WEBUI_LOG_FILE"
}

cleanup_stale_pid() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$pid_file"
  fi
}

is_running() {
  local pid_file="$1"
  cleanup_stale_pid "$pid_file"
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" >/dev/null 2>&1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local pid_file="$3"

  if ! command -v curl >/dev/null 2>&1; then
    sleep 3
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"

  for _ in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name 프로세스가 시작 중 종료되었습니다."
      return 1
    fi

    sleep 1
  done

  echo "$name 준비 대기 시간이 초과되었습니다: $url"
  return 1
}

start_gateway() {
  if is_running "$GATEWAY_PID_FILE"; then
    echo "Gateway는 이미 실행 중입니다. PID=$(cat "$GATEWAY_PID_FILE")"
    return 0
  fi

  echo "Gateway 실행 파일을 빌드합니다..."
  (
    cd "$ROOT_DIR"
    pnpm --filter @nobie/core build
    pnpm --filter @nobie/cli build
  )

  echo "Gateway를 시작합니다..."
  (
    cd "$ROOT_DIR"
    export NOBIE_STATE_DIR="$STATE_DIR"
    export NOBIE_LOG_LEVEL="${NOBIE_LOG_LEVEL:-debug}"
    exec nohup node packages/cli/dist/index.js serve </dev/null
  ) >>"$GATEWAY_LOG_FILE" 2>&1 &
  echo "$!" > "$GATEWAY_PID_FILE"

  if ! wait_for_http "Gateway" "http://$GATEWAY_HOST:$GATEWAY_PORT/api/status" "$GATEWAY_PID_FILE"; then
    echo "Gateway 로그:"
    tail -n 80 "$GATEWAY_LOG_FILE" || true
    return 1
  fi
}

start_webui() {
  if is_running "$WEBUI_PID_FILE"; then
    echo "WebUI는 이미 실행 중입니다. PID=$(cat "$WEBUI_PID_FILE")"
    return 0
  fi

  echo "WebUI를 시작합니다..."
  (
    cd "$ROOT_DIR"
    export NOBIE_LOG_LEVEL="${NOBIE_LOG_LEVEL:-debug}"
    exec nohup pnpm --filter @nobie/webui exec vite --host "$WEBUI_HOST" --port "$WEBUI_PORT" --strictPort </dev/null
  ) >>"$WEBUI_LOG_FILE" 2>&1 &
  echo "$!" > "$WEBUI_PID_FILE"

  if ! wait_for_http "WebUI" "http://$WEBUI_HOST:$WEBUI_PORT" "$WEBUI_PID_FILE"; then
    echo "WebUI 로그:"
    tail -n 80 "$WEBUI_LOG_FILE" || true
    return 1
  fi
}

if is_running "$GATEWAY_PID_FILE" || is_running "$WEBUI_PID_FILE"; then
  echo "기존 스폰지 노비 · Sponzey Nobie 프로세스를 정리하고 다시 시작합니다..."
  bash "$ROOT_DIR/scripts/stop-local.sh"
fi

truncate_logs

start_gateway
start_webui

echo
echo "스폰지 노비 · Sponzey Nobie 로컬 실행이 완료되었습니다."
echo "  Gateway : http://$GATEWAY_HOST:$GATEWAY_PORT"
echo "  WebUI   : http://$WEBUI_HOST:$WEBUI_PORT"
echo "  State   : $STATE_DIR"
echo "  Logs    : $GATEWAY_LOG_FILE / $WEBUI_LOG_FILE"
echo "  Stop    : bash scripts/stop-local.sh"
