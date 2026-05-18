import { getDefaultModel, getProvider, type AIProvider } from "../ai/index.js"
import type { Message } from "../ai/types.js"
import { getConfig } from "../config/index.js"
import {
  clearAgentMemoryStateLatestCapsule,
  getMessages,
  getMessagesForRequestGroup,
  getMemoryCapsule,
  insertDiagnosticEvent,
  listAgentMemoryStatesForAgent,
  listMemoryCapsuleRollups,
  listMemoryCompactionRuns,
  listMemoryRecallEvents,
  listRecentAgentMemoryStates,
  type MemoryCapsuleRollupSnapshot,
  type MemoryCompactionRunSnapshot,
  type MemoryRecallEventSnapshot,
} from "../db/index.js"
import type { AgentMemoryState } from "./agent-state.js"
import { buildMemoryQualitySnapshot } from "./quality.js"
import type { MemoryCapsule } from "./capsule.js"
import {
  buildRootSessionCompactionReasonCodes,
  estimateContextTokens,
  executeRootSessionCompaction,
  extractRootSessionDeterministicState,
} from "./compaction.js"
import { buildMaintenanceRestoreContext, renderMaintenanceRestorePromptBlock } from "./retrieval-restore.js"

export type MemoryInspectorDriftState = "ok" | "warning"
export type MemoryInspectorControlAction =
  | "dry_run_compaction"
  | "latest_capsule_inspect"
  | "rollup_inspect"
  | "safe_restore"
  | "force_compaction"
  | "capsule_invalidate"

export interface MemoryInspectorOwnerCard {
  ownerScopeKey: string
  ownerType: AgentMemoryState["ownerScope"]["ownerType"]
  ownerId: string
  sessionId: string
  requestGroupId?: string
  lineageId?: string
  channelKey?: string
  threadKey?: string
  nicknameSnapshot?: string
  latestCapsuleId?: string
  currentRawTokenEstimate: number
  currentRawMessageCount: number
  latestCapsuleAgeMs: number | null
  activeCapsuleChainDepth: number
  latestRollupAgeMs: number | null
  lastCompactionReason: string | null
  pendingPreservationCount: number
  recallHitCount: number
  driftWarningState: MemoryInspectorDriftState
  driftWarningCodes: string[]
  lastCompactionAt: number | null
  compactionBlockReason: string | null
}

export interface MemoryInspectorConfiguredPolicy {
  explicitModelId: string | null
  fallbackModelId: string | null
  minContextTokens: number
}

export interface MemoryInspectorCompactPreview {
  sourceMessageCount: number
  tailMessageCount: number
  degradedTailMessageCount: number | null
  droppedRawCount: number
  headRange: { start: number; end: number; count: number } | null
  capsuleSummary: string | null
  preservedPinnedItems: string[]
  reasonCodes: string[]
  validationSummary: string | null
  modelAudit: Record<string, unknown> | null
}

export interface MemoryInspectorSummary {
  owners: number
  warningOwners: number
  recallEvents: number
  compactionRuns: number
  latestCapsuleAt: number | null
  latestRollupAt: number | null
  qualityStatus: "healthy" | "degraded"
}

export interface MemoryInspectorSnapshot {
  generatedAt: number
  filters: {
    ownerType: AgentMemoryState["ownerScope"]["ownerType"] | null
    ownerId: string | null
    sessionId: string | null
    requestGroupId: string | null
    limit: number
  }
  configuredPolicy: MemoryInspectorConfiguredPolicy
  summary: MemoryInspectorSummary
  ownerCards: MemoryInspectorOwnerCard[]
  selectedOwnerScopeKey: string | null
  latestCapsule: MemoryCapsule | null
  latestRollup: MemoryCapsuleRollupSnapshot | null
  recentCompactionRuns: MemoryCompactionRunSnapshot[]
  recallTrace: MemoryRecallEventSnapshot[]
  compactPreview: MemoryInspectorCompactPreview | null
  maintenanceRestorePromptBlock: string | null
  controls: Array<{ action: MemoryInspectorControlAction; enabled: boolean; reason: string }>
}

