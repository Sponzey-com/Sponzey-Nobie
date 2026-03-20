import { execSync, spawnSync } from "node:child_process"
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ServiceAction } from "./index.js"
import { which, nobieBinPath } from "./index.js"

const SERVICE_NAME = "nobie"
const SYSTEMD_DIR = join(homedir(), ".config", "systemd", "user")
const UNIT_PATH = join(SYSTEMD_DIR, `${SERVICE_NAME}.service`)

function buildUnit(nodePath: string, nobiePath: string): string {
  return `[Unit]
Description=스폰지 노비 · Sponzey Nobie AI Agent
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${nobiePath} serve
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
Environment=PATH=${process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin"}
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`
}

function systemctl(...args: string[]): void {
  const result = spawnSync("systemctl", ["--user", ...args], { stdio: "inherit" })
  if (result.error) throw result.error
}

export async function run(action: ServiceAction): Promise<void> {
  switch (action) {
    case "install": {
      const nodePath = which("node")
      const nobiePath = nobieBinPath()
      mkdirSync(SYSTEMD_DIR, { recursive: true })
      writeFileSync(UNIT_PATH, buildUnit(nodePath, nobiePath), "utf-8")
      console.log(`Unit file written: ${UNIT_PATH}`)
      systemctl("daemon-reload")
      systemctl("enable", SERVICE_NAME)
      systemctl("start", SERVICE_NAME)
      // Enable lingering so service persists without active login session
      try {
        execSync(`loginctl enable-linger ${process.env["USER"] ?? ""}`, { stdio: "pipe" })
        console.log("✓ Lingering enabled (service persists across logouts)")
      } catch { /* non-critical */ }
      console.log("✓ Service installed and started")
      console.log("  Run 'nobie service status' to verify")
      break
    }

    case "uninstall": {
      if (!existsSync(UNIT_PATH)) { console.log("Service is not installed."); return }
      try { systemctl("stop", SERVICE_NAME) } catch { /* ignore */ }
      try { systemctl("disable", SERVICE_NAME) } catch { /* ignore */ }
      unlinkSync(UNIT_PATH)
      systemctl("daemon-reload")
      console.log("✓ Service uninstalled")
      break
    }

    case "start":
      systemctl("start", SERVICE_NAME)
      console.log("✓ Service started")
      break

    case "stop":
      systemctl("stop", SERVICE_NAME)
      console.log("✓ Service stopped")
      break

    case "status":
      systemctl("status", SERVICE_NAME)
      break

    case "logs":
      console.log("Streaming logs (Ctrl+C to stop)\n")
      spawnSync("journalctl", ["--user", "-u", SERVICE_NAME, "-f", "--no-pager"], { stdio: "inherit" })
      break
  }
}
