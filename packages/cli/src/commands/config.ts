import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { PATHS, getConfig } from "@sidekick/core"

const SAMPLE_CONFIG = `// SidekickSponzey configuration
// Docs: see design/plan.md
{
  llm: {
    defaultProvider: "anthropic",
    defaultModel: "claude-3-5-haiku-20241022",
    providers: {
      anthropic: {
        // Set via env: ANTHROPIC_API_KEY, or list keys here
        apiKeys: ["\${ANTHROPIC_API_KEY}"],
      },
    },
  },
  security: {
    // Directories the agent is allowed to access.
    // Empty = home directory only.
    allowedPaths: [],
    // "on-miss" = ask when a command isn't in allowedCommands
    // "always"  = always ask before shell_exec / file_delete
    // "off"     = never ask (dangerous)
    approvalMode: "on-miss",
    approvalTimeout: 60,
    approvalTimeoutFallback: "deny",
    allowedCommands: [],
  },
  webui: {
    enabled: true,
    port: 18888,
    host: "127.0.0.1",
    auth: { enabled: false },
  },
  scheduler: {
    enabled: true,
    timezone: "Asia/Seoul",
  },
  search: {},
  memory: {
    sessionRetentionDays: 30,
  },
}
`

export function initConfig() {
  const configPath = PATHS.configFile
  if (existsSync(configPath)) {
    console.log(`Config already exists: ${configPath}`)
    return
  }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, SAMPLE_CONFIG, "utf-8")
  console.log(`Config created: ${configPath}`)
  console.log("Edit the file to add your API keys, then run: sidekick run \"hello\"")
}

export function showConfig(): void {
  const cfg = getConfig()
  console.log(JSON.stringify(cfg, null, 2))
}
