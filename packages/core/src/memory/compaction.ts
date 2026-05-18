import { randomUUID } from "node:crypto"
import type { AIProvider, Message } from "../ai/types.js"
import {
  enqueueMemoryWritebackCandidate,
  getSession,
  insertMemoryCapsule,
  insertMemoryCapsuleSource,
  insertMemoryCompactionRun,
  listMemoryCapsulesForOwner,
  projectMemoryCapsuleToCompatibilityStores,
  upsertAgentMemoryState,
  upsertSessionSnapshot,
} from "../db/index.js"
import {
  ROOT_MAIN_AGENT_ID,
  buildAgentMemoryStateFromCapsule,
  buildMainAgentMemoryStateScope,
} from "./agent-state.js"
import {
  maybeRollupCapsuleChain,
} from "./retrieval-restore.js"
import { storeMemoryDocument } from "./store.js"
import {
  buildDefaultMemoryCompactionAudit,
  resolveMemoryCompactionPolicy,
  type MemoryCompactionModelAttempt,
  type MemoryCompactionModelAudit,
} from "./model-policy.js"
import {
  applyMemoryCapsuleDeterministicState,
  type MemoryCapsule,
  type MemoryCapsuleArtifactRef,
  type MemoryCapsuleDeterministicState,
} from "./capsule.js"

export const SESSION_COMPACTION_TOKEN_THRESHOLD = 120_000
export const SESSION_COMPACTION_MESSAGE_THRESHOLD = 40
export const ROOT_SESSION_COMPACTION_DEFAULT_TAIL_SIZE = 8

const DEFAULT_SNAPSHOT_SUMMARY_CHARS = 1_200
const ROOT_SESSION_SUMMARY_PROMPT = [
  "Return JSON only.",
  "Schema:",
  '{"what_happened":"","current_goal":[],"still_open":[],"confirmed_facts":[],"must_keep_constraints":[],"artifacts_and_receipts":[],"tool_side_effect_boundary":[],"retry_do_not_repeat":[],"handoff_ready_context":[]}',
  "Keep arrays concise and concrete.",
].join("\n")
const ROOT_SESSION_SUMMARY_MAX_TRANSCRIPT_CHARS = 10_000
const ROOT_SESSION_SUMMARY_MAX_MESSAGE_CHARS = 480

export type RootSessionCompactionReasonCode =
  | "token_threshold_exceeded"
  | "message_threshold_exceeded"
  | "large_tool_payload_pruned"
  | "root_continuity_refresh_needed"
  | "blocked_by_pending_finalization"
  | "blocked_by_unmatched_tool_pair"
  | "blocked_by_cancellation_or_recovery"

export interface SessionCompactionSnapshotInput {
  sessionId: string
  summary: string
  requestGroupId?: string
  activeTaskIds?: string[]
  pendingApprovals?: string[]
  pendingDelivery?: string[]
}

export interface SessionCompactionSnapshot {
  sessionId: string
  summary: string
  preservedFacts: string[]
  activeTaskIds: string[]
}

export interface SilentMemoryFlushInput {
  sessionId: string
  runId?: string
  requestGroupId?: string
  pendingApprovals?: string[]
  pendingDelivery?: string[]
  durableFacts?: string[]
}

export interface SessionCompactionMaintenanceResult {
  snapshotId: string
  flushCandidateId?: string
  snapshot: SessionCompactionSnapshot
}

export interface RootSessionDeterministicState {
  activeTaskIds: string[]
  activeObjectives: string[]
  pendingApprovals: string[]
  pendingDelivery: string[]
  explicitTargetSelectors: string[]
  latestArtifactReceipts: string[]
  unresolvedResultReviewItems: string[]
  explicitUserCorrections: string[]
  retryDoNotRepeatBoundary: string[]
  finalDeliveryBlockReasons: string[]
  confirmedFacts: string[]
  mustKeepConstraints: string[]
  decisions: string[]
  recoveryStates: string[]
}

export interface RootSessionPinnedWorkingSet {
  activeObjectives: string[]
  confirmedFacts: string[]
  constraints: string[]
  decisions: string[]
  pendingItems: string[]
  artifactRefs: MemoryCapsuleArtifactRef[]
  blockedReasonCodes: RootSessionCompactionReasonCode[]
}

export interface RootSessionStructuredSummary {
  whatHappened: string
  currentGoal: string[]
  stillOpen: string[]
  confirmedFacts: string[]
  mustKeepConstraints: string[]
  artifactsAndReceipts: string[]
  toolSideEffectBoundary: string[]
  retryDoNotRepeat: string[]
  handoffReadyContext: string[]
}

interface RootSessionStructuredSummaryBuildResult {
  summary: RootSessionStructuredSummary
  audit: MemoryCompactionModelAudit
}

export interface RootSessionCompactionExecutionResult {
  capsuleId: string
  compactionRunId: string
  capsule: MemoryCapsule
  rewrittenMessages: Message[]
  triggerReasonCodes: RootSessionCompactionReasonCode[]
  tailMessageCount: number
  degradedTailMessageCount?: number
  sourceMessageCount: number
  archiveDocumentId?: string
  rollupCapsuleId?: string
}

export interface RootSessionRetrievalOnlyRewriteResult {
  messages: Message[]
  snippetCount: number
  resultTokenEstimate: number
}

