import { homedir } from "node:os"
import { resolve } from "node:path"
import type { AgentTool, ToolContext, ToolResult } from "../types.js"
import { canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../yeonjang/mqtt-client.js"

const DEFAULT_TIMEOUT_SEC = 300

interface ShellExecParams {
  command: string
  workDir?: string
  timeoutSec?: number
  env?: Record<string, string>
}

interface YeonjangCommandExecutionResult {
  success: boolean
  exit_code?: number
  stdout: string
  stderr: string
}

// Simple obfuscation patterns to reject
const OBFUSCATION_PATTERNS = [
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /base64\s*-d/i,
  /\bpython[23]?\s+-c\s+["'].*base64/i,
  /\$\(\s*echo\s+[A-Za-z0-9+/=]+\s*\|/,
]

function detectObfuscation(command: string): string | null {
  for (const pattern of OBFUSCATION_PATTERNS) {
    if (pattern.test(command)) {
      return `Potentially obfuscated command detected (pattern: ${pattern.source})`
    }
  }
  return null
}

function yeonjangRequiredFailure(method: string): ToolResult {
  return {
    success: false,
    output: `이 작업은 Yeonjang 연장을 통해서만 실행할 수 있습니다. 현재 연결된 연장이 \`${method}\` 메서드를 지원하지 않거나 연결되어 있지 않습니다.`,
    error: "YEONJANG_REQUIRED",
    details: {
      requiredExecutor: "yeonjang",
      requiredMethod: method,
    },
  }
}

export const shellExecTool: AgentTool<ShellExecParams> = {
  name: "shell_exec",
  description:
    "Execute a shell command on the local machine. " +
    "Use this for running scripts, installing packages, querying system state, etc. " +
    "Output is captured and returned. Long-running commands will be killed after the timeout.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute (passed to /bin/sh -c on Unix, cmd.exe on Windows)",
      },
      workDir: {
        type: "string",
        description: "Working directory. Defaults to the session work directory.",
      },
      timeoutSec: {
        type: "number",
        description: `Timeout in seconds. Default: ${DEFAULT_TIMEOUT_SEC}`,
      },
      env: {
        type: "object",
        description: "Additional environment variables to set",
        additionalProperties: { type: "string" },
      },
    },
    required: ["command"],
  },
  riskLevel: "dangerous",
  requiresApproval: true,

  async execute(params, ctx: ToolContext): Promise<ToolResult> {
    const obfuscation = detectObfuscation(params.command)
    if (obfuscation) {
      return {
        success: false,
        output: `Command rejected: ${obfuscation}`,
        error: "obfuscation_detected",
      }
    }

    const workDir = params.workDir
      ? resolve(params.workDir.replace(/^~/, homedir()))
      : ctx.workDir

    try {
      if (await canYeonjangHandleMethod("system.exec")) {
        ctx.onProgress(`Yeonjang에서 명령 실행: ${params.command}`)
        const remote = await invokeYeonjangMethod<YeonjangCommandExecutionResult>(
          "system.exec",
          {
            command: params.command,
            args: [],
            cwd: workDir,
            shell: true,
            ...(params.env ? { env: params.env } : {}),
            timeout_sec: params.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
          },
          { timeoutMs: (params.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000 },
        )
        const combined = [remote.stdout, remote.stderr ? `[stderr]\n${remote.stderr}` : ""].filter(Boolean).join("\n")
        return {
          success: remote.success,
          output: combined || "(no output)",
          details: { via: "yeonjang", exitCode: remote.exit_code ?? null },
          ...(remote.success ? {} : { error: remote.exit_code != null ? `Exit code: ${remote.exit_code}` : "remote execution failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 명령 실행 실패: ${message}`, error: message }
      }
    }
    return yeonjangRequiredFailure("system.exec")
  },
}
