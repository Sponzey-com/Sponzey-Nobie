import { getConfig, reloadConfig, type NobieConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { recordExtensionFailure, recordExtensionRegistryChange, recordExtensionToolFailure } from "../security/extension-governance.js"
import { sanitizeUserFacingError } from "../runs/error-sanitizer.js"
import { toolDispatcher, type AgentTool } from "../tools/index.js"
import type { ToolResult } from "../tools/types.js"
import { McpStdioClient, type McpDiscoveredTool, type McpServerConfig, type McpTransport } from "./client.js"

const log = createLogger("mcp:registry")

export interface McpToolStatus {
  name: string
  registeredName: string
  description: string
}

export interface McpServerStatus {
  name: string
  transport: McpTransport
  enabled: boolean
  required: boolean
  ready: boolean
  toolCount: number
  registeredToolCount: number
  command?: string
  url?: string
  error?: string
  tools: McpToolStatus[]
}

export interface McpSummary {
  serverCount: number
  readyCount: number
  toolCount: number
  requiredFailures: number
}

interface RegistryEntry {
  client: McpStdioClient | null
  toolNames: string[]
  status: McpServerStatus
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "tool"
}

export function toRegisteredToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeSegment(serverName)}__${sanitizeSegment(toolName)}`
}

function filterTools(tools: McpDiscoveredTool[], config: McpServerConfig): McpDiscoveredTool[] {
  const enabledTools = new Set((config.enabledTools ?? []).map((item) => item.trim()).filter(Boolean))
  const disabledTools = new Set((config.disabledTools ?? []).map((item) => item.trim()).filter(Boolean))

  return tools.filter((tool) => {
    if (enabledTools.size > 0 && !enabledTools.has(tool.name)) return false
    if (disabledTools.has(tool.name)) return false
    return true
  })
}

class McpRegistry {
  private readonly entries = new Map<string, RegistryEntry>()

  async loadFromConfig(config: NobieConfig = getConfig()): Promise<void> {
    await this.closeAll()

    for (const [name, serverConfig] of Object.entries(config.mcp?.servers ?? {})) {
      await this.loadServer(name, serverConfig)
    }
  }

  async reloadFromConfig(): Promise<McpServerStatus[]> {
    reloadConfig()
    await this.loadFromConfig(getConfig())
    return this.getStatuses()
  }

  getStatuses(): McpServerStatus[] {
    return [...this.entries.values()]
      .map((entry) => ({
        ...entry.status,
        tools: entry.status.tools.map((tool) => ({ ...tool })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  getSummary(): McpSummary {
    const statuses = this.getStatuses()
    return {
      serverCount: statuses.length,
      readyCount: statuses.filter((entry) => entry.ready).length,
      toolCount: statuses.reduce((sum, entry) => sum + entry.registeredToolCount, 0),
      requiredFailures: statuses.filter((entry) => entry.required && !entry.ready).length,
    }
  }

  async closeAll(): Promise<void> {
    for (const [name, entry] of this.entries) {
      this.unregisterTools(entry.toolNames)
      if (entry.client) {
        await entry.client.close()
      }
      log.info(`closed MCP server ${name}`)
    }
    this.entries.clear()
  }

  private async loadServer(name: string, config: McpServerConfig): Promise<void> {
    const enabled = config.enabled !== false
    const transport = config.transport ?? (config.url ? "http" : "stdio")
    const baseStatus: McpServerStatus = {
      name,
      transport,
      enabled,
      required: Boolean(config.required),
      ready: false,
      toolCount: 0,
      registeredToolCount: 0,
      ...(config.command?.trim() ? { command: config.command.trim() } : {}),
      ...(config.url?.trim() ? { url: config.url.trim() } : {}),
      tools: [],
    }

    if (!enabled) {
      this.entries.set(name, {
        client: null,
        toolNames: [],
        status: { ...baseStatus, error: "설정에서 비활성화된 MCP 서버입니다." },
      })
      return
    }

    if (transport === "http" || config.url?.trim()) {
      this.entries.set(name, {
        client: null,
        toolNames: [],
        status: {
          ...baseStatus,
          error: "HTTP MCP transport는 아직 구현되지 않았습니다. stdio 기반 MCP server를 사용하세요.",
        },
      })
      return
    }

    if (!config.command?.trim()) {
      this.entries.set(name, {
        client: null,
        toolNames: [],
        status: { ...baseStatus, error: "command가 설정되지 않아 MCP 서버를 시작할 수 없습니다." },
      })
      return
    }

    const client = new McpStdioClient({
      name,
      config,
      onExit: (error) => {
        const entry = this.entries.get(name)
        if (!entry) return
        this.unregisterTools(entry.toolNames)
        entry.toolNames = []
        recordExtensionFailure({
          extensionId: `mcp:${name}`,
          kind: "mcp_server",
          error,
          detail: { transport, required: Boolean(config.required) },
        })
        entry.status = {
          ...entry.status,
          ready: false,
          registeredToolCount: 0,
          error,
        }
      },
    })

    try {
      await client.initialize()
      const discovered = filterTools(await client.listTools(), config)
      const tools = this.registerTools(name, client, discovered)
      this.entries.set(name, {
        client,
        toolNames: tools.map((tool) => tool.registeredName),
        status: {
          ...baseStatus,
          ready: true,
          toolCount: discovered.length,
          registeredToolCount: tools.length,
          tools,
        },
      })
      recordExtensionRegistryChange({
        action: "mcp_server_loaded",
        extensionId: `mcp:${name}`,
        result: "success",
        detail: { toolCount: tools.length, transport },
      })
      log.info(`loaded MCP server ${name} with ${tools.length} tools`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordExtensionFailure({
        extensionId: `mcp:${name}`,
        kind: "mcp_server",
        error: message,
        detail: { transport, required: Boolean(config.required) },
      })
      this.entries.set(name, {
        client,
        toolNames: [],
        status: { ...baseStatus, error: message },
      })
      await client.close()
      log.error(`failed to load MCP server ${name}: ${message}`)
    }
  }

  private registerTools(name: string, client: McpStdioClient, tools: McpDiscoveredTool[]): McpToolStatus[] {
    const registered: McpToolStatus[] = []

    for (const tool of tools) {
      const registeredName = toRegisteredToolName(name, tool.name)
      const bridge: AgentTool<Record<string, unknown>> = {
        name: registeredName,
        description: tool.description
          ? `[MCP:${name}] ${tool.description}`
          : `[MCP:${name}] ${tool.name}`,
        parameters: tool.inputSchema,
        riskLevel: "moderate",
        requiresApproval: false,
        execute: async (params, ctx): Promise<ToolResult> => {
          try {
            const result = await client.callTool(tool.name, params, ctx.signal)
            if (result.isError) {
              recordExtensionToolFailure({
                toolName: registeredName,
                error: result.output,
                runId: ctx.runId,
                requestGroupId: ctx.requestGroupId ?? null,
                detail: { serverName: name, toolName: tool.name, isError: true },
              })
            }
            return {
              success: !result.isError,
              output: result.output,
              details: result.details,
              ...(result.isError ? { error: result.output } : {}),
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const sanitized = sanitizeUserFacingError(message)
            recordExtensionToolFailure({
              toolName: registeredName,
              error: message,
              runId: ctx.runId,
              requestGroupId: ctx.requestGroupId ?? null,
              detail: { serverName: name, toolName: tool.name },
            })
            return {
              success: false,
              output: `MCP tool error: ${sanitized.userMessage}`,
              error: sanitized.userMessage,
            }
          }
        },
      }

      toolDispatcher.register(bridge)
      registered.push({
        name: tool.name,
        registeredName,
        description: tool.description,
      })
    }

    return registered
  }

  private unregisterTools(toolNames: string[]): void {
    for (const toolName of toolNames) {
      toolDispatcher.unregister(toolName)
    }
  }
}

export const mcpRegistry = new McpRegistry()