interface RootSessionCompactionAttemptInput {
  provider: AIProvider
  model: string
  sessionId: string
  messages: Message[]
  sourceTokenEstimate: number
  triggerReasonCodes: RootSessionCompactionReasonCode[]
  runId?: string
  requestGroupId?: string
}

interface RootSessionCompactionRewriteResult {
  messages: Message[]
  tailMessageCount: number
  degradedTailMessageCount?: number
  resultTokenEstimate: number
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = normalizeWhitespace(value)
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeStringArray(values: string[] = []): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = normalizeString(value)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

function normalizeArtifactRefs(values: MemoryCapsuleArtifactRef[]): MemoryCapsuleArtifactRef[] {
  const normalized: MemoryCapsuleArtifactRef[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const note = normalizeString(value.note)
    if (!note) continue
    const next: MemoryCapsuleArtifactRef = { note }
    const artifactId = normalizeString(value.artifactId)
    const path = normalizeString(value.path)
    const receiptId = normalizeString(value.receiptId)
    if (artifactId) next.artifactId = artifactId
    if (path) next.path = path
    if (receiptId) next.receiptId = receiptId
    const key = JSON.stringify(next)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(next)
  }
  return normalized
}

export function estimateContextTokens(value: string | Message[]): number {
  if (typeof value === "string") return Math.max(1, Math.ceil(value.length / 4))
  const text = value.map((message) => renderMessageForTranscript(message)).join("\n")
  return estimateContextTokens(text)
}

export function needsSessionCompaction(messages: Message[], totalTokens: number): boolean {
  return totalTokens > SESSION_COMPACTION_TOKEN_THRESHOLD
    || messages.length > SESSION_COMPACTION_MESSAGE_THRESHOLD
}

export function truncateSnapshotSummary(summary: string, maxChars = DEFAULT_SNAPSHOT_SUMMARY_CHARS): string {
  const normalized = normalizeWhitespace(summary)
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

export function buildSessionCompactionSnapshot(input: SessionCompactionSnapshotInput): SessionCompactionSnapshot {
  const pendingApprovals = input.pendingApprovals?.filter((item) => item.trim()) ?? []
  const pendingDelivery = input.pendingDelivery?.filter((item) => item.trim()) ?? []
  const activeTaskIds = new Set<string>()
  if (input.requestGroupId?.trim()) activeTaskIds.add(input.requestGroupId.trim())
  for (const taskId of input.activeTaskIds ?? []) {
    const trimmed = taskId.trim()
    if (trimmed) activeTaskIds.add(trimmed)
  }

  return {
    sessionId: input.sessionId,
    summary: truncateSnapshotSummary(input.summary),
    preservedFacts: [
      ...pendingApprovals.map((item) => `pending_approval:${item}`),
      ...pendingDelivery.map((item) => `pending_delivery:${item}`),
    ],
    activeTaskIds: [...activeTaskIds],
  }
}

export function runSilentMemoryFlushBeforeCompaction(input: SilentMemoryFlushInput): string | undefined {
  const durableFacts = input.durableFacts?.map((item) => item.trim()).filter(Boolean) ?? []
  const pendingApprovals = input.pendingApprovals?.map((item) => item.trim()).filter(Boolean) ?? []
  const pendingDelivery = input.pendingDelivery?.map((item) => item.trim()).filter(Boolean) ?? []
  const lines = [
    input.requestGroupId ? `request_group:${input.requestGroupId}` : "",
    ...durableFacts.map((item) => `fact:${item}`),
    ...pendingApprovals.map((item) => `pending_approval:${item}`),
    ...pendingDelivery.map((item) => `pending_delivery:${item}`),
  ].filter(Boolean)
  if (lines.length === 0) return undefined
  return enqueueMemoryWritebackCandidate({
    scope: "session",
    ownerId: input.sessionId,
    sourceType: "compaction_silent_flush",
    content: lines.join("\n"),
    ...(input.runId ? { runId: input.runId } : {}),
    metadata: {
      sessionId: input.sessionId,
      ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
      pendingApprovalCount: pendingApprovals.length,
      pendingDeliveryCount: pendingDelivery.length,
      durableFactCount: durableFacts.length,
      silent: true,
    },
  })
}

export function persistSessionCompactionMaintenance(input: SessionCompactionSnapshotInput & SilentMemoryFlushInput): SessionCompactionMaintenanceResult {
  const flushCandidateId = runSilentMemoryFlushBeforeCompaction(input)
  const snapshot = buildSessionCompactionSnapshot(input)
  const snapshotId = upsertSessionSnapshot({
    sessionId: snapshot.sessionId,
    summary: snapshot.summary,
    preservedFacts: snapshot.preservedFacts,
    activeTaskIds: snapshot.activeTaskIds,
  })
  return {
    snapshotId,
    snapshot,
    ...(flushCandidateId ? { flushCandidateId } : {}),
  }
}

export function hasBalancedToolUsePairs(messages: Message[]): boolean {
  const pendingToolUseIds: string[] = []
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === "tool_use") pendingToolUseIds.push(block.id)
      if (block.type === "tool_result") {
        const index = pendingToolUseIds.indexOf(block.tool_use_id)
        if (index >= 0) pendingToolUseIds.splice(index, 1)
      }
    }
  }
  return pendingToolUseIds.length === 0
}

