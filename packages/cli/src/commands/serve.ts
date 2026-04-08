import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const STATE_DIR = process.env["NOBIE_STATE_DIR"] ?? process.env["WIZBY_STATE_DIR"]
  ?? process.env["HOWIE_STATE_DIR"]
  ?? process.env["NOBIE_STATE_DIR"]
  ?? (existsSync(join(homedir(), ".nobie")) ? join(homedir(), ".nobie")
    : existsSync(join(homedir(), ".wizby")) ? join(homedir(), ".wizby")
      : existsSync(join(homedir(), ".howie")) ? join(homedir(), ".howie")
        : join(homedir(), ".nobie"))
const PID_FILE = join(STATE_DIR, "daemon.pid")
const LOGS_DIR = join(STATE_DIR, "logs")

export async function serveCommand(): Promise<void> {
  // Write PID file for service stop support
  mkdirSync(LOGS_DIR, { recursive: true })
  writeFileSync(PID_FILE, String(process.pid), "utf-8")

  console.log(`스폰지 노비 · Sponzey Nobie daemon starting (PID=${process.pid})`)

  const { bootstrapAsync } = await import("@nobie/core")

  // Bootstrap: load config, init DB, register tools, start WebUI + scheduler
  await bootstrapAsync()

  console.log("스폰지 노비 · Sponzey Nobie daemon running. Press Ctrl+C to stop.")

  // Keep alive
  process.on("SIGTERM", () => {
    console.log("SIGTERM received — shutting down")
    import("@nobie/core").then(({ closeServer }) => {
      void closeServer().then(() => process.exit(0))
    })
  })

  process.on("SIGINT", () => {
    console.log("\nSIGINT received — shutting down")
    import("@nobie/core").then(({ closeServer }) => {
      void closeServer().then(() => process.exit(0))
    })
  })
}
