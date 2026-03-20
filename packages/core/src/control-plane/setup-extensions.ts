import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { getConfig, type NobieConfig } from "../config/index.js"
import type { McpServerConfig, SkillConfigItem } from "../config/types.js"
import { McpStdioClient } from "../mcp/client.js"
import { mcpRegistry } from "../mcp/registry.js"

export type SetupCapabilityStatus = "ready" | "disabled" | "planned" | "error"

export interface SetupMcpServerDraft {
  id: string
  name: string
  transport: "stdio" | "http"
  command: string
  argsText: string
  cwd: string
  url: string
  required: boolean
  enabled: boolean
  status: SetupCapabilityStatus
  reason?: string
  tools: string[]
}

export interface SetupSkillDraftItem {
  id: string
  label: string
  description: string
  source: "local" | "builtin"
  path: string
  enabled: boolean
  required: boolean
  status: SetupCapabilityStatus
  reason?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("~/")) {
    return `${homedir()}/${trimmed.slice(2)}`
  }
  return trimmed
}

function evaluateSkill(item: SkillConfigItem): { status: SetupCapabilityStatus; reason?: string } {
  if (!item.enabled) {
    return { status: "disabled" }
  }

  if (item.source === "builtin") {
    return { status: "ready" }
  }

  const path = normalizePath(item.path ?? "")
  if (!path) {
    return { status: "error", reason: "로컬 Skill 경로를 입력해야 합니다." }
  }

  if (!existsSync(path)) {
    return { status: "error", reason: "입력한 Skill 경로를 찾을 수 없습니다." }
  }

  const stat = statSync(path)
  if (!stat.isDirectory() && !stat.isFile()) {
    return { status: "error", reason: "Skill 경로는 파일 또는 폴더여야 합니다." }
  }

  return {
    status: "ready",
    reason: stat.isDirectory() ? "로컬 Skill 폴더를 찾았습니다." : "로컬 Skill 파일을 찾았습니다.",
  }
}

export function buildMcpSetupDraft(config: NobieConfig = getConfig()): { servers: SetupMcpServerDraft[] } {
  const statuses = new Map(mcpRegistry.getStatuses().map((status) => [status.name, status]))
  const servers = Object.entries(config.mcp?.servers ?? {}).map(([name, serverConfig]) => {
    const status = statuses.get(name)
    return {
      id: name,
      name,
      transport: serverConfig.transport ?? (serverConfig.url ? "http" : "stdio"),
      command: serverConfig.command ?? "",
      argsText: (serverConfig.args ?? []).join("\n"),
      cwd: serverConfig.cwd ?? "",
      url: serverConfig.url ?? "",
      required: Boolean(serverConfig.required),
      enabled: serverConfig.enabled !== false,
      status: status
        ? status.ready
          ? "ready"
          : status.error
            ? "error"
            : "disabled"
        : "disabled",
      ...(status?.error ? { reason: status.error } : {}),
      tools: status?.tools.map((tool) => tool.name) ?? [],
    } satisfies SetupMcpServerDraft
  })

  return { servers }
}

export function persistMcpSetupDraft(raw: Record<string, unknown>, draft: { servers: SetupMcpServerDraft[] }): void {
  const rawMcp = raw.mcp && typeof raw.mcp === "object" && !Array.isArray(raw.mcp)
    ? (raw.mcp as Record<string, unknown>)
    : {}

  const servers = Object.fromEntries(
    draft.servers
      .filter((server) => server.name.trim())
      .map((server) => {
        const config: McpServerConfig = {
          enabled: server.enabled,
          transport: server.transport,
          required: server.required,
        }

        if (server.transport === "stdio") {
          const command = server.command.trim()
          const args = server.argsText
            .split(/\n+/)
            .map((value) => value.trim())
            .filter(Boolean)
          const cwd = server.cwd.trim()

          if (command) config.command = command
          if (args.length > 0) config.args = args
          if (cwd) config.cwd = cwd
        } else {
          const url = server.url.trim()
          if (url) config.url = url
        }

        return [server.name.trim(), config]
      }),
  )

  raw.mcp = {
    ...rawMcp,
    servers,
  }
}