export function buildRootSessionCompactionReasonCodes(input: {
  messages: Message[]
  totalTokens: number
  pruningDecisionCount?: number
  deterministicState?: RootSessionDeterministicState
}): RootSessionCompactionReasonCode[] {
  const reasonCodes = new Set<RootSessionCompactionReasonCode>()
  if (input.totalTokens > SESSION_COMPACTION_TOKEN_THRESHOLD) reasonCodes.add("token_threshold_exceeded")
  if (input.messages.length > SESSION_COMPACTION_MESSAGE_THRESHOLD) reasonCodes.add("message_threshold_exceeded")
  if ((input.pruningDecisionCount ?? 0) > 0) reasonCodes.add("large_tool_payload_pruned")
  if ((input.deterministicState?.activeTaskIds.length ?? 0) > 0) reasonCodes.add("root_continuity_refresh_needed")
  if ((input.deterministicState?.finalDeliveryBlockReasons.length ?? 0) > 0) {
    reasonCodes.add("blocked_by_pending_finalization")
  }
  if (!hasBalancedToolUsePairs(input.messages)) reasonCodes.add("blocked_by_unmatched_tool_pair")
  if ((input.deterministicState?.recoveryStates.length ?? 0) > 0) {
    reasonCodes.add("blocked_by_cancellation_or_recovery")
  }
  return [...reasonCodes]
}

export function extractRootSessionDeterministicState(input: {
  messages: Message[]
  requestGroupId?: string
}): RootSessionDeterministicState {
  const activeTaskIds = new Set<string>()
  const activeObjectives: string[] = []
  const pendingApprovals: string[] = []
  const pendingDelivery: string[] = []
  const explicitTargetSelectors: string[] = []
  const latestArtifactReceipts: string[] = []
  const unresolvedResultReviewItems: string[] = []
  const explicitUserCorrections: string[] = []
  const retryDoNotRepeatBoundary: string[] = []
  const finalDeliveryBlockReasons: string[] = []
  const confirmedFacts: string[] = []
  const mustKeepConstraints: string[] = []
  const decisions: string[] = []
  const recoveryStates: string[] = []

  if (input.requestGroupId?.trim()) activeTaskIds.add(input.requestGroupId.trim())

  for (const line of extractStructuredMemoryLines(input.messages)) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    if (!rawValue) continue
    switch (key) {
      case "active_task":
        activeTaskIds.add(rawValue)
        break
      case "objective":
        activeObjectives.push(rawValue)
        break
      case "pending_approval":
        pendingApprovals.push(rawValue)
        break
      case "pending_delivery":
        pendingDelivery.push(rawValue)
        break
      case "target_selector":
        explicitTargetSelectors.push(rawValue)
        break
      case "artifact_receipt":
        latestArtifactReceipts.push(rawValue)
        break
      case "result_review":
        unresolvedResultReviewItems.push(rawValue)
        break
      case "user_correction":
        explicitUserCorrections.push(rawValue)
        break
      case "retry_boundary":
        retryDoNotRepeatBoundary.push(rawValue)
        break
      case "final_delivery_block":
        finalDeliveryBlockReasons.push(rawValue)
        break
      case "confirmed_fact":
        confirmedFacts.push(rawValue)
        break
      case "constraint":
        mustKeepConstraints.push(rawValue)
        break
      case "decision":
        decisions.push(rawValue)
        break
      case "recovery_state":
        recoveryStates.push(rawValue)
        break
      default:
        break
    }
  }

  return {
    activeTaskIds: normalizeStringArray([...activeTaskIds]),
    activeObjectives: normalizeStringArray(activeObjectives),
    pendingApprovals: normalizeStringArray(pendingApprovals),
    pendingDelivery: normalizeStringArray(pendingDelivery),
    explicitTargetSelectors: normalizeStringArray(explicitTargetSelectors),
    latestArtifactReceipts: normalizeStringArray(latestArtifactReceipts),
    unresolvedResultReviewItems: normalizeStringArray(unresolvedResultReviewItems),
    explicitUserCorrections: normalizeStringArray(explicitUserCorrections),
    retryDoNotRepeatBoundary: normalizeStringArray(retryDoNotRepeatBoundary),
    finalDeliveryBlockReasons: normalizeStringArray(finalDeliveryBlockReasons),
    confirmedFacts: normalizeStringArray(confirmedFacts),
    mustKeepConstraints: normalizeStringArray(mustKeepConstraints),
    decisions: normalizeStringArray(decisions),
    recoveryStates: normalizeStringArray(recoveryStates),
  }
}

export function buildRootSessionPinnedWorkingSet(input: {
  deterministicState: RootSessionDeterministicState
}): RootSessionPinnedWorkingSet {
  const deterministicState = input.deterministicState
  const pendingItems = normalizeStringArray([
    ...deterministicState.pendingApprovals.map((item) => `pending_approval:${item}`),
    ...deterministicState.pendingDelivery.map((item) => `pending_delivery:${item}`),
    ...deterministicState.unresolvedResultReviewItems.map((item) => `result_review:${item}`),
  ])
  const constraints = normalizeStringArray([
    ...deterministicState.mustKeepConstraints,
    ...deterministicState.explicitTargetSelectors.map((item) => `target_selector:${item}`),
    ...deterministicState.explicitUserCorrections.map((item) => `user_correction:${item}`),
    ...deterministicState.finalDeliveryBlockReasons.map((item) => `final_delivery_block:${item}`),
  ])
  const decisions = normalizeStringArray([
    ...deterministicState.decisions,
    ...deterministicState.retryDoNotRepeatBoundary.map((item) => `retry_boundary:${item}`),
  ])
  const activeObjectives = normalizeStringArray([
    ...deterministicState.activeObjectives,
    ...deterministicState.activeTaskIds.map((item) => `active_task:${item}`),
  ])
  const artifactRefs = normalizeArtifactRefs(
    deterministicState.latestArtifactReceipts.map((item) => ({ note: item })),
  )
  const blockedReasonCodes: RootSessionCompactionReasonCode[] = []
  if (deterministicState.finalDeliveryBlockReasons.length > 0) {
    blockedReasonCodes.push("blocked_by_pending_finalization")
  }
  if (deterministicState.recoveryStates.length > 0) {
    blockedReasonCodes.push("blocked_by_cancellation_or_recovery")
  }
  return {
    activeObjectives,
    confirmedFacts: deterministicState.confirmedFacts,
    constraints,
    decisions,
    pendingItems,
    artifactRefs,
    blockedReasonCodes,
  }
}

