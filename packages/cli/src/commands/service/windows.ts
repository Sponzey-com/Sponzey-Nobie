import { execSync, spawnSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ServiceAction } from "./index.js"
import { nobieBinPath } from "./index.js"

const TASK_NAME = "Sponzey Nobie"
const STATE_DIR = process.env["NOBIE_STATE_DIR"] ?? process.env["WIZBY_STATE_DIR"] ?? process.env["HOWIE_STATE_DIR"] ?? process.env["NOBIE_STATE_DIR"] ?? join(homedir(), ".nobie")
const PID_FILE = join(STATE_DIR, "daemon.pid")
const LOG_FILE = join(STATE_DIR, "logs", "daemon.log")

function findNodeExe(): string {
  try {
    return execSync("where node", { encoding: "utf-8" }).split("\n")[0]?.trim() ?? "node.exe"
  } catch {
    return "node.exe"
  }
}

export async function run(action: ServiceAction): Promise<void> {
  switch (action) {
    case "install": {
      const nodePath = findNodeExe()
      const nobiePath = nobieBinPath()
      const cmd = `"${nodePath}" "${nobiePath}" serve`
      execSync(
        `schtasks /Create /TN "${TASK_NAME}" /TR "${cmd}" /SC ONLOGON /RU %USERNAME% /F`,
        { stdio: "inherit" },
      )
      // Start immediately
      execSync(`schtasks /Run /TN "${TASK_NAME}"`, { stdio: "inherit" })
      console.log(`✓ Task "${TASK_NAME}" created and started`)
      console.log(`  WebUI: http://127.0.0.1:18888`)
      break
    }

    case "uninstall": {
      try { execSync(`schtasks /End /TN "${TASK_NAME}"`, { stdio: "pipe" }) } catch { /* ignore */ }
      execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: "inherit" })
      console.log(`✓ Task "${TASK_NAME}" deleted`)
      break
    }

    case "start":
      execSync(`schtasks /Run /TN "${TASK_NAME}"`, { stdio: "inherit" })
      console.log("✓ Service started")
      break

    case "stop": {
      if (existsSync(PID_FILE)) {
        const pid = readFileSync(PID_FILE, "utf-8").trim()
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: "inherit" }) } catch { /* ignore */ }
      } else {
        try { execSync(`schtasks /End /TN "${TASK_NAME}"`, { stdio: "inherit" }) } catch { /* ignore */ }
      }
      console.log("✓ Service stopped")
      break
    }

    case "status":
      execSync(`schtasks /Query /TN "${TASK_NAME}" /FO LIST`, { stdio: "inherit" })
      break

    case "logs":
      if (!existsSync(LOG_FILE)) { console.log(`Log file not found: ${LOG_FILE}`); return }
      spawnSync("powershell", ["-Command", `Get-Content -Path "${LOG_FILE}" -Wait`], { stdio: "inherit" })
      break
  }
}