export interface MemoryInspectorControlResult {
  action: MemoryInspectorControlAction
  enabled: boolean
  reason: string
  compactPreview?: MemoryInspectorCompactPreview | null
  latestCapsule?: MemoryCapsule | null
  latestRollup?: MemoryCapsuleRollupSnapshot | null
  maintenanceRestorePromptBlock?: string | null
}

function clampLimit(value: number | undefined, fallback = 8): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(50, Math.floor(value ?? fallback))) : fallback
}

function capsuleChainDepth(capsule: MemoryCapsule | null): number {
  let depth = 0
  const seen = new Set<string>()
  let current = capsule
  while (current && !seen.has(current.capsuleId) && depth < 64) {
    seen.add(current.capsuleId)
    depth += 1
    current = current.parentCapsuleId ? getMemoryCapsule(current.parentCapsuleId) ?? null : null
  }
  return depth
}

function selectOwnerStates(input: {
  ownerType?: AgentMemoryState["ownerScope"]["ownerType"]
  ownerId?: string
  sessionId?: string
  requestGroupId?: string
  limit: number
}): AgentMemoryState[] {
  if (input.ownerType && input.ownerId) {
    return listAgentMemoryStatesForAgent({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      limit: input.limit,
    })
  }
  return listRecentAgentMemoryStates({
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    limit: input.limit,
  })
}

function buildDriftWarningCodes(input: {
  state: AgentMemoryState
  latestCapsule: MemoryCapsule | null
  latestRun: MemoryCompactionRunSnapshot | null
}): string[] {
  const codes: string[] = []
  if (!input.latestCapsule && input.state.currentRawTokenEstimate >= 120_000) {
    codes.push("raw_context_high_without_capsule")
  }
  if (input.state.compactionBlockReason) {
    codes.push(`compaction_blocked:${input.state.compactionBlockReason}`)
  }
  if (input.latestCapsule && !input.latestRun) {
    codes.push("capsule_without_compaction_audit")
  }
  if (
    input.latestRun?.metadata
    && typeof input.latestRun.metadata["compactionModelAudit"] !== "object"
  ) {
    codes.push("missing_model_audit")
  }
  return codes
}

function buildCompactPreview(input: {
  latestRun: MemoryCompactionRunSnapshot | null
  latestCapsule: MemoryCapsule | null
}): MemoryInspectorCompactPreview | null {
  if (!input.latestRun) return null
  const metadata = input.latestRun.metadata ?? {}
  const sourceMessageCount = Number(metadata["sourceMessageCount"] ?? 0)
  const tailMessageCount = Number(metadata["tailMessageCount"] ?? 0)
  const degradedTailMessageCount = metadata["degradedTailMessageCount"] == null
    ? null
    : Number(metadata["degradedTailMessageCount"])
  const droppedRawCount = Math.max(0, sourceMessageCount - tailMessageCount)
  const headCount = droppedRawCount
  return {
    sourceMessageCount,
    tailMessageCount,
    degradedTailMessageCount,
    droppedRawCount,
    headRange: headCount > 0 ? { start: 0, end: headCount - 1, count: headCount } : null,
    capsuleSummary: input.latestCapsule?.summary ?? null,
    preservedPinnedItems: [
      ...(input.latestCapsule?.activeObjectives ?? []),
      ...(input.latestCapsule?.constraints ?? []),
      ...(input.latestCapsule?.pendingItems ?? []),
    ].slice(0, 12),
    reasonCodes: input.latestRun.triggerReasonCodes,
    validationSummary: input.latestRun.validationSummary ?? null,
    modelAudit:
      metadata["compactionModelAudit"] && typeof metadata["compactionModelAudit"] === "object"
        ? metadata["compactionModelAudit"] as Record<string, unknown>
        : null,
  }
}