export async function executeRootSessionCompaction(
  input: RootSessionCompactionAttemptInput,
): Promise<RootSessionCompactionExecutionResult> {
  const deterministicState = extractRootSessionDeterministicState({
    messages: input.messages,
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
  })
  const workingSet = buildRootSessionPinnedWorkingSet({ deterministicState })
  if (workingSet.blockedReasonCodes.length > 0) {
    throw new Error(`root session compaction blocked: ${workingSet.blockedReasonCodes.join(",")}`)
  }
  if (!hasBalancedToolUsePairs(input.messages)) {
    throw new Error("root session compaction blocked: blocked_by_unmatched_tool_pair")
  }

  const sourceRefs = input.messages.map((_, index) => `active_window_message:${index}`)
  const modelSummary = await buildRootSessionStructuredSummary({
    provider: input.provider,
    model: input.model,
    messages: input.messages,
  })
  const capsule = persistRootSessionCompactionCapsule({
    sessionId: input.sessionId,
    sourceRefs,
    sourceTokenEstimate: input.sourceTokenEstimate,
    sourceMessageCount: input.messages.length,
    modelProvider: input.provider.id,
    modelId: input.model,
    triggerReasonCodes: input.triggerReasonCodes,
    structuredSummary: modelSummary.summary,
    pinnedWorkingSet: workingSet,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
  })
  const archiveDocumentId = await archiveCompactedSessionMessages({
    sessionId: input.sessionId,
    ownerScope: capsule.ownerScope,
    capsuleId: capsule.capsuleId,
    messages: input.messages,
  })
  const rollup = maybeRollupCapsuleChain({
    ownerScope: capsule.ownerScope,
    ...(input.runId ? { runId: input.runId } : {}),
    sessionId: input.sessionId,
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
  })
  const rewrite = rewriteRootSessionActiveWindow({
    messages: input.messages,
    capsule,
    pinnedWorkingSet: workingSet,
  })
  return {
    capsuleId: capsule.capsuleId,
    compactionRunId: insertMemoryCompactionRun({
      capsuleId: capsule.capsuleId,
      ownerScope: capsule.ownerScope,
      triggerReasonCodes: input.triggerReasonCodes,
      sourceTokenEstimate: input.sourceTokenEstimate,
      resultTokenEstimate: rewrite.resultTokenEstimate,
      status: "completed",
      modelProvider: input.provider.id,
      modelId: modelSummary.audit.selectedModelId ?? input.model,
      validationSummary: modelSummary.audit.heuristicFallbackApplied
        ? "deterministic_state_precedence_applied:heuristic_summary_fallback"
        : "deterministic_state_precedence_applied",
      metadata: {
        sourceMessageCount: input.messages.length,
        tailMessageCount: rewrite.tailMessageCount,
        degradedTailMessageCount: rewrite.degradedTailMessageCount ?? null,
        archiveDocumentId: archiveDocumentId ?? null,
        rollupCapsuleId: rollup.rollupCapsule?.capsuleId ?? null,
        compactionModelAudit: modelSummary.audit,
      },
    }),
    capsule,
    rewrittenMessages: rewrite.messages,
    triggerReasonCodes: input.triggerReasonCodes,
    tailMessageCount: rewrite.tailMessageCount,
    ...(rewrite.degradedTailMessageCount !== undefined
      ? { degradedTailMessageCount: rewrite.degradedTailMessageCount }
      : {}),
    sourceMessageCount: input.messages.length,
    ...(archiveDocumentId ? { archiveDocumentId } : {}),
    ...(rollup.rollupCapsule ? { rollupCapsuleId: rollup.rollupCapsule.capsuleId } : {}),
  }
}

export function rewriteRootSessionActiveWindow(input: {
  messages: Message[]
  capsule: MemoryCapsule
  pinnedWorkingSet: RootSessionPinnedWorkingSet
  preferredTailSize?: number
  maintenanceRestoreBlock?: string
  promptTimeRecallBlock?: string
}): RootSessionCompactionRewriteResult {
  const preferredTailSize = Math.max(0, Math.floor(input.preferredTailSize ?? ROOT_SESSION_COMPACTION_DEFAULT_TAIL_SIZE))
  const tailSize = Math.min(preferredTailSize, input.messages.length)
  const tail = tailSize > 0 ? input.messages.slice(-tailSize) : []
  const rewrittenMessages: Message[] = [
    { role: "user", content: renderPinnedWorkingSetPromptBlock(input.pinnedWorkingSet) },
    {
      role: "user",
      content: input.maintenanceRestoreBlock ?? renderCompactedCapsulePromptBlock(input.capsule),
    },
    ...(input.promptTimeRecallBlock
      ? [{ role: "user" as const, content: input.promptTimeRecallBlock }]
      : []),
    ...tail,
  ]
  return {
    messages: rewrittenMessages,
    tailMessageCount: tail.length,
    ...(preferredTailSize < ROOT_SESSION_COMPACTION_DEFAULT_TAIL_SIZE
      ? { degradedTailMessageCount: tail.length }
      : {}),
    resultTokenEstimate: estimateContextTokens(rewrittenMessages),
  }
}

