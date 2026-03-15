import { homedir } from "node:os"
import { join } from "node:path"

function getStateDir(): string {
  if (process.env["SIDEKICK_STATE_DIR"]) {
    return process.env["SIDEKICK_STATE_DIR"]
  }
  return join(homedir(), ".sidekick")
}

export const PATHS = {
  get stateDir() {
    return getStateDir()
  },
  get configFile() {
    return process.env["SIDEKICK_CONFIG"] ?? join(getStateDir(), "config.json5")
  },
  get dbFile() {
    return join(getStateDir(), "data.db")
  },
  get lockFile() {
    return join(getStateDir(), "sidekick.lock")
  },
  get logsDir() {
    return join(getStateDir(), "logs")
  },
  get sessionsDir() {
    return join(getStateDir(), "sessions")
  },
  get pluginsDir() {
    return join(getStateDir(), "plugins")
  },
} as const