function buildOwnerScopeFromCard(card: MemoryInspectorOwnerCard): AgentMemoryState["ownerScope"] {
  return {
    ownerType: card.ownerType,
    ownerId: card.ownerId,
    sessionId: card.sessionId,
    ...(card.requestGroupId ? { requestGroupId: card.requestGroupId } : {}),
    ...(card.lineageId ? { lineageId: card.lineageId } : {}),
    ...(card.channelKey ? { channelKey: card.channelKey } : {}),
    ...(card.threadKey ? { threadKey: card.threadKey } : {}),
  }
}

function parseStoredMessageContent(serialized: string, fallback: string): Message["content"] {
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (typeof parsed === "string" || Array.isArray(parsed)) return parsed as Message["content"]
  } catch {
    // Fall back to plain text content when historical rows are not valid JSON.
  }
  return fallback
}

function sanitizeInspectorMessages(messages: Message[]): Message[] {
  const sanitized: Message[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (
      message.role === "assistant"
      && Array.isArray(message.content)
      && message.content.some((block) => block.type === "tool_use")
    ) {
      const next = messages[index + 1]
      const nextHasToolResults =
        next != null
        && Array.isArray(next.content)
        && next.content.some((block) => block.type === "tool_result")
      if (!nextHasToolResults) {
        const textOnly = message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .filter(Boolean)
          .join("\n")
        if (textOnly) sanitized.push({ role: "assistant", content: textOnly })
        continue
      }
    }
    sanitized.push(message)
  }
  return sanitized
}

function loadInspectorMessagesForOwner(card: MemoryInspectorOwnerCard): Message[] {
  if (card.ownerType !== "main_agent") return []
  const rows = card.requestGroupId
    ? getMessagesForRequestGroup(card.sessionId, card.requestGroupId)
    : getMessages(card.sessionId)
  const raw = rows.map((row) => ({
    role: row.role as Message["role"],
    content: row.tool_calls ? parseStoredMessageContent(row.tool_calls, row.content) : row.content,
  }))
  return sanitizeInspectorMessages(raw)
}

function buildInspectorSnapshotInput(input: {
  ownerType?: AgentMemoryState["ownerScope"]["ownerType"]
  ownerId?: string
  sessionId?: string
  requestGroupId?: string
  limit?: number
  now?: number
}): Parameters<typeof buildMemoryInspectorSnapshot>[0] {
  return {
    ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  }
}