export async function testMcpServerConnection(server: SetupMcpServerDraft): Promise<{ ok: boolean; message: string; tools: string[] }> {
  if (server.transport === "http") {
    return {
      ok: false,
      message: "HTTP 방식(MCP HTTP)은 아직 준비 중입니다. 지금은 stdio 방식만 사용할 수 있습니다.",
      tools: [],
    }
  }

  if (!server.command.trim()) {
    return { ok: false, message: "실행 명령(Command)을 입력해야 합니다.", tools: [] }
  }

  const args = server.argsText
    .split(/\n+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const cwd = server.cwd.trim()

  const config: McpServerConfig = {
    enabled: true,
    transport: "stdio",
    command: server.command.trim(),
    startupTimeoutSec: 10,
    toolTimeoutSec: 30,
  }
  if (args.length > 0) config.args = args
  if (cwd) config.cwd = cwd

  const client = new McpStdioClient({
    name: server.name || "setup_test",
    config,
  })

  try {
    await client.initialize()
    const tools = await client.listTools()
    return {
      ok: true,
      message: tools.length > 0
        ? `연결 성공: 도구 ${tools.length}개를 확인했습니다.`
        : "연결은 성공했지만, 표시할 도구가 없습니다.",
      tools: tools.map((tool) => tool.name),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      tools: [],
    }
  } finally {
    await client.close()
  }
}

export function buildSkillsSetupDraft(config: NobieConfig = getConfig()): { items: SetupSkillDraftItem[] } {
  const items = (config.skills?.items ?? []).map((item) => {
    const evaluation = evaluateSkill(item)
    return {
      id: item.id,
      label: item.label,
      description: item.description,
      source: item.source,
      path: item.path ?? "",
      enabled: item.enabled,
      required: Boolean(item.required),
      status: evaluation.status,
      ...(evaluation.reason ? { reason: evaluation.reason } : {}),
    } satisfies SetupSkillDraftItem
  })

  return { items }
}

export function persistSkillsSetupDraft(raw: Record<string, unknown>, draft: { items: SetupSkillDraftItem[] }): void {
  raw.skills = {
    items: draft.items
      .filter((item) => item.label.trim())
      .map((item) => {
        const nextItem: SkillConfigItem = {
          id: item.id,
          label: item.label.trim(),
          description: item.description.trim(),
          source: item.source,
          enabled: item.enabled,
          required: item.required,
        }
        const path = item.path.trim()
        if (path) nextItem.path = path
        return nextItem
      }),
  }
}

export function testSkillPath(path: string): { ok: boolean; message: string; resolvedPath?: string } {
  const resolvedPath = normalizePath(path)
  if (!resolvedPath) {
    return { ok: false, message: "Skill 경로를 입력해야 합니다." }
  }

  if (!existsSync(resolvedPath)) {
    return { ok: false, message: "입력한 Skill 경로를 찾을 수 없습니다.", resolvedPath }
  }

  const stat = statSync(resolvedPath)
  if (!stat.isDirectory() && !stat.isFile()) {
    return { ok: false, message: "Skill 경로는 파일 또는 폴더여야 합니다.", resolvedPath }
  }

  return {
    ok: true,
    message: stat.isDirectory() ? "Skill 폴더를 확인했습니다." : "Skill 파일을 확인했습니다.",
    resolvedPath,
  }
}

export function cloneMcpDraft(value: { servers: SetupMcpServerDraft[] }): { servers: SetupMcpServerDraft[] } {
  return clone(value)
}

export function cloneSkillsDraft(value: { items: SetupSkillDraftItem[] }): { items: SetupSkillDraftItem[] } {
  return clone(value)
}
