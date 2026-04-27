import { type NobieConfig, getConfig, reloadConfig } from "../config/index.js"
import type { CapabilityPolicy, SkillMcpAllowlist } from "../contracts/sub-agent-orchestration.js"
import { createLogger } from "../logger/index.js"
import { sanitizeUserFacingError } from "../runs/error-sanitizer.js"
import {
  type AgentCapabilityCallContext,
  isMcpServerAllowed,
  isToolAllowedBySkillMcpAllowlist,
  parseMcpRegisteredToolName,
  toAgentCapabilityCallContext,
} from "../security/capability-isolation.js"
import {
  recordExtensionFailure,
  recordExtensionRegistryChange,
  recordExtensionToolFailure,
} from "../security/extension-governance.js"
import { type AgentTool, toolDispatcher } from "../tools/index.js"
import type { ToolResult } from "../tools/types.js"
import {
  type McpDiscoveredTool,
  type McpServerConfig,
  McpStdioClient,
  type McpTransport,
} from "./client.js"

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
  agentSessionCount?: number
  tools: McpToolStatus[]
}

export interface McpSummary {
  serverCount: number
  readyCount: number
  toolCount: number
  requiredFailures: number
}

export function filterMcpStatusesForAgentAllowlist(
  statuses: McpServerStatus[],
  input: SkillMcpAllowlist | CapabilityPolicy,
): McpServerStatus[] {
  const allowlist = "skillMcpAllowlist" in input ? input.skillMcpAllowlist : input
  return statuses
    .filter(
      (status) =>
        isMcpServerAllowed({ serverId: sanitizeSegment(status.name), allowlist }) ||
        isMcpServerAllowed({ serverId: status.name, allowlist }),
    )
    .map((status) => {
      const tools = status.tools.filter((tool) => {
        const mcpTool = parseMcpRegisteredToolName(tool.registeredName)
        return isToolAllowedBySkillMcpAllowlist({
          toolName: tool.registeredName,
          allowlist,
          mcpTool,
        })
      })
      return {
        ...status,
        registeredToolCount: tools.length,
        toolCount: tools.length,
        tools,
      }
    })
}

interface RegistryEntry {
  client: McpStdioClient | null
  config: McpServerConfig
  agentClients: Map<string, McpStdioClient>
  toolNames: string[]
  status: McpServerStatus
}

function sanitizeSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool"
  )
}

