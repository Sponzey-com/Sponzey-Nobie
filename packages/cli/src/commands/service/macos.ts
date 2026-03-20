import { execSync, spawnSync } from "node:child_process"
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ServiceAction } from "./index.js"
import { which, nobieBinPath } from "./index.js"

const LABEL = "com.atomsoft.nobie"
const AGENTS_DIR = join(homedir(), "Library", "LaunchAgents")
const PLIST_PATH = join(AGENTS_DIR, `${LABEL}.plist`)
const STATE_DIR = process.env["NOBIE_STATE_DIR"] ?? process.env["WIZBY_STATE_DIR"] ?? process.env["HOWIE_STATE_DIR"] ?? process.env["NOBIE_STATE_DIR"] ?? join(homedir(), ".nobie")
const LOGS_DIR = join(STATE_DIR, "logs")

function buildPlist(nodePath: string, nobiePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${nobiePath}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOGS_DIR}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${LOGS_DIR}/daemon-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
</dict>
</plist>`
}

function launchctl(...args: string[]): void {
  const result = spawnSync("launchctl", args, { stdio: "inherit" })
  if (result.error) throw result.error
}

export async function run(action: ServiceAction): Promise<void> {
  switch (action) {
    case "install": {
      const nodePath = which("node")
      const nobiePath = nobieBinPath()
      mkdirSync(AGENTS_DIR, { recursive: true })
      mkdirSync(LOGS_DIR, { recursive: true })
      writeFileSync(PLIST_PATH, buildPlist(nodePath, nobiePath), "utf-8")
      console.log(`Plist written: ${PLIST_PATH}`)
      // Unload if already loaded (ignore error)
      try { launchctl("unload", PLIST_PATH) } catch { /* ignore */ }
      launchctl("load", "-w", PLIST_PATH)
      console.log("✓ Service installed and started")
      console.log(`  Logs: ${LOGS_DIR}/daemon.log`)
      console.log(`  WebUI: http://127.0.0.1:18888`)
      console.log("")
      console.log("Run 'nobie service status' to verify")
      break
    }

    case "uninstall": {
      if (!existsSync(PLIST_PATH)) {
        console.log("Service is not installed.")
        return
      }
      try { launchctl("unload", "-w", PLIST_PATH) } catch { /* ignore */ }
      unlinkSync(PLIST_PATH)
      console.log("✓ Service uninstalled")
      break
    }

    case "start": {
      launchctl("start", LABEL)
      console.log("✓ Service started")
      break
    }

    case "stop": {
      launchctl("stop", LABEL)
      console.log("✓ Service stopped")
      break
    }

    case "status": {
      try {
        const out = execSync(`launchctl list | grep ${LABEL}`, { encoding: "utf-8" }).trim()
        console.log(out || "(not running)")
        const parts = out.split(/\s+/)
        const pid = parts[0]
        console.log(`PID: ${pid === "-" ? "not running" : pid}`)
      } catch {
        console.log("Service not found (not installed or not running)")
      }
      break
    }

    case "logs": {
      const logFile = join(LOGS_DIR, "daemon.log")
      if (!existsSync(logFile)) {
        console.log(`Log file not found: ${logFile}`)
        return
      }
      console.log(`Tailing ${logFile} (Ctrl+C to stop)\n`)
      spawnSync("tail", ["-f", logFile], { stdio: "inherit" })
      break
    }
  }
}
