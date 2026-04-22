import crypto from "node:crypto"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { getConfig } from "../config/index.js"
import { getDb } from "../db/index.js"
import { hashApprovalParams } from "../runs/approval-registry.js"
import type { RiskLevel, ToolContext } from "../tools/types.js"
import { evaluateAgentToolCapabilityPolicy } from "./capability-isolation.js"
import { sourceToTrustTag, type TrustTag } from "./trust-boundary.js"

export type ToolPolicyDecision = "allow" | "deny"

export interface ToolPolicyDecisionRecord {
  id: string
  runId?: string
  requestGroupId?: string
  sessionId?: string
  channel?: string
  toolName: string
  riskLevel: RiskLevel
  sourceTrust: TrustTag
  approvalId?: string
  permissionScope: string
  paramsHash: string
  decision: ToolPolicyDecision
  reasonCode: string
  userMessage?: string
  diagnostic?: Record<string, unknown>
  createdAt: number
}

export interface EvaluateToolPolicyInput {
  toolName: string
  riskLevel: RiskLevel
  params: Record<string, unknown>
  ctx: ToolContext
  approvalId?: string
  approvalDecision?: "allow_once" | "allow_run"
}

const LOCAL_MUTATION_TOOLS = new Set([
  "shell_exec",
  "file_write",
  "file_patch",
  "file_delete",
  "process_kill",
  "app_launch",
  "keyboard_type",
  "keyboard_shortcut",
  "keyboard_action",
  "mouse_move",
  "mouse_click",
  "mouse_action",
  "window_focus",
  "screen_capture",
  "screen_find_text",
  "yeonjang_camera_capture",
])

export function evaluateAndRecordToolPolicy(input: EvaluateToolPolicyInput): ToolPolicyDecisionRecord {
  const evaluated = evaluateToolPolicy(input)
  recordToolPolicyDecision(evaluated)
  return evaluated
}

export function evaluateToolPolicy(input: EvaluateToolPolicyInput): ToolPolicyDecisionRecord {
  const sourceTrust = sourceToTrustTag(input.ctx.source)
  const paramsHash = hashApprovalParams(input.params)
  const createdAt = Date.now()
  const base: Omit<ToolPolicyDecisionRecord, "permissionScope" | "decision" | "reasonCode" | "userMessage" | "diagnostic"> = {
    id: crypto.randomUUID(),
    ...(input.ctx.runId ? { runId: input.ctx.runId } : {}),
    ...(input.ctx.requestGroupId ? { requestGroupId: input.ctx.requestGroupId } : {}),
    ...(input.ctx.sessionId ? { sessionId: input.ctx.sessionId } : {}),
    ...(input.ctx.source ? { channel: input.ctx.source } : {}),
    toolName: input.toolName,
    riskLevel: input.riskLevel,
    sourceTrust,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    paramsHash,
    createdAt,
  }

  const capability = evaluateAgentToolCapabilityPolicy({
    toolName: input.toolName,
    riskLevel: input.riskLevel,
    ctx: input.ctx,
  })
  if (!capability.allowed) {
    return {
      ...base,
      permissionScope: capability.agentId ? `agent:${capability.agentId}` : "agent:missing",
      decision: "deny",
      reasonCode: capability.reasonCode,
      ...(capability.userMessage ? { userMessage: capability.userMessage } : {}),
      diagnostic: {
        capabilityPolicy: capability.diagnostic,
        capabilityRisk: capability.capabilityRisk,
      },
    }
  }

  const permission = resolvePermissionScope(input.toolName, input.params)
  if (!permission.allowed) {
    return {
      ...base,
      permissionScope: permission.scope,
      decision: "deny",
      reasonCode: permission.reasonCode,
      ...(permission.userMessage ? { userMessage: permission.userMessage } : {}),
      ...(permission.diagnostic ? { diagnostic: permission.diagnostic } : {}),
    }
  }

  const legacyModerateApprovalRequired = capability.reasonCode === "legacy_no_agent_context" && input.riskLevel === "moderate"
  if ((legacyModerateApprovalRequired || input.riskLevel === "dangerous" || LOCAL_MUTATION_TOOLS.has(input.toolName) || capability.approvalRequired) && !input.approvalDecision) {
    return {
      ...base,
      permissionScope: permission.scope,
      decision: "deny",
      reasonCode: "approval_required",
      userMessage: "이 작업은 실행 전 승인이 필요합니다.",
      diagnostic: {
        riskLevel: input.riskLevel,
        toolName: input.toolName,
        capabilityPolicy: capability.diagnostic,
        capabilityRisk: capability.capabilityRisk,
      },
    }
  }

  return {
    ...base,
    permissionScope: permission.scope,
    decision: "allow",
    reasonCode: input.approvalDecision ? `approval_${input.approvalDecision}` : "safe_tool",
    diagnostic: {
      riskLevel: input.riskLevel,
      sourceTrust,
      permissionScope: permission.scope,
      capabilityPolicy: capability.diagnostic,
      capabilityRisk: capability.capabilityRisk,
    },
  }
}

