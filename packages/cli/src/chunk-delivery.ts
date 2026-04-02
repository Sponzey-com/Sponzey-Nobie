import type { AgentChunk } from "@nobie/core"

const RESET = "\x1b[0m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const DIM = "\x1b[2m"

function useColor(stdoutIsTty: boolean): boolean {
  return process.env["NOBIE_NO_COLOR"] == null && stdoutIsTty
}

function colorize(stdoutIsTty: boolean, color: string, text: string): string {
  return useColor(stdoutIsTty) ? `${color}${text}${RESET}` : text
}

export interface CliChunkDeliveryContext {
  stdout: { write(text: string): void; isTTY?: boolean }
  stderr: { write(text: string): void }
}

export function createCliChunkDeliveryHandler(context: CliChunkDeliveryContext) {
  const stdoutIsTty = context.stdout.isTTY === true

  return (chunk: AgentChunk): void => {
    switch (chunk.type) {
      case "text":
        context.stdout.write(chunk.delta)
        break

      case "tool_start":
        context.stderr.write(
          "\n" + colorize(stdoutIsTty, CYAN, `🔧 ${chunk.toolName}`) + " "
          + colorize(stdoutIsTty, DIM, JSON.stringify(chunk.params)) + "\n",
        )
        break

      case "tool_end":
        context.stderr.write(
          chunk.success
            ? colorize(stdoutIsTty, GREEN, `   ✓ ${chunk.toolName}\n`)
            : colorize(stdoutIsTty, RED, `   ✗ ${chunk.toolName}: ${chunk.output}\n`),
        )
        break

      case "error":
        context.stderr.write("\n" + colorize(stdoutIsTty, RED, `Error: ${chunk.message}`) + "\n")
        break

      case "done":
        break
    }
  }
}
