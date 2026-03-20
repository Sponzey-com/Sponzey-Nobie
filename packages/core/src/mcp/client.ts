import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createLogger } from "../logger/index.js"

const log = createLogger("mcp:client")
const DEFAULT_PROTOCOL_VERSION = "2024-11-05"

export type McpTransport = "stdio" | "http"

export interface McpServerConfig {
  enabled?: boolean
  transport?: McpTransport
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  required?: boolean
  startupTimeoutSec?: number
  toolTimeoutSec?: number
  enabledTools?: string[]
  disabledTools?: string[]
}

export interface McpDiscoveredTool {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface McpToolCallResult {
  output: string
  details: unknown
  isError: boolean
}

interface JsonRpcSuccess {
  jsonrpc?: string
  id?: number | string
  result?: unknown
}

interface JsonRpcError {
  jsonrpc?: string
  id?: number | string
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

type JsonRpcMessage = JsonRpcSuccess | JsonRpcError | Record<string, unknown>

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function normalizeInputSchema(value: unknown): McpDiscoveredTool["inputSchema"] {
  const raw = toObject(value)
  const properties = toObject(raw.properties)
  const required = toStringArray(raw.required)
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function extractToolOutput(payload: unknown): string {
  const raw = toObject(payload)
  const textParts = toArray(raw.content)
    .map((item) => {
      const row = toObject(item)
      if (row.type === "text" && typeof row.text === "string") return row.text
      if (row.type === "image" && typeof row.mimeType === "string") return `[image:${row.mimeType}]`
      if (row.type === "resource" && typeof row.uri === "string") return `[resource:${row.uri}]`
      return ""
    })
    .filter((value) => value.trim().length > 0)

  if (textParts.length > 0) {
    return textParts.join("\n").trim()
  }

  return JSON.stringify(payload, null, 2)
}

export class McpStdioClient {
  private readonly name: string
  private readonly config: McpServerConfig
  private readonly onExit: ((error: string) => void) | undefined
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = Buffer.alloc(0)
  private requestId = 0
  private initialized = false
  private pending = new Map<number, PendingRequest>()
  private closedByUser = false

  constructor(options: { name: string; config: McpServerConfig; onExit?: (error: string) => void }) {
    this.name = options.name
    this.config = options.config
    this.onExit = options.onExit
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.ensureProcess()

    await this.request(
      "initialize",
      {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        clientInfo: {
          name: "nobie",
          version: "0.1.0",
        },
        capabilities: {},
      },
      this.startupTimeoutMs(),
    )

    await this.notify("notifications/initialized", {})
    this.initialized = true
  }

  async listTools(): Promise<McpDiscoveredTool[]> {
    await this.initialize()
    const response = toObject(await this.request("tools/list", {}, this.toolTimeoutMs()))
    return toArray(response.tools)
      .map((tool) => {
        const row = toObject(tool)
        if (typeof row.name !== "string" || !row.name.trim()) return null
        return {
          name: row.name.trim(),
          description: typeof row.description === "string" ? row.description.trim() : "",
          inputSchema: normalizeInputSchema(row.inputSchema),
        } satisfies McpDiscoveredTool
      })
      .filter((tool): tool is McpDiscoveredTool => tool !== null)
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult> {
    await this.initialize()
    const response = await this.request(
      "tools/call",
      { name, arguments: args },
      this.toolTimeoutMs(),
      signal,
    )
    const payload = toObject(response)
    return {
      output: extractToolOutput(payload),
      details: payload,
      isError: Boolean(payload.isError),
    }
  }

  async close(): Promise<void> {
    this.closedByUser = true
    this.initialized = false
    this.rejectAll(new Error(`MCP server "${this.name}" was closed.`))

    const child = this.process
    this.process = null
    if (!child) return

    child.stdout.removeAllListeners()
    child.stderr.removeAllListeners()
    child.removeAllListeners()

    if (!child.killed) {
      child.kill()
    }
  }

  private async ensureProcess(): Promise<void> {
    if (this.process) return
    const command = this.config.command?.trim()
    if (!command) {
      throw new Error(`MCP server "${this.name}" command가 비어 있습니다.`)
    }

    const child = spawn(command, this.config.args ?? [], {
      cwd: this.config.cwd || process.cwd(),
      env: {
        ...process.env,
        ...(this.config.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
      this.consumeFrames()
    })

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim()
      if (text) log.warn(`[${this.name}] ${text}`)
    })

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error)
      this.rejectAll(new Error(`MCP server "${this.name}" process error: ${message}`))
      if (!this.closedByUser) {
        this.onExit?.(`MCP server "${this.name}" process error: ${message}`)
      }
    })

    child.on("exit", (code, signal) => {
      this.process = null
      this.initialized = false
      const message = code !== null
        ? `MCP server "${this.name}" exited with code ${code}.`
        : `MCP server "${this.name}" exited with signal ${signal ?? "unknown"}.`
      this.rejectAll(new Error(message))
      if (!this.closedByUser) {
        this.onExit?.(message)
      }
    })

    this.closedByUser = false
    this.process = child
    log.info(`started MCP stdio server ${this.name}`)
  }

  private consumeFrames(): void {
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return

      const header = this.stdoutBuffer.subarray(0, headerEnd).toString("utf8")
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        this.stdoutBuffer = this.stdoutBuffer.subarray(headerEnd + 4)
        continue
      }

      const bodyLength = Number(match[1])
      const totalLength = headerEnd + 4 + bodyLength
      if (this.stdoutBuffer.length < totalLength) return

      const body = this.stdoutBuffer.subarray(headerEnd + 4, totalLength).toString("utf8")
      this.stdoutBuffer = this.stdoutBuffer.subarray(totalLength)

      try {
        const message = JSON.parse(body) as JsonRpcMessage
        this.handleMessage(message)
      } catch (error) {
        log.warn(`failed to parse MCP message from ${this.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (typeof message.id !== "number") return
    const pending = this.pending.get(message.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pending.delete(message.id)

    const maybeError = (message as JsonRpcError).error
    if (maybeError) {
      pending.reject(new Error(maybeError.message ?? `MCP request ${message.id} failed.`))
      return
    }

    pending.resolve((message as JsonRpcSuccess).result)
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.ensureProcess()
    const child = this.process
    if (!child) throw new Error(`MCP server "${this.name}" process is not available.`)

    const payload = JSON.stringify({ jsonrpc: "2.0", method, params })
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`)
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return new Promise(async (resolve, reject) => {
      try {
        await this.ensureProcess()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      const child = this.process
      if (!child) {
        reject(new Error(`MCP server "${this.name}" process is not available.`))
        return
      }

      const id = ++this.requestId
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params })
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${this.name}:${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timeout })

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            const pending = this.pending.get(id)
            if (!pending) return
            clearTimeout(pending.timeout)
            this.pending.delete(id)
            reject(new Error(`MCP ${this.name}:${method} was aborted.`))
          },
          { once: true },
        )
      }

      child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`)
    })
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private startupTimeoutMs(): number {
    return Math.max(1, this.config.startupTimeoutSec ?? 10) * 1000
  }

  private toolTimeoutMs(): number {
    return Math.max(1, this.config.toolTimeoutSec ?? 30) * 1000
  }
}
