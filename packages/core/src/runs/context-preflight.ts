import type { AIChunk, AIProvider, ChatParams, Message, MessageContent, ToolDefinition } from "../ai/types.js"
import type { AgentPromptBundle, DataExchangePackage, OwnerScope } from "../contracts/sub-agent-orchestration.js"
import { insertDiagnosticEvent } from "../db/index.js"
import { appendRunEvent } from "./store.js"

export type ContextPreflightStatus = "ok" | "needs_pruning" | "needs_compaction" | "blocked_context_overflow"

export interface ContextPreflightBreakdown {
  systemTokens: number
  messageTokens: number
  toolTokens: number
  totalTokens: number
  providerContextTokens: number
  hardBudgetTokens: number
  softBudgetTokens: number
}

export interface ContextPruningDecision {
  messageIndex: number
  blockIndex: number
  blockType: string
  originalChars: number
  prunedChars: number
  strategy: "head_tail_soft_trim" | "placeholder_hard_clear"
}

export interface ContextPreflightResult {
  status: ContextPreflightStatus
  model: string
  providerId: string
  operation: string
  breakdown: ContextPreflightBreakdown
  durationMs: number
  pruningDecisions: ContextPruningDecision[]
  userMessage?: string
}

export interface ContextPreflightMetadata {
  runId?: string
  sessionId?: string
  requestGroupId?: string
  operation?: string
}

export interface ContextPreflightPreparedChat extends ContextPreflightResult {
  messages: Message[]
  initialStatus: ContextPreflightStatus
}

export interface PromptBundleContextMemoryRef {
  owner: OwnerScope
  visibility: "private" | "coordinator_visible" | "team_visible"
  sourceRef: string
  content?: string
  dataExchangeId?: string
}

export interface PromptBundleContextScopeValidation {
  ok: boolean
  issueCodes: string[]
  blockedSourceRefs: string[]
}

interface UnknownContentBlock {
  type: string
  [key: string]: unknown
}

const TOKEN_CHAR_RATIO = 4
const DEFAULT_OUTPUT_RESERVE_TOKENS = 2_048
const SAFETY_HEADROOM_TOKENS = 1_024
const DEFAULT_PROVIDER_CONTEXT_TOKENS = 128_000
const SOFT_BUDGET_RATIO = 0.78
const HARD_BUDGET_RATIO = 0.92
const RECENT_UNPRUNED_MESSAGE_COUNT = 8
const OLD_TOOL_RESULT_MAX_CHARS = 700
const RECENT_TOOL_RESULT_MAX_CHARS = 1_800

export class ContextPreflightBlockedError extends Error {
  readonly result: ContextPreflightResult

  constructor(result: ContextPreflightResult) {
    super(result.userMessage ?? "Context preflight blocked provider call")
    this.name = "ContextPreflightBlockedError"
    this.result = result
  }
}

