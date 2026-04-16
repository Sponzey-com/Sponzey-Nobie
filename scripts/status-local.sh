#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS_DIR="$ROOT_DIR/pids"

GATEWAY_PID_FILE="$PIDS_DIR/nobie-gateway.pid"
WEBUI_PID_FILE="$PIDS_DIR/nobie-webui.pid"

STATE_DIR="${NOBIE_STATE_DIR:-${WIZBY_STATE_DIR:-${HOWIE_STATE_DIR:-$HOME/.nobie}}}"
GATEWAY_HOST="${NOBIE_GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${NOBIE_GATEWAY_PORT:-18888}"
WEBUI_HOST="${NOBIE_WEBUI_HOST:-127.0.0.1}"
WEBUI_PORT="${NOBIE_WEBUI_PORT:-5173}"
MQTT_PORT="${NOBIE_MQTT_PORT:-1883}"

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

pids_for_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
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

print_pid_state() {
  local name="$1"
  local pid_file="$2"
  local port="$3"
  local pid
  pid="$(read_pid "$pid_file")"

  echo "$name"
  echo "  pidFile: $pid_file"
  if [[ -z "$pid" ]]; then
    echo "  pid: none"
  elif pid_alive "$pid"; then
    if pid_belongs_to_repo "$pid"; then
      echo "  pid: $pid (running, repo-owned)"
    else
      echo "  pid: $pid (running, foreign - check pid file)"
    fi
    echo "  cwd: $(pid_cwd "$pid")"
    echo "  cmd: $(pid_command "$pid")"
  else
    echo "  pid: $pid (stale pid file)"
  fi

  local pids
  pids="$(pids_for_port "$port")"
  if [[ -z "$pids" ]]; then
    echo "  port:$port idle"
  else
    while IFS= read -r port_pid; do
      [[ -z "$port_pid" ]] && continue
      local ownership="foreign"
      pid_belongs_to_repo "$port_pid" && ownership="repo-owned"
      echo "  port:$port listener PID=$port_pid ($ownership)"
    done <<< "$pids"
  fi
}

extract_status() {
  node -e '
    let raw = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => raw += chunk)
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(raw)
        const lines = [
          `  status: reachable`,
          `  version: ${data.displayVersion ?? data.version ?? "unknown"}`,
          `  runtimePid: ${data.runtime?.pid ?? "unknown"}`,
          `  uptimeSeconds: ${data.runtime?.uptimeSeconds ?? data.uptime ?? "unknown"}`,
          `  stateDir: ${data.paths?.stateDir ?? "unknown"}`,
          `  dbFile: ${data.paths?.dbFile ?? "unknown"}`,
          `  promptChecksum: ${data.promptSources?.checksum ?? "none"}`,
          `  mqtt: ${data.mqtt?.enabled ? "enabled" : "disabled"} ${data.mqtt?.running ? "listening" : "not-listening"}`,
          `  yeonjangExtensions: ${Array.isArray(data.yeonjang?.extensions) ? data.yeonjang.extensions.length : "unknown"}`,
          `  setupCompleted: ${data.setupCompleted === true}`,
        ]
        if (Array.isArray(data.yeonjang?.extensions)) {
          for (const extension of data.yeonjang.extensions.slice(0, 10)) {
            lines.push(`    - ${extension.extensionId ?? "unknown"}: ${extension.state ?? "unknown"} ${extension.os ?? extension.platform ?? ""} ${extension.version ?? ""}`.trimEnd())
          }
        }
        process.stdout.write(lines.join("\n") + "\n")
      } catch {
        process.stdout.write("  status: invalid-json\n")
      }
    })
  '
}

print_gateway_health() {
  echo "Gateway health"
  if ! command -v curl >/dev/null 2>&1; then
    echo "  status: curl-not-found"
    return
  fi
  local body
  body="$(curl -fsS "http://$GATEWAY_HOST:$GATEWAY_PORT/api/status" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    echo "  status: unreachable"
    return
  fi
  printf '%s' "$body" | extract_status
}

print_channel_config_hint() {
  echo "Channel config"
  if [[ -f "$STATE_DIR/config.json5" ]]; then
    if grep -q "telegram" "$STATE_DIR/config.json5" 2>/dev/null; then
      echo "  telegram: configured (runtime status is available through Gateway health/channel smoke)"
    else
      echo "  telegram: not found in config"
    fi
    if grep -q "slack" "$STATE_DIR/config.json5" 2>/dev/null; then
      echo "  slack: configured (runtime status is available through Gateway health/channel smoke)"
    else
      echo "  slack: not found in config"
    fi
  else
    echo "  config: missing ($STATE_DIR/config.json5)"
  fi
}

echo "Sponzey Nobie local status"
echo "  repo: $ROOT_DIR"
echo "  stateDir: $STATE_DIR"
echo
print_pid_state "Gateway" "$GATEWAY_PID_FILE" "$GATEWAY_PORT"
echo
print_pid_state "WebUI" "$WEBUI_PID_FILE" "$WEBUI_PORT"
echo
print_pid_state "MQTT" "/tmp/nonexistent-nobie-mqtt.pid" "$MQTT_PORT"
echo
print_gateway_health
echo
print_channel_config_hint