export function rewriteRootSessionRetrievalOnlyWindow(input: {
  messages: Message[]
  capsule: MemoryCapsule
  pinnedWorkingSet: RootSessionPinnedWorkingSet
  maxSnippetCount?: number
  maxSnippetChars?: number
  retrievalSnippets?: string[]
}): RootSessionRetrievalOnlyRewriteResult {
  const snippets = input.retrievalSnippets ?? buildRetrievalSnippets({
    messages: input.messages,
    ...(input.maxSnippetCount !== undefined ? { maxSnippetCount: input.maxSnippetCount } : {}),
    ...(input.maxSnippetChars !== undefined ? { maxSnippetChars: input.maxSnippetChars } : {}),
  })
  const messages: Message[] = [
    { role: "user", content: renderPinnedWorkingSetRetrievalOnlyBlock(input.pinnedWorkingSet) },
    { role: "user", content: renderRetrievalOnlyCapsulePromptBlock(input.capsule, snippets) },
  ]
  return {
    messages,
    snippetCount: snippets.length,
    resultTokenEstimate: estimateContextTokens(messages),
  }
}

function persistRootSessionCompactionCapsule(input: {
  sessionId: string
  sourceRefs: string[]
  sourceTokenEstimate: number
  modelProvider: string
  modelId: string
  triggerReasonCodes: RootSessionCompactionReasonCode[]
  structuredSummary: RootSessionStructuredSummary
  pinnedWorkingSet: RootSessionPinnedWorkingSet
  runId?: string
  requestGroupId?: string
  sourceMessageCount?: number
}): MemoryCapsule {
  const session = getSession(input.sessionId)
  const channelKey = session?.source?.trim() ? session.source : undefined
  const threadKey = session?.source_id?.trim() ? session.source_id : input.sessionId
  const ownerScope = buildMainAgentMemoryStateScope({
    sessionId: input.sessionId,
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId, lineageId: input.requestGroupId } : {}),
    ...(channelKey ? { channelKey } : {}),
    ...(threadKey ? { threadKey } : {}),
    agentId: ROOT_MAIN_AGENT_ID,
  }) as MemoryCapsule["ownerScope"]
  const parentCapsule = listMemoryCapsulesForOwner({
    ownerType: "main_agent",
    ownerId: ROOT_MAIN_AGENT_ID,
    sessionId: input.sessionId,
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId, lineageId: input.requestGroupId } : {}),
    ...(channelKey ? { channelKey } : {}),
    ...(threadKey ? { threadKey } : {}),
    limit: 1,
  })[0]
  const capsule: MemoryCapsule = {
    capsuleId: randomUUID(),
    capsuleVersion: 1,
    ...(parentCapsule ? { parentCapsuleId: parentCapsule.capsuleId } : {}),
    ownerScope,
    nicknameSnapshot: "노비",
    capsuleKind: "session_compaction",
    summary: buildRootSessionCapsuleSummary(input.structuredSummary),
    activeObjectives: input.structuredSummary.currentGoal,
    confirmedFacts: input.structuredSummary.confirmedFacts,
    decisions: input.structuredSummary.toolSideEffectBoundary,
    constraints: input.structuredSummary.mustKeepConstraints,
    pendingItems: input.structuredSummary.stillOpen,
    artifactRefs: normalizeArtifactRefs(input.structuredSummary.artifactsAndReceipts.map((note) => ({ note }))),
    recoveryHints: input.structuredSummary.handoffReadyContext,
    sourceRefs: normalizeStringArray(input.sourceRefs),
    compactedMessageIds: [],
    sourceTokenEstimate: Math.max(0, Math.floor(input.sourceTokenEstimate)),
    resultTokenEstimate: 0,
    createdAt: Date.now(),
  }
  const deterministicState = buildCapsuleDeterministicState({
    pinnedWorkingSet: input.pinnedWorkingSet,
    structuredSummary: input.structuredSummary,
  })
  const mergedCapsule = applyMemoryCapsuleDeterministicState({
    capsule,
    deterministicState,
  })
  insertMemoryCapsule(mergedCapsule, {
    expectedOwnerScope: ownerScope,
  })
  for (const sourceRef of mergedCapsule.sourceRefs) {
    insertMemoryCapsuleSource({
      capsuleId: mergedCapsule.capsuleId,
      sourceKind: "manual",
      sourceId: sourceRef,
      ownerType: ownerScope.ownerType,
      ownerId: ownerScope.ownerId,
      metadata: {
        modelProvider: input.modelProvider,
        modelId: input.modelId,
        triggerReasonCodes: input.triggerReasonCodes,
        ...(input.runId ? { runId: input.runId } : {}),
      },
    })
  }
  projectMemoryCapsuleToCompatibilityStores(mergedCapsule)
  const state = buildAgentMemoryStateFromCapsule({
    capsule: mergedCapsule,
    currentRawTokenEstimate: input.sourceTokenEstimate,
    currentRawMessageCount: input.sourceMessageCount ?? input.sourceRefs.length,
  })
  if (state) upsertAgentMemoryState(state)
  return mergedCapsule
}

