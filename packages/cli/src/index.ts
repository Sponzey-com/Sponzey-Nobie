#!/usr/bin/env node
import { program } from "commander"
import { runCommand } from "./commands/run.js"
import { initConfig, generateAuthToken } from "./commands/config.js"
import { serveCommand } from "./commands/serve.js"
import { runServiceAction, type ServiceAction } from "./commands/service/index.js"
import { memoryInitCommand, memoryShowCommand } from "./commands/memory.js"
import { indexCommand, indexClearCommand } from "./commands/index-cmd.js"
import { scheduleRunCommand } from "./commands/schedule.js"
import {
  pluginListCommand,
  pluginInstallCommand,
  pluginUninstallCommand,
  pluginEnableCommand,
  pluginDisableCommand,
  pluginInfoCommand,
} from "./commands/plugin.js"

const VERSION = "0.1.0"

program
  .name("nobie")
  .description("스폰지 노비 · Sponzey Nobie — your local AI assistant")
  .version(VERSION)

// nobie run "do something"
program
  .command("run <message>")
  .description("Send a message to the agent and get a response")
  .option("-s, --session <id>", "Session ID for conversation continuity")
  .option("-m, --model <model>", "Override LLM model (e.g. claude-3-5-sonnet-20241022)")
  .option("-d, --work-dir <path>", "Set the working directory for file/shell tools")
  .option("-y, --yes", "Auto-approve all tool execution (skip confirmation prompts)")
  .action((message: string, options: {
    session?: string
    model?: string
    workDir?: string
    yes?: boolean
  }) => {
    runCommand(message, options).catch((err: unknown) => {
      console.error("Fatal error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

// nobie init
program
  .command("init")
  .description("Create a default config file at ~/.nobie/config.json5")
  .action(() => {
    initConfig()
  })

// nobie status
program
  .command("status")
  .description("Show current agent status and configuration summary")
  .action(async () => {
    const { getConfig, PATHS } = await import("@nobie/core")
    const cfg = getConfig()
    console.log(`스폰지 노비 · Sponzey Nobie v${VERSION}`)
    console.log(`State dir:   ${PATHS.stateDir}`)
    console.log(`Config:      ${PATHS.configFile}`)
    console.log(`DB:          ${PATHS.dbFile}`)
    console.log(`Provider:    ${cfg.llm.defaultProvider}`)
    console.log(`Model:       ${cfg.llm.defaultModel}`)
    console.log(`Approval:    ${cfg.security.approvalMode}`)
  })

// nobie serve — daemon entry point (WebUI + scheduler + Telegram)
program
  .command("serve")
  .description("Start 스폰지 노비 · Sponzey Nobie as a background daemon (WebUI + scheduler + Telegram)")
  .action(() => {
    serveCommand().catch((err: unknown) => {
      console.error("Fatal:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

const schedule = program.command("schedule").description("저장된 스케줄 관리")

schedule
  .command("run <id>")
  .description("저장된 스케줄을 한 번 실행합니다 (system cron 실행용)")
  .action((id: string) => {
    scheduleRunCommand(id).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

// nobie service <action>
const svc = program.command("service").description("Manage the system daemon service")

const serviceActions: Array<{ name: ServiceAction; desc: string }> = [
  { name: "install",   desc: "Install and start the daemon as an OS service (launchd / systemd / Task Scheduler)" },
  { name: "uninstall", desc: "Stop and remove the OS service" },
  { name: "start",     desc: "Start the installed service" },
  { name: "stop",      desc: "Stop the running service" },
  { name: "status",    desc: "Show service status" },
  { name: "logs",      desc: "Stream service logs (Ctrl+C to stop)" },
]

for (const { name, desc } of serviceActions) {
  svc.command(name).description(desc).action(() => {
    runServiceAction(name).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
}

// nobie memory <action>
const mem = program.command("memory").description("Project memory and context management")
mem
  .command("init")
  .description("Create a NOBIE.md template in the current directory")
  .action(() => {
    memoryInitCommand().catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
mem
  .command("show")
  .description("Show stored long-term memories")
  .action(() => {
    memoryShowCommand().catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

// nobie index <path>
const idx = program.command("index").description("로컬 파일 인덱싱 관리 (semantic search)")
idx
  .command("run [path]")
  .description("지정한 경로의 파일을 인덱싱합니다 (기본: 현재 디렉토리)")
  .option("-e, --exclude <patterns...>", "제외할 디렉토리 패턴")
  .option("--stats", "현재 인덱스 통계만 표시")
  .action((path: string | undefined, opts: { exclude?: string[]; stats?: boolean }) => {
    indexCommand(path ?? ".", opts).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
idx
  .command("clear [path]")
  .description("인덱스를 초기화합니다 (path 지정 시 해당 경로만)")
  .action((path: string | undefined) => {
    indexClearCommand(path).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

// nobie plugin <action>
const plug = program.command("plugin").description("플러그인 관리")
plug
  .command("list")
  .description("설치된 플러그인 목록 표시")
  .action(() => {
    pluginListCommand().catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
plug
  .command("install <entryPath>")
  .description("플러그인 설치 (JS/TS 파일 경로)")
  .option("-n, --name <name>", "플러그인 이름 지정")
  .option("-v, --version <ver>", "버전 지정")
  .action((entryPath: string, opts: { name?: string; version?: string }) => {
    pluginInstallCommand(entryPath, opts).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
plug
  .command("uninstall <name>")
  .description("플러그인 제거")
  .action((name: string) => {
    pluginUninstallCommand(name).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
plug
  .command("enable <name>")
  .description("플러그인 활성화")
  .action((name: string) => {
    pluginEnableCommand(name).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
plug
  .command("disable <name>")
  .description("플러그인 비활성화")
  .action((name: string) => {
    pluginDisableCommand(name).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })
plug
  .command("info <name>")
  .description("플러그인 상세 정보")
  .action((name: string) => {
    pluginInfoCommand(name).catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

// nobie auth generate
const auth = program.command("auth").description("WebUI authentication management")
auth
  .command("generate")
  .description("Generate a new WebUI auth token and enable auth in config")
  .action(() => {
    generateAuthToken().catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
  })

program.parse()