export function recordToolPolicyDecision(record: ToolPolicyDecisionRecord): void {
  getDb().prepare(
    `INSERT INTO tool_policy_decisions
     (id, run_id, request_group_id, session_id, channel, tool_name, risk_level, source_trust,
      approval_id, permission_scope, params_hash, decision, reason_code, user_message, diagnostic_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.runId ?? null,
    record.requestGroupId ?? null,
    record.sessionId ?? null,
    record.channel ?? null,
    record.toolName,
    record.riskLevel,
    record.sourceTrust,
    record.approvalId ?? null,
    record.permissionScope,
    record.paramsHash,
    record.decision,
    record.reasonCode,
    record.userMessage ?? null,
    record.diagnostic ? JSON.stringify(record.diagnostic) : null,
    record.createdAt,
  )
}

export function sanitizePolicyDenialForUser(record: ToolPolicyDecisionRecord): string {
  if (record.userMessage?.trim()) return record.userMessage
  switch (record.reasonCode) {
    case "path_not_allowed":
      return "허용된 작업 경로 밖이라 실행하지 않았습니다."
    case "command_not_allowed":
      return "허용되지 않은 명령이라 실행하지 않았습니다."
    case "approval_required":
      return "이 작업은 실행 전 승인이 필요합니다."
    case "agent_context_required":
      return "에이전트 실행 컨텍스트가 없어 도구를 실행하지 않았습니다."
    case "permission_profile_required":
      return "에이전트 권한 프로필이 없어 도구를 실행하지 않았습니다."
    case "secret_scope_required":
      return "MCP 도구 실행에는 에이전트 전용 secret scope가 필요합니다."
    case "audit_id_required":
      return "MCP 도구 실행에는 audit id가 필요합니다."
    case "mcp_server_not_allowed":
      return "이 에이전트에 허용되지 않은 MCP 서버입니다."
    case "tool_not_allowed":
      return "이 에이전트에 허용되지 않은 도구입니다."
    case "risk_exceeds_profile":
    case "shell_execution_not_allowed":
    case "filesystem_write_not_allowed":
    case "external_network_not_allowed":
    case "screen_control_not_allowed":
      return "에이전트 권한 프로필이 이 도구 실행을 허용하지 않습니다."
    default:
      return "보안 정책에 따라 요청한 도구 실행을 진행하지 않았습니다."
  }
}

function resolvePermissionScope(toolName: string, params: Record<string, unknown>): {
  allowed: boolean
  scope: string
  reasonCode: string
  userMessage?: string
  diagnostic?: Record<string, unknown>
} {
  if (toolName.startsWith("file_")) {
    const path = typeof params.path === "string" ? params.path : undefined
    if (!path && typeof params.patch !== "string") return { allowed: true, scope: "file:patch", reasonCode: "file_patch_scope" }
    if (!path) return { allowed: true, scope: "file:unspecified", reasonCode: "file_scope_unknown" }
    const allowed = isPathAllowed(path)
    return allowed.allowed
      ? { allowed: true, scope: `file:${allowed.scope}`, reasonCode: "path_allowed" }
      : {
          allowed: false,
          scope: "file:denied",
          reasonCode: "path_not_allowed",
          userMessage: "허용된 작업 경로 밖이라 실행하지 않았습니다.",
          diagnostic: { path, allowedRoots: allowed.allowedRoots },
        }
  }

  if (toolName === "shell_exec") {
    const command = typeof params.command === "string" ? params.command.trim() : ""
    const configured = getConfig().security.allowedCommands.map((item) => item.trim()).filter(Boolean)
    if (configured.length === 0) return { allowed: true, scope: "shell:approval_only", reasonCode: "command_allowlist_empty" }
    const firstToken = command.split(/\s+/)[0] ?? ""
    const allowed = configured.includes(firstToken) || configured.some((prefix) => command.startsWith(prefix))
    return allowed
      ? { allowed: true, scope: `shell:${firstToken}`, reasonCode: "command_allowed" }
      : {
          allowed: false,
          scope: "shell:denied",
          reasonCode: "command_not_allowed",
          userMessage: "허용되지 않은 명령이라 실행하지 않았습니다.",
          diagnostic: { firstToken, configuredCount: configured.length },
        }
  }

  return { allowed: true, scope: LOCAL_MUTATION_TOOLS.has(toolName) ? "local:approval_only" : "safe:default", reasonCode: "default_scope" }
}

function isPathAllowed(filePath: string): { allowed: boolean; scope: string; allowedRoots: string[] } {
  const home = homedir()
  const resolved = resolve(filePath.replace(/^~/, home))
  const configured = getConfig().security.allowedPaths
  const roots = configured.length > 0
    ? configured.map((item) => resolve(item.replace(/^~/, home)))
    : [home]
  const allowedRoot = roots.find((root) => resolved === root || resolved.startsWith(`${root}/`))
  return { allowed: Boolean(allowedRoot), scope: allowedRoot ?? "none", allowedRoots: roots }
}
