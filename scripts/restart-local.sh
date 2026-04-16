#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_HOST="${NOBIE_GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${NOBIE_GATEWAY_PORT:-18888}"
WEBUI_HOST="${NOBIE_WEBUI_HOST:-127.0.0.1}"
WEBUI_PORT="${NOBIE_WEBUI_PORT:-5173}"

pids_for_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
  fi
}

wait_port_release() {
  local name="$1"
  local port="$2"
  for _ in $(seq 1 20); do
    if [[ -z "$(pids_for_port "$port")" ]]; then
      echo "$name 포트 해제 확인: $port"
      return 0
    fi
    sleep 0.5
  done
  echo "$name 포트가 아직 점유 중입니다: $port"
  pids_for_port "$port" | while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    echo "  PID=$pid $(ps -p "$pid" -o command= 2>/dev/null || true)"
  done
  return 1
}

wait_http_ready() {
  local name="$1"
  local url="$2"
  if ! command -v curl >/dev/null 2>&1; then
    echo "$name HTTP 확인을 건너뜁니다. curl이 없습니다."
    return 0
  fi
  for _ in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name HTTP 확인 완료: $url"
      return 0
    fi
    sleep 1
  done
  echo "$name HTTP 확인 실패: $url"
  return 1
}

echo "스폰지 노비 · Sponzey Nobie 로컬 서비스를 재시작합니다."
echo "1) 기존 프로세스 종료"
bash "$ROOT_DIR/scripts/stop-local.sh"

echo
echo "2) 포트 해제 확인"
wait_port_release "Gateway" "$GATEWAY_PORT"
wait_port_release "WebUI" "$WEBUI_PORT"

echo
echo "3) 빌드 및 시작"
bash "$ROOT_DIR/scripts/start-local.sh"

echo
echo "4) Health check"
wait_http_ready "Gateway" "http://$GATEWAY_HOST:$GATEWAY_PORT/api/status"
wait_http_ready "WebUI" "http://$WEBUI_HOST:$WEBUI_PORT"

echo
echo "5) 현재 상태"
bash "$ROOT_DIR/scripts/status-local.sh"

echo
echo "재시작 완료"
