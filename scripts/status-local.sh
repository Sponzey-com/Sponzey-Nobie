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
WEBUI_PORT="${NOBIE_WEBUI_PORT:-4220}"
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
  NOBIE_STATUS_ROOT_DIR="$ROOT_DIR" node -e '
    const { existsSync, readdirSync, statSync } = require("node:fs")
    const { join, relative } = require("node:path")
    const ignoredDirs = new Set([".git", "node_modules", ".turbo", ".cache"])
    function newestFileMtime(dir) {
      if (!existsSync(dir)) return null
      let newest = null
      const stack = [dir]
      while (stack.length > 0) {
        const current = stack.pop()
        let entries = []
        try {
          entries = readdirSync(current)
        } catch {
          continue
        }
        for (const entry of entries) {
          if (ignoredDirs.has(entry)) continue
          const path = join(current, entry)
          let stat
          try {
            stat = statSync(path)
          } catch {
            continue
          }
          if (stat.isDirectory()) {
            stack.push(path)
            continue
          }
          if (!stat.isFile()) continue
          if (!newest || stat.mtimeMs > newest.mtimeMs) {
            newest = { path, mtimeMs: stat.mtimeMs, mtimeIso: new Date(stat.mtimeMs).toISOString() }
          }
        }
      }
      return newest
    }
    function sourceBuildInputs(dir) {
      if (!existsSync(dir)) return []
      const files = []
      const stack = [dir]
      while (stack.length > 0) {
        const current = stack.pop()
        let entries = []
        try {
          entries = readdirSync(current)
        } catch {
          continue
        }
        for (const entry of entries) {
          if (ignoredDirs.has(entry)) continue
          const path = join(current, entry)
          let stat
          try {
            stat = statSync(path)
          } catch {
            continue
          }
          if (stat.isDirectory()) {
            stack.push(path)
            continue
          }
          if (!stat.isFile()) continue
          if (!/\.(?:ts|tsx)$/u.test(path) || /\.d\.ts$/u.test(path)) continue
          files.push({ path, mtimeMs: stat.mtimeMs, mtimeIso: new Date(stat.mtimeMs).toISOString() })
        }
      }
      return files
    }
    function outputMtime(path) {
      try {
        const stat = statSync(path)
        if (!stat.isFile()) return null
        return { path, mtimeMs: stat.mtimeMs, mtimeIso: new Date(stat.mtimeMs).toISOString() }
      } catch {
        return null
      }
    }
    function localRuntimeBuild(data) {
      const root = process.env.NOBIE_STATUS_ROOT_DIR
      const processStartedAt = data.runtime?.startedAt ?? data.runtimeBuild?.processStartedAt
      const processStartMs = Date.parse(processStartedAt ?? "")
      if (!root) return { packages: [], buildRequired: undefined, restartRequired: undefined, warnings: [] }
      const packages = ["core", "cli"].map((name) => {
        const sourceDir = join(root, "packages", name, "src")
        const distDir = join(root, "packages", name, "dist")
        const sourceInputs = sourceBuildInputs(sourceDir)
        const sourceNewest = sourceInputs.reduce((newest, file) => !newest || file.mtimeMs > newest.mtimeMs ? file : newest, null)
        const distNewest = newestFileMtime(distDir)
        const missingOutputs = []
        const staleOutputs = []
        for (const source of sourceInputs) {
          const outputPath = join(distDir, relative(sourceDir, source.path).replace(/\.(?:ts|tsx)$/u, ".js"))
          const output = outputMtime(outputPath)
          if (!output) {
            missingOutputs.push(outputPath)
          }
        }
        const buildRequired = Boolean(missingOutputs.length > 0 || (sourceNewest && (!distNewest || sourceNewest.mtimeMs > distNewest.mtimeMs + 1)))
        const restartRequired = Boolean(Number.isFinite(processStartMs) && distNewest && distNewest.mtimeMs > processStartMs + 1)
        return { package: name, sourceNewest, distNewest, missingOutputs, staleOutputs, buildRequired, restartRequired }
      })
      const buildRequired = packages.some((pkg) => pkg.buildRequired)
      const restartRequired = packages.some((pkg) => pkg.restartRequired)
      const warnings = []
      if (buildRequired) warnings.push("build_required")
      if (restartRequired) warnings.push("restart_required")
      return { packages, buildRequired, restartRequired, warnings }
    }
    let raw = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => raw += chunk)
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(raw)
        const runtimeBuild = data.runtimeBuild ?? {}
        const localBuild = localRuntimeBuild(data)
        const effectiveBuildRequired = typeof runtimeBuild.buildRequired === "boolean" ? runtimeBuild.buildRequired : localBuild.buildRequired
        const effectiveRestartRequired = typeof runtimeBuild.restartRequired === "boolean" ? runtimeBuild.restartRequired : localBuild.restartRequired
        const runtimePackages = Array.isArray(runtimeBuild.packages) ? runtimeBuild.packages : localBuild.packages
        const runtimeWarnings = Array.isArray(runtimeBuild.warnings) ? runtimeBuild.warnings : localBuild.warnings
        const boolText = (value) => typeof value === "boolean" ? String(value) : "unknown"
        const lines = [
          `  status: reachable`,
          `  version: ${data.displayVersion ?? data.version ?? "unknown"}`,
          `  runtimePid: ${data.runtime?.pid ?? "unknown"}`,
          `  gatewayStartedAt: ${data.runtime?.startedAt ?? runtimeBuild.processStartedAt ?? "unknown"}`,
          `  uptimeSeconds: ${data.runtime?.uptimeSeconds ?? data.uptime ?? "unknown"}`,
          `  buildId: ${runtimeBuild.buildId ?? "unknown"}`,
          `  gitCommit: ${runtimeBuild.gitCommit ? String(runtimeBuild.gitCommit).slice(0, 12) : "unknown"}`,
          `  buildRequired: ${boolText(effectiveBuildRequired)}`,
          `  restartRequired: ${boolText(effectiveRestartRequired)}`,
          `  stateDir: ${data.paths?.stateDir ?? "unknown"}`,
          `  dbFile: ${data.paths?.dbFile ?? "unknown"}`,
          `  promptChecksum: ${data.promptSources?.checksum ?? "none"}`,
          `  mqtt: ${data.mqtt?.enabled ? "enabled" : "disabled"} ${data.mqtt?.running ? "listening" : "not-listening"}`,
          `  yeonjangExtensions: ${Array.isArray(data.yeonjang?.extensions) ? data.yeonjang.extensions.length : "unknown"}`,
          `  setupCompleted: ${data.setupCompleted === true}`,
        ]
        for (const pkg of runtimePackages) {
          lines.push(`  ${pkg.package ?? "package"}SourceMtime: ${pkg.sourceNewest?.mtimeIso ?? "missing"}`)
          lines.push(`  ${pkg.package ?? "package"}DistMtime: ${pkg.distNewest?.mtimeIso ?? "missing"}`)
        }
        if (runtimeWarnings.length > 0) {
          lines.push(`  runtimeWarnings: ${runtimeWarnings.join(",")}`)
        }
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

