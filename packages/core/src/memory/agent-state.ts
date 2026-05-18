import { randomUUID } from "node:crypto"
import type {
  StructuredTaskScope,
  SubSessionMemoryBootstrap,
  SubSessionMemoryOwnerScope,
} from "../contracts/sub-agent-orchestration.js"
import { normalizeNicknameSnapshot } from "../contracts/sub-agent-orchestration.js"
import type { MemoryCapsule } from "./capsule.js"
import { normalizeMemoryCapsuleOwnerScope } from "./capsule.js"

export const ROOT_MAIN_AGENT_ID = "agent:nobie"

export interface AgentMemoryState {
  stateId: string
  ownerScope: SubSessionMemoryOwnerScope
  ownerScopeKey: string
  nicknameSnapshot?: string
  latestCapsuleId?: string
  currentRawTokenEstimate: number
  currentRawMessageCount: number
  lastCompactionAt?: number
  compactionBlockReason?: string
  createdAt: number
  updatedAt: number
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeStringArray(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const next = normalizeString(value)
    if (!next || seen.has(next)) continue
    seen.add(next)
    normalized.push(next)
  }
  return normalized
}

function estimateTextTokens(value: string): number {
  const normalized = value.trim()
  if (!normalized) return 0
  return Math.max(1, Math.ceil(normalized.length / 4))
}

export function normalizeSubSessionMemoryOwnerScope(
  scope: SubSessionMemoryOwnerScope,
): SubSessionMemoryOwnerScope {
  const normalized = normalizeMemoryCapsuleOwnerScope(scope) as SubSessionMemoryOwnerScope
  return {
    ownerType: normalized.ownerType,
    ownerId: normalized.ownerId,
    sessionId: normalized.sessionId ?? scope.sessionId.trim(),
    ...(normalized.requestGroupId ? { requestGroupId: normalized.requestGroupId } : {}),
    ...(normalized.lineageId ? { lineageId: normalized.lineageId } : {}),
    ...(normalized.channelKey ? { channelKey: normalized.channelKey } : {}),
    ...(normalized.threadKey ? { threadKey: normalized.threadKey } : {}),
  }
}

export function buildAgentMemoryStateScopeKey(scope: SubSessionMemoryOwnerScope): string {
  const normalized = normalizeSubSessionMemoryOwnerScope(scope)
  return [
    normalized.ownerType,
    normalized.ownerId,
    normalized.sessionId,
    normalized.requestGroupId ?? "*",
    normalized.lineageId ?? "*",
    normalized.channelKey ?? "*",
    normalized.threadKey ?? "*",
  ].join("|")
}

export function buildMainAgentMemoryStateScope(input: {
  sessionId: string
  requestGroupId?: string
  lineageId?: string
  channelKey?: string
  threadKey?: string
  agentId?: string
}): SubSessionMemoryOwnerScope {
  return normalizeSubSessionMemoryOwnerScope({
    ownerType: "main_agent",
    ownerId: normalizeString(input.agentId) ?? ROOT_MAIN_AGENT_ID,
    sessionId: input.sessionId,
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    ...(input.lineageId ? { lineageId: input.lineageId } : {}),
    ...(input.channelKey ? { channelKey: input.channelKey } : {}),
    ...(input.threadKey ? { threadKey: input.threadKey } : {}),
  })
}

export function buildSubAgentMemoryStateScope(input: {
  agentId: string
  sessionId: string
  requestGroupId?: string
  lineageId?: string
  channelKey?: string
  threadKey?: string
}): SubSessionMemoryOwnerScope {
  return normalizeSubSessionMemoryOwnerScope({
    ownerType: "sub_agent",
    ownerId: input.agentId,
    sessionId: input.sessionId,
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    ...(input.lineageId ? { lineageId: input.lineageId } : {}),
    ...(input.channelKey ? { channelKey: input.channelKey } : {}),
    ...(input.threadKey ? { threadKey: input.threadKey } : {}),
  })
}

export function normalizeAgentMemoryState(input: AgentMemoryState): AgentMemoryState {
  const ownerScope = normalizeSubSessionMemoryOwnerScope(input.ownerScope)
  const nicknameSnapshot = normalizeString(input.nicknameSnapshot)
  const latestCapsuleId = normalizeString(input.latestCapsuleId)
  const compactionBlockReason = normalizeString(input.compactionBlockReason)
  return {
    stateId: normalizeString(input.stateId) ?? input.stateId,
    ownerScope,
    ownerScopeKey: buildAgentMemoryStateScopeKey(ownerScope),
    ...(nicknameSnapshot ? { nicknameSnapshot } : {}),
    ...(latestCapsuleId ? { latestCapsuleId } : {}),
    currentRawTokenEstimate: Number.isFinite(input.currentRawTokenEstimate)
      ? Math.max(0, Math.floor(input.currentRawTokenEstimate))
      : 0,
    currentRawMessageCount: Number.isFinite(input.currentRawMessageCount)
      ? Math.max(0, Math.floor(input.currentRawMessageCount))
      : 0,
    ...(input.lastCompactionAt !== undefined && Number.isFinite(input.lastCompactionAt)
      ? { lastCompactionAt: Math.floor(input.lastCompactionAt) }
      : {}),
    ...(compactionBlockReason ? { compactionBlockReason } : {}),
    createdAt: Number.isFinite(input.createdAt) ? Math.floor(input.createdAt) : Date.now(),
    updatedAt: Number.isFinite(input.updatedAt) ? Math.floor(input.updatedAt) : Date.now(),
  }
}

