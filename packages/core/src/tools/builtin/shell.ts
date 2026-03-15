import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { resolve } from "node:path"
import type { AgentTool, ToolContext, ToolResult } from "../types.js"

const MAX_OUTPUT_CHARS = 100_000
const DEFAULT_TIMEOUT_SEC = 300

interface ShellExecParams {
  command: string
  workDir?: string
  timeoutSec?: number
  env?: Record<string, string>
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

function sanitizeEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  // Start from a clean minimal env rather than passing full process.env
  // to prevent accidental credential leakage
  const base: NodeJS.ProcessEnv = {
    HOME: homedir(),
    PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    TERM: "xterm-256color",
    LANG: process.env["LANG"] ?? "en_US.UTF-8",
  }
  // Pass through safe variables
  const safeKeys = ["USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "XDG_RUNTIME_DIR"]
  for (const key of safeKeys) {
    if (process.env[key]) base[key] = process.env[key]
  }
  // Merge caller-supplied extras (overrides allowed)
  if (extra) Object.assign(base, extra)
  return base
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

    const timeoutMs = (params.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000
    const env = sanitizeEnv(params.env)

    const isWindows = process.platform === "win32"
    const shell = isWindows ? "cmd.exe" : "/bin/sh"
    const shellArgs = isWindows ? ["/c", params.command] : ["-c", params.command]

    ctx.onProgress(`Running: ${params.command}`)

    return new Promise<ToolResult>((resolve) => {
      let stdout = ""
      let stderr = ""
      let timedOut = false

      const child = spawn(shell, shellArgs, {
        cwd: workDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      })

      const timer = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
        setTimeout(() => child.kill("SIGKILL"), 3000)
      }, timeoutMs)

      ctx.signal.addEventListener("abort", () => {
        child.kill("SIGTERM")
        setTimeout(() => child.kill("SIGKILL"), 1000)
      }, { once: true })

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8")
        stdout += text
        if (stdout.length + stderr.length <= MAX_OUTPUT_CHARS) {
          ctx.onProgress(text.trim())
        }
      })

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8")
      })

      child.on("close", (code) => {
        clearTimeout(timer)

        let combined = ""
        if (stdout) combined += stdout
        if (stderr) combined += (combined ? "\n[stderr]\n" : "") + stderr

        if (combined.length > MAX_OUTPUT_CHARS) {
          combined =
            combined.slice(0, MAX_OUTPUT_CHARS) +
            `\n\n[Truncated: output exceeded ${MAX_OUTPUT_CHARS} chars]`
        }

        if (timedOut) {
          resolve({
            success: false,
            output: combined || "(no output before timeout)",
            error: `Command timed out after ${params.timeoutSec ?? DEFAULT_TIMEOUT_SEC}s`,
          })
          return
        }

        const result: import("../types.js").ToolResult = {
          success: code === 0,
          output: combined || "(no output)",
          details: { exitCode: code },
        }
        if (code !== 0) result.error = `Exit code: ${code}`
        resolve(result)
      })

      child.on("error", (err) => {
        clearTimeout(timer)
        resolve({ success: false, output: `Failed to spawn: ${err.message}`, error: err.message })
      })
    })
  },
}