function buildCapsuleDeterministicState(input: {
  pinnedWorkingSet: RootSessionPinnedWorkingSet
  structuredSummary: RootSessionStructuredSummary
}): MemoryCapsuleDeterministicState {
  return {
    activeObjectives: normalizeStringArray([
      ...input.pinnedWorkingSet.activeObjectives,
      ...input.structuredSummary.currentGoal,
    ]),
    confirmedFacts: normalizeStringArray([
      ...input.pinnedWorkingSet.confirmedFacts,
      ...input.structuredSummary.confirmedFacts,
    ]),
    decisions: normalizeStringArray([
      ...input.pinnedWorkingSet.decisions,
      ...input.structuredSummary.toolSideEffectBoundary,
      ...input.structuredSummary.retryDoNotRepeat.map((item) => `retry_boundary:${item}`),
    ]),
    constraints: normalizeStringArray([
      ...input.pinnedWorkingSet.constraints,
      ...input.structuredSummary.mustKeepConstraints,
    ]),
    pendingItems: normalizeStringArray([
      ...input.pinnedWorkingSet.pendingItems,
      ...input.structuredSummary.stillOpen,
    ]),
    artifactRefs: normalizeArtifactRefs([
      ...input.pinnedWorkingSet.artifactRefs,
      ...input.structuredSummary.artifactsAndReceipts.map((note) => ({ note })),
    ]),
  }
}