export function estimateContextTokens(value: unknown): number {
  if (value == null) return 0
  if (typeof value === "string") return estimateTextTokens(value)
  if (typeof value === "number" || typeof value === "boolean") return estimateTextTokens(String(value))
  if (Array.isArray(value)) return estimateTextTokens(value.map((item) => renderUnknownValue(item)).join("\n"))
  return estimateTextTokens(renderUnknownValue(value))
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

export function runContextPreflight(input: {
  provider: AIProvider
  model: string
  messages: Message[]
  system?: string
  tools?: ToolDefinition[]
  metadata?: ContextPreflightMetadata
  pruningDecisions?: ContextPruningDecision[]
}): ContextPreflightResult {
  const startedAt = Date.now()
  const providerContextTokens = resolveProviderContextTokens(input.provider, input.model)
  const hardBudgetTokens = Math.max(
    1,
    Math.floor(Math.min(providerContextTokens * HARD_BUDGET_RATIO, providerContextTokens - DEFAULT_OUTPUT_RESERVE_TOKENS - SAFETY_HEADROOM_TOKENS)),
  )
  const softBudgetTokens = Math.max(1, Math.floor(hardBudgetTokens * SOFT_BUDGET_RATIO))
  const systemTokens = estimateContextTokens(input.system ?? "")
  const messageTokens = estimateMessagesTokens(input.messages)
  const toolTokens = estimateContextTokens(input.tools ?? [])
  const totalTokens = systemTokens + messageTokens + toolTokens
  const status = classifyContextPreflight({
    totalTokens,
    providerContextTokens,
    hardBudgetTokens,
    softBudgetTokens,
    messages: input.messages,
  })
  const result: ContextPreflightResult = {
    status,
    model: input.model,
    providerId: input.provider.id,
    operation: input.metadata?.operation ?? "llm_call",
    breakdown: {
      systemTokens,
      messageTokens,
      toolTokens,
      totalTokens,
      providerContextTokens,
      hardBudgetTokens,
      softBudgetTokens,
    },
    durationMs: Date.now() - startedAt,
    pruningDecisions: input.pruningDecisions ?? [],
    ...(status === "blocked_context_overflow"
      ? { userMessage: "모델에 보낼 문맥이 너무 커서 호출을 시작하지 않았습니다. 오래된 도구 결과를 줄이거나 대화를 새로 시작한 뒤 다시 시도해 주세요." }
      : {}),
  }
  recordContextPreflightResult(result, input.metadata)
  return result
}

export function pruneMessagesForContext(input: { messages: Message[] }): {
  messages: Message[]
  decisions: ContextPruningDecision[]
} {
  const recentStartIndex = Math.max(0, input.messages.length - RECENT_UNPRUNED_MESSAGE_COUNT)
  const decisions: ContextPruningDecision[] = []
  const messages = input.messages.map((message, messageIndex): Message => {
    if (typeof message.content === "string") {
      return { ...message, content: message.content }
    }
    const content = message.content.map((block, blockIndex) => {
      const typed = block as MessageContent & UnknownContentBlock
      if (typed.type !== "tool_result") return cloneBlock(typed) as unknown as MessageContent
      const original = typeof typed.content === "string" ? typed.content : renderUnknownValue(typed.content)
      const isRecent = messageIndex >= recentStartIndex
      const maxChars = isRecent ? RECENT_TOOL_RESULT_MAX_CHARS : OLD_TOOL_RESULT_MAX_CHARS
      const pruned = condenseToolResult(original, maxChars)
      if (pruned === original) return cloneBlock(typed) as unknown as MessageContent
      const strategy: ContextPruningDecision["strategy"] = maxChars < 300 ? "placeholder_hard_clear" : "head_tail_soft_trim"
      decisions.push({
        messageIndex,
        blockIndex,
        blockType: typed.type,
        originalChars: original.length,
        prunedChars: pruned.length,
        strategy,
      })
      return { ...cloneBlock(typed), content: pruned } as unknown as MessageContent
    })
    return { ...message, content }
  })
  return { messages, decisions }
}

export function prepareChatContext(input: ChatParams & {
  provider: AIProvider
  metadata?: ContextPreflightMetadata
}): ContextPreflightPreparedChat {
  const initial = runContextPreflight({
    provider: input.provider,
    model: input.model,
    messages: input.messages,
    ...(input.system !== undefined ? { system: input.system } : {}),
    ...(input.tools !== undefined ? { tools: input.tools } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })
  if (initial.status === "ok") return { ...initial, initialStatus: initial.status, messages: input.messages }

  const pruned = pruneMessagesForContext({ messages: input.messages })
  const afterPruning = runContextPreflight({
    provider: input.provider,
    model: input.model,
    messages: pruned.messages,
    ...(input.system !== undefined ? { system: input.system } : {}),
    ...(input.tools !== undefined ? { tools: input.tools } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    pruningDecisions: pruned.decisions,
  })

  const finalStatus = afterPruning.breakdown.totalTokens > afterPruning.breakdown.hardBudgetTokens
    ? "blocked_context_overflow"
    : afterPruning.status === "blocked_context_overflow"
      ? "blocked_context_overflow"
      : afterPruning.status

  return {
    ...afterPruning,
    status: finalStatus,
    initialStatus: initial.status,
    messages: pruned.messages,
    ...(finalStatus === "blocked_context_overflow"
      ? { userMessage: "문맥 정리 후에도 모델 한도를 초과해 호출을 중단했습니다. 오래된 도구 결과나 긴 파일 내용을 줄인 뒤 다시 시도해 주세요." }
      : {}),
  }
}

export async function* chatWithContextPreflight(input: ChatParams & {
  provider: AIProvider
  metadata?: ContextPreflightMetadata
}): AsyncGenerator<AIChunk> {
  const prepared = prepareChatContext(input)
  if (prepared.status === "blocked_context_overflow") {
    recordContextPreflightResult(prepared, input.metadata)
    throw new ContextPreflightBlockedError(prepared)
  }
  yield* input.provider.chat({
    model: input.model,
    messages: prepared.messages,
    ...(input.system !== undefined ? { system: input.system } : {}),
    ...(input.tools !== undefined ? { tools: input.tools } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  })
}

export function validateAgentPromptBundleContextScope(input: {
  bundle: Pick<AgentPromptBundle, "agentId" | "agentType" | "memoryPolicy">
  memoryRefs?: PromptBundleContextMemoryRef[]
  dataExchangePackages?: DataExchangePackage[]
  now?: () => number
}): PromptBundleContextScopeValidation {
  const issueCodes = new Set<string>()
  const blockedSourceRefs = new Set<string>()
  const now = input.now?.() ?? Date.now()
  const bundleOwnerIds = new Set([
    input.bundle.agentId,
    input.bundle.memoryPolicy.owner.ownerId,
    input.bundle.memoryPolicy.writeScope.ownerId,
    ...input.bundle.memoryPolicy.readScopes.map((scope) => scope.ownerId),
  ].filter(Boolean))
  const exchangesById = new Map((input.dataExchangePackages ?? []).map((pkg) => [pkg.exchangeId, pkg]))

  for (const ref of input.memoryRefs ?? []) {
    const exchange = ref.dataExchangeId ? exchangesById.get(ref.dataExchangeId) : undefined
    const sameOwner = bundleOwnerIds.has(ref.owner.ownerId)
    if (ref.visibility === "private" && !sameOwner && !exchange) {
      issueCodes.add("private_memory_without_explicit_exchange")
      blockedSourceRefs.add(ref.sourceRef)
      continue
    }
    if (exchange?.redactionState === "blocked") {
      issueCodes.add("data_exchange_blocked")
      blockedSourceRefs.add(ref.sourceRef)
      continue
    }
    if (exchange && exchange.expiresAt !== undefined && exchange.expiresAt !== null && exchange.expiresAt <= now) {
      issueCodes.add("data_exchange_expired")
      blockedSourceRefs.add(ref.sourceRef)
      continue
    }
    if (exchange && !exchange.purpose.trim()) {
      issueCodes.add("data_exchange_missing_purpose")
      blockedSourceRefs.add(ref.sourceRef)
      continue
    }
    if (exchange && exchange.provenanceRefs.length === 0) {
      issueCodes.add("data_exchange_missing_provenance")
      blockedSourceRefs.add(ref.sourceRef)
      continue
    }
    if (exchange && exchange.recipientOwner.ownerId !== input.bundle.agentId && exchange.recipientOwner.ownerId !== input.bundle.memoryPolicy.owner.ownerId) {
      issueCodes.add("data_exchange_wrong_recipient")
      blockedSourceRefs.add(ref.sourceRef)
      continue
    }
    if (exchange && exchange.allowedUse !== "temporary_context" && exchange.allowedUse !== "verification_only") {
      issueCodes.add("data_exchange_not_context_allowed")
      blockedSourceRefs.add(ref.sourceRef)
    }
  }

  return {
    ok: issueCodes.size === 0,
    issueCodes: [...issueCodes].sort(),
    blockedSourceRefs: [...blockedSourceRefs].sort(),
  }
}

function classifyContextPreflight(input: {
  totalTokens: number
  providerContextTokens: number
  hardBudgetTokens: number
  softBudgetTokens: number
  messages: Message[]
}): ContextPreflightStatus {
  if (input.totalTokens > input.providerContextTokens) return "blocked_context_overflow"
  if (input.totalTokens > input.hardBudgetTokens) return "needs_compaction"
  if (input.totalTokens > input.softBudgetTokens || hasLargeOldToolResult(input.messages)) return "needs_pruning"
  return "ok"
}

function resolveProviderContextTokens(provider: AIProvider, model: string): number {
  try {
    const resolver = (provider as Partial<AIProvider>).maxContextTokens
    const value = typeof resolver === "function"
      ? resolver.call(provider, model)
      : DEFAULT_PROVIDER_CONTEXT_TOKENS
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_PROVIDER_CONTEXT_TOKENS
    return Math.max(1, Math.floor(value))
  } catch {
    return DEFAULT_PROVIDER_CONTEXT_TOKENS
  }
}

function hasLargeOldToolResult(messages: Message[]): boolean {
  const recentStartIndex = Math.max(0, messages.length - RECENT_UNPRUNED_MESSAGE_COUNT)
  return messages.some((message, messageIndex) => {
    if (messageIndex >= recentStartIndex || !Array.isArray(message.content)) return false
    return message.content.some((block) => {
      const typed = block as MessageContent & UnknownContentBlock
      return typed.type === "tool_result" && typeof typed.content === "string" && typed.content.length > OLD_TOOL_RESULT_MAX_CHARS
    })
  })
}

function estimateMessageTokens(message: Message): number {
  if (typeof message.content === "string") return estimateTextTokens(message.content)
  return message.content.reduce((sum, block) => sum + estimateBlockTokens(block as unknown as UnknownContentBlock), 0)
}

function estimateBlockTokens(block: UnknownContentBlock): number {
  if (block.type === "text") return estimateTextTokens(typeof block.text === "string" ? block.text : "")
  if (block.type === "tool_result") return estimateTextTokens(typeof block.content === "string" ? block.content : renderUnknownValue(block.content))
  if (block.type === "tool_use") return estimateTextTokens(`${block.name ?? ""}\n${renderUnknownValue(block.input)}`)
  if (block.type === "image" || block.type === "image_url" || block.type === "file") return 1_000
  return estimateTextTokens(renderUnknownValue(block))
}

function estimateTextTokens(value: string): number {
  const normalized = value.replace(/\r/g, "").trim()
  if (!normalized) return 0
  return Math.max(1, Math.ceil(normalized.length / TOKEN_CHAR_RATIO))
}

function condenseToolResult(value: string, maxChars: number): string {
  const normalized = value.replace(/\r/g, "").trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars < 300) return `[tool_result_pruned: original_chars=${normalized.length}]`
  const headLength = Math.max(120, Math.floor(maxChars * 0.62))
  const tailLength = Math.max(80, maxChars - headLength - 120)
  const head = normalized.slice(0, headLength).trimEnd()
  const tail = normalized.slice(Math.max(headLength, normalized.length - tailLength)).trimStart()
  return [
    head,
    `[tool_result_pruned: original_chars=${normalized.length}]`,
    tail,
  ].filter(Boolean).join("\n")
}

function cloneBlock(block: UnknownContentBlock): UnknownContentBlock {
  return { ...block }
}

function renderUnknownValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function recordContextPreflightResult(result: ContextPreflightResult, metadata: ContextPreflightMetadata | undefined): void {
  const summary = `context_preflight ${result.status}: tokens=${result.breakdown.totalTokens}/${result.breakdown.providerContextTokens}`
  if (metadata?.runId) {
    try {
      appendRunEvent(metadata.runId, `context_preflight_status=${result.status} tokens=${result.breakdown.totalTokens} window=${result.breakdown.providerContextTokens} operation=${result.operation}`)
    } catch {
      // Preflight tracing must not block model calls.
    }
  }
  if (!metadata?.runId && !metadata?.sessionId && !metadata?.requestGroupId) return
  try {
    insertDiagnosticEvent({
      kind: "context_preflight",
      summary,
      ...(metadata?.runId ? { runId: metadata.runId } : {}),
      ...(metadata?.sessionId ? { sessionId: metadata.sessionId } : {}),
      ...(metadata?.requestGroupId ? { requestGroupId: metadata.requestGroupId } : {}),
      recoveryKey: `context_preflight:${result.operation}:${result.status}`,
      detail: {
        model: result.model,
        providerId: result.providerId,
        operation: result.operation,
        status: result.status,
        durationMs: result.durationMs,
        breakdown: result.breakdown,
        pruningDecisionCount: result.pruningDecisions.length,
        pruningDecisions: result.pruningDecisions.slice(0, 20),
        ...(result.userMessage ? { userMessage: result.userMessage } : {}),
      },
    })
  } catch {
    // Diagnostic persistence is best-effort.
  }
}
