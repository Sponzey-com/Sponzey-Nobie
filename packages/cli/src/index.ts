#!/usr/bin/env node
import { program } from "commander"
import { runCommand } from "./commands/run.js"
import { initConfig } from "./commands/config.js"

const VERSION = "0.1.0"

program
  .name("sidekick")
  .description("SidekickSponzey — your local AI assistant")
  .version(VERSION)

// sidekick run "do something"
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

// sidekick init
program
  .command("init")
  .description("Create a default config file at ~/.sidekick/config.json5")
  .action(() => {
    initConfig()
  })

// sidekick status
program
  .command("status")
  .description("Show current agent status and configuration summary")
  .action(async () => {
    const { getConfig, PATHS } = await import("@sidekick/core")
    const cfg = getConfig()
    console.log(`SidekickSponzey v${VERSION}`)
    console.log(`State dir:   ${PATHS.stateDir}`)
    console.log(`Config:      ${PATHS.configFile}`)
    console.log(`DB:          ${PATHS.dbFile}`)
    console.log(`Provider:    ${cfg.llm.defaultProvider}`)
    console.log(`Model:       ${cfg.llm.defaultModel}`)
    console.log(`Approval:    ${cfg.security.approvalMode}`)
  })

program.parse()