export function toRegisteredToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeSegment(serverName)}__${sanitizeSegment(toolName)}`
}

function filterTools(tools: McpDiscoveredTool[], config: McpServerConfig): McpDiscoveredTool[] {
  const enabledTools = new Set(
    (config.enabledTools ?? []).map((item) => item.trim()).filter(Boolean),
  )
  const disabledTools = new Set(
    (config.disabledTools ?? []).map((item) => item.trim()).filter(Boolean),
  )

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
        agentSessionCount: entry.agentClients.size,
        tools: entry.status.tools.map((tool) => ({ ...tool })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  getAgentScopedStatuses(input: SkillMcpAllowlist | CapabilityPolicy): McpServerStatus[] {
    return filterMcpStatusesForAgentAllowlist(this.getStatuses(), input)
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
      for (const agentClient of entry.agentClients.values()) {
        await agentClient.close()
      }
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
        config,
        agentClients: new Map(),
        toolNames: [],
        status: { ...baseStatus, error: "설정에서 비활성화된 MCP 서버입니다." },
      })
      return
    }

    if (transport === "http" || config.url?.trim()) {
      this.entries.set(name, {
        client: null,
        config,
        agentClients: new Map(),
        toolNames: [],
        status: {
          ...baseStatus,
          error:
            "HTTP MCP transport는 아직 구현되지 않았습니다. stdio 기반 MCP server를 사용하세요.",
        },
      })
      return
    }

    if (!config.command?.trim()) {
      this.entries.set(name, {
        client: null,
        config,
        agentClients: new Map(),
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
      const tools = this.registerTools(name, discovered)
      this.entries.set(name, {
        client,
        config,
        agentClients: new Map(),
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
        config,
        agentClients: new Map(),
        toolNames: [],
        status: { ...baseStatus, error: message },
      })
      await client.close()
      log.error(`failed to load MCP server ${name}: ${message}`)
    }
  }

  private registerTools(name: string, tools: McpDiscoveredTool[]): McpToolStatus[] {
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
            const agentContext = toAgentCapabilityCallContext(ctx)
            if (!agentContext) {
              return {
                success: false,
                output: "MCP tool error: agent-scoped MCP call context is required.",
                error: "agent_mcp_context_required",
                details: {
                  kind: "mcp_context_required",
                  serverName: name,
                  toolName: tool.name,
                },
              }
            }
            const result = await this.callAgentScopedTool({
              serverName: name,
              registeredName,
              toolName: tool.name,
              params,
              agentContext,
              signal: ctx.signal,
            })
            if (result.isError) {
              recordExtensionToolFailure({
                toolName: registeredName,
                error: result.output,
                runId: ctx.runId,
                requestGroupId: ctx.requestGroupId ?? null,
                detail: {
                  serverName: name,
                  toolName: tool.name,
                  isError: true,
                  agentId: ctx.agentId ?? null,
                },
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

  private agentSessionKey(input: {
    serverName: string
    registeredName: string
    context: AgentCapabilityCallContext
  }): string {
    return [
      `server:${input.serverName}`,
      `agent:${input.context.agentId}`,
      `binding:${input.context.bindingId ?? input.registeredName}`,
      `secret:${input.context.secretScopeId}`,
    ].join("|")
  }

  private async getAgentClient(input: {
    serverName: string
    registeredName: string
    context: AgentCapabilityCallContext
  }): Promise<{ key: string; client: McpStdioClient }> {
    const entry = this.entries.get(input.serverName)
    if (!entry?.client) {
      throw new Error(`MCP server "${input.serverName}" is not ready.`)
    }
    const key = this.agentSessionKey(input)
    const existing = entry.agentClients.get(key)
    if (existing) return { key, client: existing }

    const client = new McpStdioClient({
      name: `${input.serverName}:${input.context.agentId}`,
      config: entry.config,
      onExit: (error) => {
        entry.agentClients.delete(key)
        recordExtensionToolFailure({
          toolName: input.registeredName,
          error,
          ...(input.context.runId ? { runId: input.context.runId } : {}),
          requestGroupId: input.context.requestGroupId ?? null,
          detail: {
            serverName: input.serverName,
            agentId: input.context.agentId,
            bindingId: input.context.bindingId ?? null,
            agentSessionKey: key,
          },
        })
      },
    })
    await client.initialize()
    entry.agentClients.set(key, client)
    entry.status = { ...entry.status, agentSessionCount: entry.agentClients.size }
    return { key, client }
  }

  private async callAgentScopedTool(input: {
    serverName: string
    registeredName: string
    toolName: string
    params: Record<string, unknown>
    agentContext: AgentCapabilityCallContext
    signal: AbortSignal
  }) {
    const session = await this.getAgentClient({
      serverName: input.serverName,
      registeredName: input.registeredName,
      context: input.agentContext,
    })
    return session.client.callTool(
      input.toolName,
      input.params,
      { ...input.agentContext, clientSessionId: session.key },
      input.signal,
    )
  }

  getAgentSessionSnapshot(): Array<{
    serverName: string
    sessionKey: string
    agentId: string
    bindingId?: string
    secretScopeId: string
  }> {
    const rows: Array<{
      serverName: string
      sessionKey: string
      agentId: string
      bindingId?: string
      secretScopeId: string
    }> = []
    for (const [serverName, entry] of this.entries) {
      for (const sessionKey of entry.agentClients.keys()) {
        const parts = Object.fromEntries(
          sessionKey.split("|").map((part) => {
            const index = part.indexOf(":")
            return index >= 0 ? [part.slice(0, index), part.slice(index + 1)] : [part, ""]
          }),
        )
        rows.push({
          serverName,
          sessionKey,
          agentId: parts.agent ?? "",
          ...(parts.binding ? { bindingId: parts.binding } : {}),
          secretScopeId: parts.secret ?? "",
        })
      }
    }
    return rows.sort((a, b) => a.sessionKey.localeCompare(b.sessionKey))
  }

  private unregisterTools(toolNames: string[]): void {
    for (const toolName of toolNames) {
      toolDispatcher.unregister(toolName)
    }
  }
}

export const mcpRegistry = new McpRegistry()