async function buildRootSessionStructuredSummary(input: {
  provider: AIProvider
  model: string
  messages: Message[]
}): Promise<RootSessionStructuredSummaryBuildResult> {
  const fallback = buildFallbackRootSessionStructuredSummary(input.messages)
  const transcript = buildRootSessionSummaryTranscript(input.messages)
  const policy = resolveMemoryCompactionPolicy({
    provider: input.provider,
    executionModelId: input.model,
  })
  if (!transcript) {
    return {
      summary: fallback,
      audit: buildDefaultMemoryCompactionAudit({
        executionModelId: input.model,
        selectedModelId: policy.snapshot.selectedModelId,
        selectionSource: policy.snapshot.selectionSource,
        minContextTokens: policy.snapshot.minContextTokens,
        providerBudgetBlocked: policy.snapshot.providerBudgetBlocked,
        heuristicFallbackApplied: true,
        ...(policy.snapshot.fallbackModelId ? { fallbackModelId: policy.snapshot.fallbackModelId } : {}),
      }),
    }
  }

  const attempts: MemoryCompactionModelAttempt[] = []
  const seenModelIds = new Set<string>()
  for (const candidate of policy.candidates) {
    if (seenModelIds.has(candidate.modelId)) {
      attempts.push({
        modelId: candidate.modelId,
        source: candidate.source,
        maxContextTokens: candidate.maxContextTokens,
        status: "skipped_duplicate",
      })
      continue
    }
    seenModelIds.add(candidate.modelId)
    if (candidate.maxContextTokens > 0 && candidate.maxContextTokens < policy.snapshot.minContextTokens) {
      attempts.push({
        modelId: candidate.modelId,
        source: candidate.source,
        maxContextTokens: candidate.maxContextTokens,
        status: "provider_budget_blocked",
      })
      continue
    }
    let raw = ""
    try {
      for await (const chunk of input.provider.chat({
        model: candidate.modelId,
        messages: [{
          role: "user",
          content: `${ROOT_SESSION_SUMMARY_PROMPT}\n\n[conversation]\n${transcript}`,
        }],
        maxTokens: 500,
      })) {
        if (chunk.type === "text_delta") raw += chunk.delta
      }
    } catch (error) {
      attempts.push({
        modelId: candidate.modelId,
        source: candidate.source,
        maxContextTokens: candidate.maxContextTokens,
        status: "provider_call_failed",
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    const parsed = parseRootSessionStructuredSummary(raw)
    if (parsed) {
      attempts.push({
        modelId: candidate.modelId,
        source: candidate.source,
        maxContextTokens: candidate.maxContextTokens,
        status: "selected",
      })
      return {
        summary: parsed,
        audit: buildDefaultMemoryCompactionAudit({
          executionModelId: input.model,
          selectedModelId: candidate.modelId,
          selectionSource: candidate.source,
          minContextTokens: policy.snapshot.minContextTokens,
          providerBudgetBlocked: policy.snapshot.providerBudgetBlocked,
          attempts,
          fallbackApplied: candidate.source === "fallback_override",
          ...(policy.snapshot.fallbackModelId ? { fallbackModelId: policy.snapshot.fallbackModelId } : {}),
        }),
      }
    }
    attempts.push({
      modelId: candidate.modelId,
      source: candidate.source,
      maxContextTokens: candidate.maxContextTokens,
      status: "invalid_json",
    })
  }

  return {
    summary: fallback,
    audit: buildDefaultMemoryCompactionAudit({
      executionModelId: input.model,
      selectedModelId: policy.snapshot.selectedModelId,
      selectionSource: policy.snapshot.selectionSource,
      minContextTokens: policy.snapshot.minContextTokens,
      providerBudgetBlocked: policy.snapshot.providerBudgetBlocked
        || attempts.some((attempt) => attempt.status === "provider_budget_blocked"),
      attempts,
      heuristicFallbackApplied: true,
      ...(policy.snapshot.fallbackModelId ? { fallbackModelId: policy.snapshot.fallbackModelId } : {}),
    }),
  }
}

function parseRootSessionStructuredSummary(raw: string): RootSessionStructuredSummary | undefined {
  const candidate = extractJsonObject(raw)
  if (!candidate) return undefined
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>
    return normalizeRootSessionStructuredSummary(parsed)
  } catch {
    return undefined
  }
}

function normalizeRootSessionStructuredSummary(value: Record<string, unknown>): RootSessionStructuredSummary {
  return {
    whatHappened: normalizeString(typeof value["what_happened"] === "string" ? value["what_happened"] : "") ?? "",
    currentGoal: normalizeUnknownStringArray(value["current_goal"]),
    stillOpen: normalizeUnknownStringArray(value["still_open"]),
    confirmedFacts: normalizeUnknownStringArray(value["confirmed_facts"]),
    mustKeepConstraints: normalizeUnknownStringArray(value["must_keep_constraints"]),
    artifactsAndReceipts: normalizeUnknownStringArray(value["artifacts_and_receipts"]),
    toolSideEffectBoundary: normalizeUnknownStringArray(value["tool_side_effect_boundary"]),
    retryDoNotRepeat: normalizeUnknownStringArray(value["retry_do_not_repeat"]),
    handoffReadyContext: normalizeUnknownStringArray(value["handoff_ready_context"]),
  }
}

function buildFallbackRootSessionStructuredSummary(messages: Message[]): RootSessionStructuredSummary {
  const transcript = buildRootSessionSummaryTranscript(messages)
  const lines = transcript.split("\n").filter((line) => line.trim().length > 0)
  const deterministicState = extractRootSessionDeterministicState({ messages })
  return {
    whatHappened: truncateSnapshotSummary(lines.slice(0, 6).join(" "), 320),
    currentGoal: normalizeStringArray([
      ...deterministicState.activeObjectives,
      ...deterministicState.activeTaskIds.map((item) => `active_task:${item}`),
    ]),
    stillOpen: normalizeStringArray([
      ...deterministicState.pendingApprovals.map((item) => `pending_approval:${item}`),
      ...deterministicState.pendingDelivery.map((item) => `pending_delivery:${item}`),
      ...deterministicState.unresolvedResultReviewItems.map((item) => `result_review:${item}`),
    ]),
    confirmedFacts: deterministicState.confirmedFacts,
    mustKeepConstraints: normalizeStringArray([
      ...deterministicState.mustKeepConstraints,
      ...deterministicState.explicitTargetSelectors.map((item) => `target_selector:${item}`),
      ...deterministicState.explicitUserCorrections.map((item) => `user_correction:${item}`),
    ]),
    artifactsAndReceipts: deterministicState.latestArtifactReceipts,
    toolSideEffectBoundary: deterministicState.decisions,
    retryDoNotRepeat: deterministicState.retryDoNotRepeatBoundary,
    handoffReadyContext: normalizeStringArray([
      ...deterministicState.recoveryStates,
      ...deterministicState.finalDeliveryBlockReasons.map((item) => `final_delivery_block:${item}`),
    ]),
  }
}

function buildRootSessionSummaryTranscript(messages: Message[]): string {
  const transcriptLines: string[] = []
  let remainingChars = ROOT_SESSION_SUMMARY_MAX_TRANSCRIPT_CHARS
  messages.forEach((message, index) => {
    if (remainingChars <= 0) return
    const rendered = renderMessageForTranscript(message)
    if (!rendered) return
    const line = `[${index}:${message.role}] ${rendered.slice(0, ROOT_SESSION_SUMMARY_MAX_MESSAGE_CHARS)}`
    const clipped = line.slice(0, remainingChars)
    transcriptLines.push(clipped)
    remainingChars -= clipped.length + 1
  })
  return transcriptLines.join("\n")
}

function renderMessageForTranscript(message: Message): string {
  if (typeof message.content === "string") return normalizeWhitespace(message.content)
  const lines = message.content.map((block) => {
    if (block.type === "text") return block.text
    if (block.type === "tool_use") return `[tool_use:${block.name}] ${safeJsonStringify(block.input)}`
    if (block.type === "tool_result") return `[tool_result:${block.tool_use_id}] ${block.content}`
    return safeJsonStringify(block)
  })
  return normalizeWhitespace(lines.join("\n"))
}

function extractStructuredMemoryLines(messages: Message[]): string[] {
  const lines: string[] = []
  for (const message of messages) {
    const text = renderMessageForTranscript(message)
    if (!text) continue
    for (const line of text.split(/\n+/)) {
      const trimmed = line.trim()
      if (trimmed) lines.push(trimmed)
    }
  }
  return lines
}

function renderPinnedWorkingSetPromptBlock(workingSet: RootSessionPinnedWorkingSet): string {
  return [
    "[pinned_working_set]",
    renderSection("active_objectives", workingSet.activeObjectives),
    renderSection("confirmed_facts", workingSet.confirmedFacts),
    renderSection("constraints", workingSet.constraints),
    renderSection("decisions", workingSet.decisions),
    renderSection("pending_items", workingSet.pendingItems),
    renderSection("artifact_refs", workingSet.artifactRefs.map((item) => item.note)),
  ].filter(Boolean).join("\n")
}

function renderPinnedWorkingSetRetrievalOnlyBlock(workingSet: RootSessionPinnedWorkingSet): string {
  return [
    "[pinned_working_set_retrieval_only]",
    renderInlineSection("active_objectives", workingSet.activeObjectives, 2, 120),
    renderInlineSection("constraints", workingSet.constraints, 3, 160),
    renderInlineSection("pending_items", workingSet.pendingItems, 3, 160),
  ].filter(Boolean).join("\n")
}

function renderCompactedCapsulePromptBlock(capsule: MemoryCapsule): string {
  return [
    "[latest_compacted_capsule]",
    `summary: ${capsule.summary}`,
    renderSection("active_objectives", capsule.activeObjectives),
    renderSection("confirmed_facts", capsule.confirmedFacts),
    renderSection("constraints", capsule.constraints),
    renderSection("pending_items", capsule.pendingItems),
    renderSection("artifact_refs", capsule.artifactRefs.map((item) => item.note)),
    renderSection("recovery_hints", capsule.recoveryHints),
  ].filter(Boolean).join("\n")
}

function renderRetrievalOnlyCapsulePromptBlock(capsule: MemoryCapsule, snippets: string[]): string {
  return [
    "[retrieval_only_context]",
    `summary: ${truncateSnapshotSummary(capsule.summary, 220)}`,
    renderInlineSection("confirmed_facts", capsule.confirmedFacts, 2, 120),
    renderInlineSection("artifact_refs", capsule.artifactRefs.map((item) => item.note), 2, 100),
    renderSnippetSection("retrieval_snippets", snippets),
  ].filter(Boolean).join("\n")
}

function buildRootSessionCapsuleSummary(summary: RootSessionStructuredSummary): string {
  const parts = [
    summary.whatHappened,
    summary.currentGoal.length > 0 ? `current_goal: ${summary.currentGoal.join("; ")}` : "",
    summary.stillOpen.length > 0 ? `still_open: ${summary.stillOpen.join("; ")}` : "",
  ].filter(Boolean)
  return truncateSnapshotSummary(parts.join("\n"))
}

function renderSection(label: string, values: string[]): string {
  const normalized = normalizeStringArray(values)
  if (normalized.length === 0) return `${label}: []`
  return `${label}:\n${normalized.map((item) => `- ${item}`).join("\n")}`
}

function renderInlineSection(label: string, values: string[], maxItems: number, maxChars: number): string {
  const normalized = normalizeStringArray(values).slice(0, maxItems)
  if (normalized.length === 0) return `${label}: []`
  const joined = truncateSnapshotSummary(normalized.join("; "), maxChars)
  return `${label}: ${joined}`
}

function renderSnippetSection(label: string, values: string[]): string {
  if (values.length === 0) return `${label}: []`
  return `${label}:\n${values.map((item) => `- ${item}`).join("\n")}`
}

function normalizeUnknownStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return normalizeStringArray(value.filter((item): item is string => typeof item === "string"))
}

function extractJsonObject(value: string): string | undefined {
  const start = value.indexOf("{")
  const end = value.lastIndexOf("}")
  if (start < 0 || end <= start) return undefined
  return value.slice(start, end + 1)
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function safeResolveProviderContextTokens(provider: AIProvider, model: string): number {
  try {
    const resolved = provider.maxContextTokens(model)
    if (!Number.isFinite(resolved) || resolved <= 0) return 0
    return Math.floor(resolved)
  } catch {
    return 0
  }
}

function buildRetrievalSnippets(input: {
  messages: Message[]
  maxSnippetCount?: number
  maxSnippetChars?: number
}): string[] {
  const maxSnippetCount = Math.max(1, Math.floor(input.maxSnippetCount ?? 2))
  const maxSnippetChars = Math.max(80, Math.floor(input.maxSnippetChars ?? 120))
  const snippets: string[] = []
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    if (snippets.length >= maxSnippetCount) break
    const message = input.messages[index]
    if (!message) continue
    const rendered = renderMessageForTranscript(message)
    if (!rendered) continue
    const clipped = rendered.length > maxSnippetChars
      ? `${rendered.slice(0, Math.max(0, maxSnippetChars - 1)).trimEnd()}…`
      : rendered
    snippets.unshift(`[${message.role}:${index}] ${clipped}`)
  }
  return snippets
}

async function archiveCompactedSessionMessages(input: {
  sessionId: string
  ownerScope: MemoryCapsule["ownerScope"]
  capsuleId: string
  messages: Message[]
}): Promise<string | undefined> {
  const rawText = input.messages
    .map((message, index) => `[${index}:${message.role}] ${renderMessageForTranscript(message)}`)
    .filter((value) => value.trim().length > 0)
    .join("\n\n")
  if (!rawText.trim()) return undefined
  try {
    const stored = await storeMemoryDocument({
      rawText,
      scope: "session",
      ownerId: input.sessionId,
      sourceType: "memory_capsule_archive",
      sourceRef: input.capsuleId,
      title: `capsule_archive:${input.capsuleId}`,
      metadata: {
        capsuleId: input.capsuleId,
        ownerType: input.ownerScope.ownerType,
        ownerId: input.ownerScope.ownerId,
        sessionId: input.ownerScope.sessionId ?? input.sessionId,
        requestGroupId: input.ownerScope.requestGroupId ?? null,
        lineageId: input.ownerScope.lineageId ?? null,
        channelKey: input.ownerScope.channelKey ?? null,
        threadKey: input.ownerScope.threadKey ?? null,
      },
    })
    return stored.documentId
  } catch {
    return undefined
  }
}