print_migration_safety_hint() {
  echo "Migration safety"
  local db_file="$STATE_DIR/data.db"
  if [[ ! -f "$db_file" ]]; then
    echo "  db: missing ($db_file)"
    echo "  topologyV2DryRun: run previewExecutorTopologyV2RegistryMigration before materialization"
    return
  fi
  echo "  db: $db_file"
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "  migrationLock: sqlite3-not-found"
    echo "  topologyV2DryRun: run previewExecutorTopologyV2RegistryMigration before materialization"
    return
  fi
  local lock_table
  lock_table="$(sqlite3 "$db_file" "SELECT name FROM sqlite_master WHERE type='table' AND name='migration_locks';" 2>/dev/null || true)"
  if [[ -z "$lock_table" ]]; then
    echo "  migrationLock: table-missing"
  else
    local active_lock
    active_lock="$(sqlite3 "$db_file" "SELECT id || ':' || phase || ':' || updated_at FROM migration_locks WHERE status='active' ORDER BY updated_at DESC LIMIT 1;" 2>/dev/null || true)"
    if [[ -z "$active_lock" ]]; then
      echo "  migrationLock: clear"
    else
      echo "  migrationLock: active $active_lock"
    fi
  fi
  echo "  topologyV2DryRun: required before materializeExecutorTopologyV2ReadModelInRegistry"
  echo "  destructiveCleanup: separate explicit admin task only"
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
echo
print_migration_safety_hint