export function buildMemoryInspectorSnapshot(input: {
  ownerType?: AgentMemoryState["ownerScope"]["ownerType"]
  ownerId?: string
  sessionId?: string
  requestGroupId?: string
  limit?: number
  now?: number
} = {}): MemoryInspectorSnapshot {
  const now = input.now ?? Date.now()
  const limit = clampLimit(input.limit)
  const config = getConfig()
  const configuredPolicy: MemoryInspectorConfiguredPolicy = {
    explicitModelId: config.memory.compaction?.modelId?.trim() || null,
    fallbackModelId: config.memory.compaction?.fallbackModelId?.trim() || null,
    minContextTokens: Math.max(512, Math.floor(config.memory.compaction?.minContextTokens ?? 3000)),
  }
  const ownerStates = selectOwnerStates({
    ...(input.ownerType ? { ownerType: input.ownerType } : {}),
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    limit,
  })
  const ownerCards = ownerStates.map((state) => {
    const latestCapsule = state.latestCapsuleId ? getMemoryCapsule(state.latestCapsuleId) ?? null : null
    const latestRun = listMemoryCompactionRuns({
      ownerType: state.ownerScope.ownerType,
      ownerId: state.ownerScope.ownerId,
      ...(state.ownerScope.sessionId ? { sessionId: state.ownerScope.sessionId } : {}),
      ...(state.ownerScope.requestGroupId ? { requestGroupId: state.ownerScope.requestGroupId } : {}),
      ...(state.ownerScope.lineageId ? { lineageId: state.ownerScope.lineageId } : {}),
      limit: 1,
    })[0] ?? null
    const latestRollup = listMemoryCapsuleRollups({
      ownerType: state.ownerScope.ownerType,
      ownerId: state.ownerScope.ownerId,
      ...(state.ownerScope.sessionId ? { sessionId: state.ownerScope.sessionId } : {}),
      ...(state.ownerScope.requestGroupId ? { requestGroupId: state.ownerScope.requestGroupId } : {}),
      ...(state.ownerScope.lineageId ? { lineageId: state.ownerScope.lineageId } : {}),
      limit: 1,
    })[0] ?? null
    const recallHitCount = listMemoryRecallEvents({
      ownerType: state.ownerScope.ownerType,
      ownerId: state.ownerScope.ownerId,
      ...(state.ownerScope.sessionId ? { sessionId: state.ownerScope.sessionId } : {}),
      ...(state.ownerScope.requestGroupId ? { requestGroupId: state.ownerScope.requestGroupId } : {}),
      limit: 200,
    }).length
    const driftWarningCodes = buildDriftWarningCodes({ state, latestCapsule, latestRun })
    return {
      ownerScopeKey: state.ownerScopeKey,
      ownerType: state.ownerScope.ownerType,
      ownerId: state.ownerScope.ownerId,
      sessionId: state.ownerScope.sessionId,
      ...(state.ownerScope.requestGroupId ? { requestGroupId: state.ownerScope.requestGroupId } : {}),
      ...(state.ownerScope.lineageId ? { lineageId: state.ownerScope.lineageId } : {}),
      ...(state.ownerScope.channelKey ? { channelKey: state.ownerScope.channelKey } : {}),
      ...(state.ownerScope.threadKey ? { threadKey: state.ownerScope.threadKey } : {}),
      ...(state.nicknameSnapshot ? { nicknameSnapshot: state.nicknameSnapshot } : {}),
      ...(state.latestCapsuleId ? { latestCapsuleId: state.latestCapsuleId } : {}),
      currentRawTokenEstimate: state.currentRawTokenEstimate,
      currentRawMessageCount: state.currentRawMessageCount,
      latestCapsuleAgeMs: latestCapsule ? Math.max(0, now - latestCapsule.createdAt) : null,
      activeCapsuleChainDepth: capsuleChainDepth(latestCapsule),
      latestRollupAgeMs: latestRollup ? Math.max(0, now - latestRollup.createdAt) : null,
      lastCompactionReason: latestRun?.triggerReasonCodes[0] ?? null,
      pendingPreservationCount: latestCapsule?.pendingItems.length ?? 0,
      recallHitCount,
      driftWarningState: driftWarningCodes.length > 0 ? "warning" : "ok",
      driftWarningCodes,
      lastCompactionAt: state.lastCompactionAt ?? null,
      compactionBlockReason: state.compactionBlockReason ?? null,
    } satisfies MemoryInspectorOwnerCard
  })

  const selectedOwner = ownerCards[0] ?? null
  const latestCapsule = selectedOwner?.latestCapsuleId
    ? getMemoryCapsule(selectedOwner.latestCapsuleId) ?? null
    : null
  const latestRollup = selectedOwner
    ? listMemoryCapsuleRollups({
        ownerType: selectedOwner.ownerType,
        ownerId: selectedOwner.ownerId,
        sessionId: selectedOwner.sessionId,
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
        ...(selectedOwner.lineageId ? { lineageId: selectedOwner.lineageId } : {}),
        limit: 1,
      })[0] ?? null
    : null
  const recentCompactionRuns = selectedOwner
    ? listMemoryCompactionRuns({
        ownerType: selectedOwner.ownerType,
        ownerId: selectedOwner.ownerId,
        sessionId: selectedOwner.sessionId,
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
        ...(selectedOwner.lineageId ? { lineageId: selectedOwner.lineageId } : {}),
        limit,
      })
    : []
  const recallTrace = selectedOwner
    ? listMemoryRecallEvents({
        ownerType: selectedOwner.ownerType,
        ownerId: selectedOwner.ownerId,
        sessionId: selectedOwner.sessionId,
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
        limit,
      })
    : []
  const compactPreview = buildCompactPreview({
    latestRun: recentCompactionRuns[0] ?? null,
    latestCapsule,
  })
  const restoreContext = selectedOwner
    ? buildMaintenanceRestoreContext({
        ownerScope: {
          ownerType: selectedOwner.ownerType,
          ownerId: selectedOwner.ownerId,
          sessionId: selectedOwner.sessionId,
          ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
          ...(selectedOwner.lineageId ? { lineageId: selectedOwner.lineageId } : {}),
          ...(selectedOwner.channelKey ? { channelKey: selectedOwner.channelKey } : {}),
          ...(selectedOwner.threadKey ? { threadKey: selectedOwner.threadKey } : {}),
        },
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
      })
    : null
  const maintenanceRestorePromptBlock = restoreContext
    ? renderMaintenanceRestorePromptBlock(restoreContext) ?? null
    : null
  const quality = buildMemoryQualitySnapshot()
  const latestCapsuleAt = ownerCards
    .map((card) => (card.latestCapsuleAgeMs != null ? now - card.latestCapsuleAgeMs : null))
    .filter((value): value is number => value != null)
    .sort((left, right) => right - left)[0] ?? null
  const latestRollupAt = ownerCards
    .map((card) => (card.latestRollupAgeMs != null ? now - card.latestRollupAgeMs : null))
    .filter((value): value is number => value != null)
    .sort((left, right) => right - left)[0] ?? null
  const configuredExecutionModel = getDefaultModel().trim()
  const canForceCompaction = Boolean(
    selectedOwner
      && selectedOwner.ownerType === "main_agent"
      && selectedOwner.sessionId
      && configuredExecutionModel,
  )
  const canInvalidateCapsule = Boolean(selectedOwner?.latestCapsuleId)

  return {
    generatedAt: now,
    filters: {
      ownerType: input.ownerType ?? null,
      ownerId: input.ownerId ?? null,
      sessionId: input.sessionId ?? null,
      requestGroupId: input.requestGroupId ?? null,
      limit,
    },
    configuredPolicy,
    summary: {
      owners: ownerCards.length,
      warningOwners: ownerCards.filter((card) => card.driftWarningState === "warning").length,
      recallEvents: recallTrace.length,
      compactionRuns: recentCompactionRuns.length,
      latestCapsuleAt,
      latestRollupAt,
      qualityStatus: quality.status,
    },
    ownerCards,
    selectedOwnerScopeKey: selectedOwner?.ownerScopeKey ?? null,
    latestCapsule,
    latestRollup,
    recentCompactionRuns,
    recallTrace,
    compactPreview,
    maintenanceRestorePromptBlock,
    controls: [
      { action: "dry_run_compaction", enabled: compactPreview !== null, reason: compactPreview ? "preview_available" : "no_compaction_audit" },
      { action: "latest_capsule_inspect", enabled: latestCapsule !== null, reason: latestCapsule ? "capsule_available" : "no_latest_capsule" },
      { action: "rollup_inspect", enabled: latestRollup !== null, reason: latestRollup ? "rollup_available" : "no_rollup_capsule" },
      { action: "safe_restore", enabled: Boolean(maintenanceRestorePromptBlock), reason: maintenanceRestorePromptBlock ? "restore_preview_available" : "no_restore_context" },
      { action: "force_compaction", enabled: canForceCompaction, reason: canForceCompaction ? "root_session_force_available" : "no_configured_compaction_provider" },
      { action: "capsule_invalidate", enabled: canInvalidateCapsule, reason: canInvalidateCapsule ? "capsule_pointer_clear_available" : "no_latest_capsule" },
    ],
  }
}

