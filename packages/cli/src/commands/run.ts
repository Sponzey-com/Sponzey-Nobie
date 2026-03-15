import { bootstrap, runAgent } from "@sidekick/core"
import type { AgentChunk } from "@sidekick/core"

const RESET = "\x1b[0m"
const CYAN = "\x1b[36m"
const YELLOW = "\x1b[33m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"

function useColor(): boolean {
  return process.env["SIDEKICK_NO_COLOR"] == null && process.stdout.isTTY === true
}

function c(color: string, text: string): string {
  return useColor() ? `${color}${text}${RESET}` : text
}

export async function runCommand(message: string, options: {
  session?: string
  model?: string
  workDir?: string
  yes?: boolean
}) {
  bootstrap()

  const abortController = new AbortController()
  process.on("SIGINT", () => {
    process.stderr.write("\n" + c(YELLOW, "Cancelling...") + "\n")
    abortController.abort()
  })

  // If --yes is set, auto-approve all tool calls
  if (options.yes) {
    const { eventBus } = await import("@sidekick/core")
    eventBus.on("approval.request", ({ resolve }) => {
      process.stderr.write(c(YELLOW, "  [auto-approved with --yes]\n"))
      resolve("allow")
    })
  } else {
    // Interactive approval
    const { eventBus } = await import("@sidekick/core")
    eventBus.on("approval.request", async ({ toolName, params, resolve }) => {
      const paramsStr = JSON.stringify(params, null, 2)
        .split("\n")
        .map((l) => "    " + l)
        .join("\n")
      process.stderr.write(
        "\n" +
        c(YELLOW, `⚠  Approval required`) + "\n" +
        c(DIM, `   Tool:   `) + c(BOLD, toolName) + "\n" +
        c(DIM, `   Params:\n`) + c(DIM, paramsStr) + "\n" +
        c(CYAN, "   Allow? [y/N] "),
      )
      const answer = await readLine()
      resolve(answer.trim().toLowerCase() === "y" ? "allow" : "deny")
    })
  }

  process.stdout.write("\n")

  let hasOutput = false
  const startMs = Date.now()

  const generator = runAgent({
    userMessage: message,
    sessionId: options.session,
    model: options.model,
    workDir: options.workDir,
    signal: abortController.signal,
  })

  for await (const chunk of generator) {
    handleChunk(chunk, () => { hasOutput = true })
  }

  const durationSec = ((Date.now() - startMs) / 1000).toFixed(1)
  process.stdout.write("\n" + c(DIM, `\n⏱  Done in ${durationSec}s\n`))
}

function handleChunk(chunk: AgentChunk, onText: () => void) {
  switch (chunk.type) {
    case "text":
      process.stdout.write(chunk.delta)
      onText()
      break

    case "tool_start":
      process.stderr.write(
        "\n" + c(CYAN, `🔧 ${chunk.toolName}`) + " " +
        c(DIM, JSON.stringify(chunk.params)) + "\n",
      )
      break

    case "tool_end":
      process.stderr.write(
        chunk.success
          ? c(GREEN, `   ✓ ${chunk.toolName}\n`)
          : c(RED, `   ✗ ${chunk.toolName}: ${chunk.output}\n`),
      )
      break

    case "error":
      process.stderr.write("\n" + c(RED, `Error: ${chunk.message}`) + "\n")
      break

    case "done":
      break
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    process.stdin.resume()
    process.stdin.setEncoding("utf-8")

    const onData = (chunk: string) => {
      if (chunk.includes("\n")) {
        process.stdin.off("data", onData)
        process.stdin.pause()
        resolve(chunks.join("").trimEnd())
      } else {
        chunks.push(Buffer.from(chunk))
      }
    }
    process.stdin.on("data", onData)
  })
}