export function buildAgentMemoryStateFromCapsule(input: {
  capsule: MemoryCapsule
  currentRawTokenEstimate: number
  currentRawMessageCount: number
  compactionBlockReason?: string
  now?: number
}): AgentMemoryState | undefined {
  const capsule = input.capsule
  if (capsule.ownerScope.ownerType !== "main_agent" && capsule.ownerScope.ownerType !== "sub_agent") {
    return undefined
  }
  const now = input.now ?? Date.now()
  const ownerScope = normalizeSubSessionMemoryOwnerScope({
    ownerType: capsule.ownerScope.ownerType,
    ownerId: capsule.ownerScope.ownerId,
    sessionId: capsule.ownerScope.sessionId ?? capsule.ownerScope.ownerId,
    ...(capsule.ownerScope.requestGroupId ? { requestGroupId: capsule.ownerScope.requestGroupId } : {}),
    ...(capsule.ownerScope.lineageId ? { lineageId: capsule.ownerScope.lineageId } : {}),
    ...(capsule.ownerScope.channelKey ? { channelKey: capsule.ownerScope.channelKey } : {}),
    ...(capsule.ownerScope.threadKey ? { threadKey: capsule.ownerScope.threadKey } : {}),
  })
  return normalizeAgentMemoryState({
    stateId: randomUUID(),
    ownerScope,
    ownerScopeKey: buildAgentMemoryStateScopeKey(ownerScope),
    ...(capsule.nicknameSnapshot ? { nicknameSnapshot: capsule.nicknameSnapshot } : {}),
    latestCapsuleId: capsule.capsuleId,
    currentRawTokenEstimate: input.currentRawTokenEstimate,
    currentRawMessageCount: input.currentRawMessageCount,
    lastCompactionAt: capsule.createdAt,
    ...(input.compactionBlockReason ? { compactionBlockReason: input.compactionBlockReason } : {}),
    createdAt: now,
    updatedAt: now,
  })
}

function buildBootstrapPinnedItems(taskScope: StructuredTaskScope): string[] {
  return normalizeStringArray([
    `goal:${taskScope.goal}`,
    ...taskScope.constraints.map((item) => `constraint:${item}`),
    ...taskScope.expectedOutputs.map((item) => `expected_output:${item.outputId}`),
  ])
}

export function buildChildOwnMemoryBootstrap(input: {
  agentId: string
  nicknameSnapshot?: string
  sessionId: string
  requestGroupId: string
  lineageId: string
  taskScope: StructuredTaskScope
  additionalContextRefs: string[]
  sourceProvenanceRefs?: string[]
  latestCapsuleId?: string
  handoffExchangeId?: string
  feedbackExchangeId?: string
  latestSafeContextSummary?: string
  additionalPinnedItems?: string[]
  channelKey?: string
  threadKey?: string
  now?: number
}): SubSessionMemoryBootstrap {
  const ownerScope = buildSubAgentMemoryStateScope({
    agentId: input.agentId,
    sessionId: input.sessionId,
    requestGroupId: input.requestGroupId,
    lineageId: input.lineageId,
    ...(input.channelKey ? { channelKey: input.channelKey } : {}),
    ...(input.threadKey ? { threadKey: input.threadKey } : {}),
  })
  return {
    ownerScope,
    ...(normalizeString(input.nicknameSnapshot)
      ? { nicknameSnapshot: normalizeNicknameSnapshot(input.nicknameSnapshot!) }
      : {}),
    seedMode: "child_own_state",
    rawTranscriptIncluded: false,
    ...(normalizeString(input.latestCapsuleId) ? { latestCapsuleId: input.latestCapsuleId } : {}),
    ...(normalizeString(input.handoffExchangeId)
      ? { handoffExchangeId: input.handoffExchangeId }
      : {}),
    ...(normalizeString(input.feedbackExchangeId)
      ? { feedbackExchangeId: input.feedbackExchangeId }
      : {}),
    ...(normalizeString(input.latestSafeContextSummary)
      ? { latestSafeContextSummary: input.latestSafeContextSummary }
      : {}),
    initialPinnedItems: normalizeStringArray([
      ...buildBootstrapPinnedItems(input.taskScope),
      ...(input.additionalPinnedItems ?? []),
    ]),
    sourceProvenanceRefs: normalizeStringArray([
      ...((input.sourceProvenanceRefs ?? []).map((item) => item)),
      `command_request:${input.requestGroupId}`,
    ]),
    additionalContextRefs: normalizeStringArray(input.additionalContextRefs),
    createdAt: input.now ?? Date.now(),
  }
}

export function buildAgentMemoryStateFromBootstrap(input: {
  bootstrap: SubSessionMemoryBootstrap
}): AgentMemoryState {
  const bootstrap = input.bootstrap
  const currentRawTokenEstimate = bootstrap.initialPinnedItems.reduce(
    (sum, item) => sum + estimateTextTokens(item),
    0,
  )
  return normalizeAgentMemoryState({
    stateId: randomUUID(),
    ownerScope: bootstrap.ownerScope,
    ownerScopeKey: buildAgentMemoryStateScopeKey(bootstrap.ownerScope),
    ...(bootstrap.nicknameSnapshot ? { nicknameSnapshot: bootstrap.nicknameSnapshot } : {}),
    ...(bootstrap.latestCapsuleId ? { latestCapsuleId: bootstrap.latestCapsuleId } : {}),
    currentRawTokenEstimate,
    currentRawMessageCount: 0,
    createdAt: bootstrap.createdAt,
    updatedAt: bootstrap.createdAt,
  })
}