export async function runMemoryInspectorControl(input: {
  action: MemoryInspectorControlAction
  ownerType?: AgentMemoryState["ownerScope"]["ownerType"]
  ownerId?: string
  sessionId?: string
  requestGroupId?: string
  limit?: number
  provider?: AIProvider
  model?: string
  now?: number
}): Promise<MemoryInspectorControlResult> {
  const snapshot = buildMemoryInspectorSnapshot(buildInspectorSnapshotInput(input))
  const control = snapshot.controls.find((item) => item.action === input.action)
  if (!control) {
    return { action: input.action, enabled: false, reason: "unknown_action" }
  }
  if (!control.enabled) return { action: input.action, enabled: false, reason: control.reason }
  const selectedOwner = snapshot.ownerCards[0] ?? null
  switch (input.action) {
    case "dry_run_compaction":
      return { action: input.action, enabled: true, reason: control.reason, compactPreview: snapshot.compactPreview }
    case "latest_capsule_inspect":
      return { action: input.action, enabled: true, reason: control.reason, latestCapsule: snapshot.latestCapsule }
    case "rollup_inspect":
      return { action: input.action, enabled: true, reason: control.reason, latestRollup: snapshot.latestRollup }
    case "safe_restore":
      return {
        action: input.action,
        enabled: true,
        reason: control.reason,
        maintenanceRestorePromptBlock: snapshot.maintenanceRestorePromptBlock,
      }
    case "force_compaction": {
      if (!selectedOwner || selectedOwner.ownerType !== "main_agent") {
        return { action: input.action, enabled: false, reason: "main_agent_root_session_only" }
      }
      const model = input.model?.trim() || getDefaultModel().trim()
      if (!model) {
        return { action: input.action, enabled: false, reason: "no_configured_compaction_model" }
      }
      const messages = loadInspectorMessagesForOwner(selectedOwner)
      if (messages.length === 0) {
        return { action: input.action, enabled: false, reason: "no_active_window_messages" }
      }
      let provider: AIProvider
      try {
        provider = input.provider ?? getProvider()
      } catch (error) {
        return {
          action: input.action,
          enabled: false,
          reason: error instanceof Error ? error.message : "provider_resolution_failed",
        }
      }
      const sourceTokenEstimate = Math.max(
        selectedOwner.currentRawTokenEstimate,
        estimateContextTokens(messages),
      )
      const deterministicState = extractRootSessionDeterministicState({
        messages,
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
      })
      const result = await executeRootSessionCompaction({
        provider,
        model,
        sessionId: selectedOwner.sessionId,
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
        messages,
        sourceTokenEstimate,
        triggerReasonCodes: buildRootSessionCompactionReasonCodes({
          messages,
          totalTokens: sourceTokenEstimate,
          deterministicState,
        }),
      })
      insertDiagnosticEvent({
        kind: "memory_inspector_force_compaction",
        summary: "Manual force compaction executed from memory inspector.",
        sessionId: selectedOwner.sessionId,
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
        detail: {
          ownerScope: buildOwnerScopeFromCard(selectedOwner),
          capsuleId: result.capsuleId,
          compactionRunId: result.compactionRunId,
          sourceMessageCount: result.sourceMessageCount,
          tailMessageCount: result.tailMessageCount,
        },
      })
      const refreshed = buildMemoryInspectorSnapshot(buildInspectorSnapshotInput(input))
      return {
        action: input.action,
        enabled: true,
        reason: "compaction_written",
        compactPreview: refreshed.compactPreview,
        latestCapsule: refreshed.latestCapsule,
      }
    }
    case "capsule_invalidate":
      if (!selectedOwner?.latestCapsuleId) {
        return { action: input.action, enabled: false, reason: "no_latest_capsule" }
      }
      clearAgentMemoryStateLatestCapsule({
        ownerScopeKey: selectedOwner.ownerScopeKey,
        compactionBlockReason: "manually_invalidated_from_inspector",
        ...(input.now !== undefined ? { updatedAt: input.now } : {}),
      })
      insertDiagnosticEvent({
        kind: "memory_inspector_capsule_invalidate",
        summary: "Manual capsule pointer invalidation executed from memory inspector.",
        sessionId: selectedOwner.sessionId,
        ...(selectedOwner.requestGroupId ? { requestGroupId: selectedOwner.requestGroupId } : {}),
        detail: {
          ownerScope: buildOwnerScopeFromCard(selectedOwner),
          invalidatedCapsuleId: selectedOwner.latestCapsuleId,
        },
      })
      return {
        action: input.action,
        enabled: true,
        reason: "capsule_pointer_cleared",
      }
    default:
      return { action: input.action, enabled: false, reason: "unsupported_control" }
  }
}
