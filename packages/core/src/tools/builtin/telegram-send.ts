import { existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"
import type { AgentTool, ToolContext, ToolResult } from "../types.js"
import { getConfig } from "../../config/index.js"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

function assertAllowedPath(filePath: string): void {
  const resolved = resolve(filePath)
  const config = getConfig()
  const home = homedir()

  const allowed = config.security.allowedPaths.length > 0
    ? config.security.allowedPaths.map((p) => resolve(p.replace("~", home)))
    : [home]

  const isAllowed = allowed.some((a) => resolved.startsWith(a + "/") || resolved === a)
  if (!isAllowed) {
    throw new Error(
      `Access denied: "${resolved}" is outside the allowed paths.\n` +
      `Allowed: ${allowed.join(", ")}`,
    )
  }

  const denied = ["/System", "/usr", "/bin", "/sbin", "/etc", "/boot", "/sys", "C:\\Windows"]
  if (denied.some((d) => resolved.startsWith(d))) {
    throw new Error(`Access denied: "${resolved}" is a protected system path`)
  }
}

interface TelegramSendFileParams {
  filePath: string
  caption?: string | undefined
}

export const telegramSendFileTool: AgentTool<TelegramSendFileParams> = {
  name: "telegram_send_file",
  description:
    "Send a file to the user via Telegram. " +
    "Supports documents, images, and other files up to 50MB. " +
    "Use this when you want to send a file result to the user.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Absolute path to the file to send",
      },
      caption: {
        type: "string",
        description: "Optional caption to display with the file",
      },
    },
    required: ["filePath"],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params, ctx: ToolContext): Promise<ToolResult> {
    const filePath = params.filePath.replace(/^~/, homedir())

    try {
      if (ctx.source !== "telegram") {
        return {
          success: false,
          output: "telegram_send_file 도구는 Telegram 채널에서만 사용할 수 있습니다.",
          error: "TELEGRAM_CHANNEL_REQUIRED",
        }
      }

      assertAllowedPath(filePath)

      if (!existsSync(filePath)) {
        return {
          success: false,
          output: `File not found: "${filePath}"`,
          error: "ENOENT",
        }
      }

      const stat = statSync(filePath)

      if (!stat.isFile()) {
        return {
          success: false,
          output: `"${filePath}" is not a file`,
          error: "EISDIR",
        }
      }

      if (stat.size > MAX_FILE_SIZE) {
        return {
          success: false,
          output: `File is too large: ${stat.size} bytes (max 50MB)`,
          error: "FILE_TOO_LARGE",
        }
      }

      const caption = params.caption
      const marker = caption !== undefined
        ? `FILE_SEND:${filePath}:${caption}`
        : `FILE_SEND:${filePath}:`

      return {
        success: true,
        output: marker,
        details: { filePath, size: stat.size, source: ctx.source },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `Error preparing file: ${msg}`, error: msg }
    }
  },
}
