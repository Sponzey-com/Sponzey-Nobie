import { getMessages, getMessagesForRequestGroup, getMessagesForRequestGroupWithRunMeta, getSchedulesForSession, getSession, isLegacySchedule } from "../db/index.js"
import { getConfig } from "../config/index.js"
import { detectAvailableProvider, getDefaultModel, getProvider } from "../ai/index.js"
import { createLogger } from "../logger/index.js"
import type { Message } from "../ai/types.js"
import { buildTaskIntakeSystemPrompt } from "./intake-prompt.js"
import type { TaskIntakeTaskProfile } from "./intake-prompt.js"
import { normalizeRequestForIntake } from "./request-normalizer.js"
import type { IntakeNormalizedRequest } from "./request-normalizer.js"
import { loadMergedInstructions } from "../instructions/merge.js"
import { selectRequestGroupContextMessages } from "./request-group-context.js"
import { buildUserProfilePromptContext } from "./profile-context.js"
import { getMqttExtensionSnapshots } from "../mqtt/broker.js"
import { describeCron } from "../scheduler/cron.js"
import { parseTelegramSessionKey } from "../channels/telegram/session.js"
import { chatWithContextPreflight } from "../runs/context-preflight.js"

const log = createLogger("agent:intake")

export type TaskApprovalToolName =
  | "screen_capture"
  | "yeonjang_camera_capture"
  | "mouse_click"
  | "keyboard_type"
  | "file_write"
  | "app_launch"
  | "external_action"

export interface TaskExecutionSemantics {
  filesystemEffect: "none" | "mutate"
  privilegedOperation: "none" | "required"
  artifactDelivery: "none" | "direct"
  approvalRequired: boolean
  approvalTool: TaskApprovalToolName
}

export type TaskStructuredRequestLanguage = "ko" | "en" | "mixed" | "unknown"

export interface TaskStructuredRequest {
  source_language: TaskStructuredRequestLanguage
  normalized_english: string
  target: string
  to: string
  context: string[]
  complete_condition: string[]
}

interface StructuredRequestEnvironment {
  destination: string
  contextLines: string[]
}

export interface TaskIntakeIntent {
  category: "direct_answer" | "task_intake" | "schedule_request" | "clarification" | "reject"
  summary: string
  confidence: number
}

export interface TaskIntakeUserMessage {
  mode: "direct_answer" | "accepted_receipt" | "failed_receipt" | "clarification_receipt"
  text: string
}

export interface TaskIntakeActionItem {
  id: string
  type: "reply" | "run_task" | "delegate_agent" | "create_schedule" | "update_schedule" | "cancel_schedule" | "ask_user" | "log_only"
  title: string
  priority: "low" | "normal" | "high" | "urgent"
  reason: string
  payload: Record<string, unknown>
}

export interface TaskSchedulingSpec {
  detected: boolean
  kind: "one_time" | "recurring" | "none"
  status: "accepted" | "failed" | "needs_clarification" | "not_applicable"
  schedule_text: string
  cron?: string
  run_at?: string
  failure_reason?: string
}

export interface TaskExecutionPlan {
  requires_run: boolean
  requires_delegation: boolean
  suggested_target: string
  max_delegation_turns: number
  needs_tools: boolean
  needs_web: boolean
  execution_semantics: TaskExecutionSemantics
}

export interface TaskIntentEnvelope {
  intent_type: TaskIntakeIntent["category"]
  source_language: TaskStructuredRequestLanguage
  normalized_english: string
  target: string
  destination: string
  context: string[]
  complete_condition: string[]
  schedule_spec: TaskSchedulingSpec
  execution_semantics: TaskExecutionSemantics
  delivery_mode: TaskExecutionSemantics["artifactDelivery"]
  requires_approval: boolean
  approval_tool: TaskApprovalToolName
  preferred_target: string
  needs_tools: boolean
  needs_web: boolean
}

export interface TaskIntakeResult {
  intent: TaskIntakeIntent
  user_message: TaskIntakeUserMessage
  action_items: TaskIntakeActionItem[]
  structured_request: TaskStructuredRequest
  intent_envelope: TaskIntentEnvelope
  scheduling: TaskSchedulingSpec
  execution: TaskExecutionPlan
  notes: string[]
}

export function defaultTaskExecutionSemantics(): TaskExecutionSemantics {
  return {
    filesystemEffect: "none",
    privilegedOperation: "none",
    artifactDelivery: "none",
    approvalRequired: false,
    approvalTool: "external_action",
  }
}

export function defaultTaskStructuredRequest(): TaskStructuredRequest {
  return {
    source_language: "unknown",
    normalized_english: "",
    target: "",
    to: "",
    context: [],
    complete_condition: [],
  }
}

export function parseTaskExecutionSemantics(value: unknown): TaskExecutionSemantics {
  if (!value || typeof value !== "object") return defaultTaskExecutionSemantics()
  const record = value as Record<string, unknown>

  return {
    filesystemEffect: record.filesystem_effect === "mutate" ? "mutate" : "none",
    privilegedOperation: record.privileged_operation === "required" ? "required" : "none",
    artifactDelivery: record.artifact_delivery === "direct" ? "direct" : "none",
    approvalRequired: record.approval_required === true,
    approvalTool: isApprovalToolName(record.approval_tool) ? record.approval_tool : "external_action",
  }
}

function inferStructuredRequestLanguage(text: string): TaskStructuredRequestLanguage {
  const hangulCount = (text.match(/[가-힣]/gu) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length

  if (hangulCount > 0 && latinCount > 0) return "mixed"
  if (hangulCount > 0) return "ko"
  if (latinCount > 0) return "en"
  return "unknown"
}


function normalizeStructuredText(value: string): string {
  return value.trim().replace(/\s+/gu, " ")
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function normalizeStructuredList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeStructuredText(item))
    .filter(Boolean)
}

const LITERAL_DELIVERY_PATTERNS = [
  /^(?:(?:메신저|메시지|텔레그램)(?:로)?\s*)?(?:"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’|(.+?))\s*(?:이?라고)\s*(?:(?:메신저|메시지|텔레그램)(?:로)?\s*)?(?:말해줘|말해 줘|알려줘|알려 줘|보내줘|보내 줘|해줘|해 줘|해주세요|해 주세요)$/u,
  /^(?:"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’|(.+?))\s*(?:이?라고)\s*(?:말해줘|말해 줘|알려줘|알려 줘|보내줘|보내 줘|해줘|해 줘|해주세요|해 주세요)$/u,
  /^(?:say|send)\s+(?:"([^"\n]+)"|'([^'\n]+)'|(.+?))\s+(?:in|via)\s+(?:telegram|message|messenger)$/iu,
  /^(?:say|tell)\s+(?:"([^"\n]+)"|'([^'\n]+)'|(.+?))$/iu,
] as const

function extractLiteralDeliveryText(text: string): string | null {
  const normalized = normalizeStructuredText(text)
  if (!normalized) return null

  for (const pattern of LITERAL_DELIVERY_PATTERNS) {
    const match = normalized.match(pattern)
    if (!match) continue
    const candidate = match.slice(1).find((value) => typeof value === "string" && value.trim().length > 0)
    if (!candidate) continue
    return candidate.trim()
  }

  return null
}

function buildStructuredRequestEnvironment(
  sessionId: string | undefined,
  source: "webui" | "cli" | "telegram" | "slack" | undefined,
): StructuredRequestEnvironment {
  const session = sessionId ? getSession(sessionId) : undefined
  const resolvedSource = session?.source ?? source ?? "unknown"

  if (resolvedSource === "telegram") {
    const parsed = session?.source_id ? parseTelegramSessionKey(session.source_id) : null
    if (parsed) {
      const destination = parsed.threadId !== undefined
        ? `telegram chat ${parsed.chatId}, thread ${parsed.threadId}`
        : `telegram chat ${parsed.chatId}, main thread`
      return {
        destination,
        contextLines: [
          `Delivery destination: ${destination}`,
          `Execution channel: telegram session ${sessionId ?? "unknown"}`,
        ],
      }
    }

    return {
      destination: `telegram session ${sessionId ?? "unknown"}`,
      contextLines: [`Execution channel: telegram session ${sessionId ?? "unknown"}`],
    }
  }

  if (resolvedSource === "webui") {
    return {
      destination: `webui session ${sessionId ?? "unknown"}`,
      contextLines: [`Execution channel: webui session ${sessionId ?? "unknown"}`],
    }
  }

  if (resolvedSource === "slack") {
    return {
      destination: `slack session ${sessionId ?? "unknown"}`,
      contextLines: [`Execution channel: slack session ${sessionId ?? "unknown"}`],
    }
  }

  if (resolvedSource === "cli") {
    return {
      destination: `cli session ${sessionId ?? "unknown"}`,
      contextLines: [`Execution channel: cli session ${sessionId ?? "unknown"}`],
    }
  }

  if (sessionId) {
    return {
      destination: `session ${sessionId}`,
      contextLines: [`Execution channel: session ${sessionId}`],
    }
  }

  return {
    destination: "the active session destination",
    contextLines: ["Execution channel: active session destination"],
  }
}

function buildNormalizedEnglishSummary(request: Omit<TaskStructuredRequest, "normalized_english">): string {
  return [
    `Target: ${request.target}`,
    request.to ? `To: ${request.to}` : "",
    request.context.length > 0
      ? `Context: ${request.context.join(" | ")}`
      : "",
    request.complete_condition.length > 0
      ? `Complete condition: ${request.complete_condition.join(" | ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function inferStructuredRequestTarget(
  userMessage: string,
  intentSummary: string,
  actionItems: TaskIntakeActionItem[],
): string {
  for (const action of actionItems) {
    const payload = action.payload
    const literalDeliveryCandidate = [
      getString(payload.content),
      getString(payload.task),
      getString(payload.goal),
      action.title,
    ]
      .map((value) => (typeof value === "string" ? extractLiteralDeliveryText(value) : null))
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    if (literalDeliveryCandidate) {
      return `Deliver the exact literal text "${literalDeliveryCandidate.trim()}".`
    }

    const candidates = [
      getString(payload.goal),
      getString(payload.task),
      getString(payload.question),
      getString(payload.content),
      action.title,
    ]
      .map((value) => (typeof value === "string" ? normalizeStructuredText(value) : ""))
      .filter(Boolean)
    const firstCandidate = candidates[0]
    if (firstCandidate) return firstCandidate
  }

  return normalizeStructuredText(intentSummary || userMessage)
}

function inferStructuredRequestTo(
  actionItems: TaskIntakeActionItem[],
  scheduling: TaskSchedulingSpec,
  execution: TaskExecutionPlan,
  environment: StructuredRequestEnvironment,
): string {
  const replyAction = actionItems.find((action) => action.type === "reply")
  const createScheduleAction = actionItems.find((action) => action.type === "create_schedule")

  if (replyAction) {
    return environment.destination
  }

  if (createScheduleAction) {
    const literalDeliveryCandidate = [
      getString(createScheduleAction.payload.task),
      getString(createScheduleAction.payload.goal),
      createScheduleAction.title,
    ]
      .map((value) => (typeof value === "string" ? extractLiteralDeliveryText(value) : null))
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)

    if (literalDeliveryCandidate) {
      return `${environment.destination} at the scheduled time`
    }
  }

  if (execution.execution_semantics.artifactDelivery === "direct") {
    return environment.destination
  }

  if (actionItems.some((action) => action.type === "ask_user")) {
    return `the user in ${environment.destination}`
  }

  if (scheduling.detected) {
    return `${environment.destination} at the scheduled time`
  }

  return "the current execution target"
}

function inferStructuredRequestContext(
  userMessage: string,
  actionItems: TaskIntakeActionItem[],
  scheduling: TaskSchedulingSpec,
  environment: StructuredRequestEnvironment,
): string[] {
  const contexts: string[] = [...environment.contextLines]
  const conversationContext = normalizeStructuredText(userMessage)
  if (conversationContext) {
    contexts.push(`Original user request: ${conversationContext}`)
  }

  for (const action of actionItems) {
    const payload = action.payload
    const payloadContext = getString(payload.context)
    if (payloadContext) {
      contexts.push(normalizeStructuredText(payloadContext))
    }
  }

  if (scheduling.detected) {
    const scheduleParts = [
      scheduling.kind !== "none" ? `Schedule kind: ${scheduling.kind}` : "",
      scheduling.schedule_text ? `Schedule: ${normalizeStructuredText(scheduling.schedule_text)}` : "",
      scheduling.run_at ? `Run at: ${normalizeStructuredText(scheduling.run_at)}` : "",
      scheduling.cron ? `Cron: ${normalizeStructuredText(scheduling.cron)}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
    if (scheduleParts) {
      contexts.push(scheduleParts)
    }
  }

  return Array.from(new Set(contexts))
}

function inferStructuredRequestCompleteCondition(
  intent: TaskIntakeIntent,
  actionItems: TaskIntakeActionItem[],
  scheduling: TaskSchedulingSpec,
  environment: StructuredRequestEnvironment,
): string[] {
  for (const action of actionItems) {
    const payloadConditions = normalizeStructuredList(action.payload.success_criteria)
    if (payloadConditions.length > 0) return payloadConditions
  }

  if (actionItems.some((action) => action.type === "create_schedule")) {
    return [
      "The requested schedule is saved and active.",
      scheduling.schedule_text
        ? `The schedule timing matches ${normalizeStructuredText(scheduling.schedule_text)}.`
        : "The schedule timing is preserved as requested.",
    ]
  }

  if (actionItems.some((action) => action.type === "cancel_schedule")) {
    return ["The targeted active schedules are cancelled or disabled."]
  }

  if (actionItems.some((action) => action.type === "ask_user")) {
    return ["The missing required information is collected before execution continues."]
  }

  if (actionItems.some((action) => action.type === "reply")) {
    return [`A complete user-facing answer is returned in ${environment.destination}.`]
  }

  if (intent.category === "schedule_request") {
    return ["The requested scheduled task is registered and can execute later."]
  }

  if (intent.category === "clarification") {
    return ["The exact missing information is requested from the user."]
  }

  return [`The requested work is executed and the result is delivered in ${environment.destination}.`]
}

type TaskIntakeCoreResult = Omit<TaskIntakeResult, "structured_request" | "intent_envelope">

function finalizeStructuredArtifacts(params: {
  userMessage: string
  result: TaskIntakeCoreResult
  environment: StructuredRequestEnvironment
  structuredRequest: TaskStructuredRequest
  normalized?: IntakeNormalizedRequest
}): {
  structuredRequest: TaskStructuredRequest
  intentEnvelope: TaskIntentEnvelope
  notes: string[]
} {
  const notes = [...params.result.notes]
  const repairedFields: string[] = []
  const normalizedEnglish =
    normalizeStructuredText(params.structuredRequest.normalized_english)
    || params.normalized?.normalizedEnglish
    || buildNormalizedEnglishSummary(params.structuredRequest)
  if (!normalizeStructuredText(params.structuredRequest.normalized_english)) {
    repairedFields.push("normalized_english")
  }

  const target =
    normalizeStructuredText(params.structuredRequest.target)
    || inferStructuredRequestTarget(params.userMessage, params.result.intent.summary, params.result.action_items)
  if (!normalizeStructuredText(params.structuredRequest.target)) {
    repairedFields.push("target")
  }

  const destination =
    normalizeStructuredText(params.structuredRequest.to)
    || inferStructuredRequestTo(params.result.action_items, params.result.scheduling, params.result.execution, params.environment)
  if (!normalizeStructuredText(params.structuredRequest.to)) {
    repairedFields.push("destination")
  }

  const context =
    params.structuredRequest.context.length > 0
      ? params.structuredRequest.context
      : inferStructuredRequestContext(params.userMessage, params.result.action_items, params.result.scheduling, params.environment)
  if (params.structuredRequest.context.length === 0) {
    repairedFields.push("context")
  }

  const completeCondition =
    params.structuredRequest.complete_condition.length > 0
      ? params.structuredRequest.complete_condition
      : inferStructuredRequestCompleteCondition(params.result.intent, params.result.action_items, params.result.scheduling, params.environment)
  if (params.structuredRequest.complete_condition.length === 0) {
    repairedFields.push("complete_condition")
  }

  const structuredRequest: TaskStructuredRequest = {
    source_language: params.structuredRequest.source_language,
    normalized_english: normalizedEnglish,
    target,
    to: destination,
    context,
    complete_condition: completeCondition,
  }
  const intentEnvelope = buildTaskIntentEnvelope(params.result, structuredRequest)

  if (repairedFields.length > 0) {
    notes.push(`intent-envelope-repaired:${repairedFields.join(",")}`)
  }
  notes.push("intent-envelope-validated")

  return {
    structuredRequest,
    intentEnvelope,
    notes: Array.from(new Set(notes)),
  }
}

function looksLikePromissoryExecutionReceipt(message: string): boolean {
  return /(지금\s*바로\s*확인해드릴게요|확인해드릴게요|확인해볼게요|확인하겠습니다|조회해드릴게요|알려드릴게요|let me check|i(?:'| wi)ll check|checking now|looking it up|i(?:'| wi)ll look it up)/iu.test(message)
}

function looksLikeLiveInformationRequest(message: string): boolean {
  const normalized = message.trim()
  if (!normalized) return false
  const mentionsLiveTiming = /(지금|현재|오늘|실시간|latest|current|today|now)/iu.test(normalized)
  const mentionsLookupTopic = /(날씨|weather|기온|온도|forecast|news|headline|환율|rate|주가|stock|시세)/iu.test(normalized)
  return mentionsLiveTiming && mentionsLookupTopic
}

export function promotePromissoryDirectAnswer(
  result: TaskIntakeResult,
  latestUserMessage: string,
): TaskIntakeResult {
  const hasNonReplyAction = result.action_items.some((item) => item.type !== "reply")
  const shouldPromote = result.intent.category === "direct_answer"
    && result.user_message.mode === "direct_answer"
    && (
      result.execution.requires_run
      || result.execution.requires_delegation
      || result.execution.needs_tools
      || result.execution.needs_web
      || looksLikePromissoryExecutionReceipt(result.user_message.text)
      || looksLikeLiveInformationRequest(latestUserMessage)
    )

  if (!shouldPromote) return result

  const retainedActions = result.action_items.filter((item) => item.type !== "reply")
  const actionItems = retainedActions.length > 0
    ? retainedActions
    : [{
        id: "run-task-promoted-from-intake",
        type: "run_task" as const,
        title: result.structured_request.target || result.intent.summary || "요청 실행",
        priority: "normal" as const,
        reason: "직접 답변이 아니라 실제 후속 실행이 필요한 요청입니다.",
        payload: {
          goal: result.structured_request.normalized_english || result.structured_request.target || result.intent.summary,
          context: result.structured_request.context.join("\n"),
          task_profile: inferTaskProfileFromTask(latestUserMessage),
          preferred_target: result.execution.suggested_target || "auto",
          success_criteria: result.structured_request.complete_condition,
          constraints: [],
        },
      }]

  return {
    ...result,
    intent: {
      ...result.intent,
      category: "task_intake",
    },
    user_message: {
      mode: "accepted_receipt",
      text: result.user_message.text,
    },
    action_items: actionItems,
    execution: {
      ...result.execution,
      requires_run: true,
      needs_web: result.execution.needs_web || looksLikeLiveInformationRequest(latestUserMessage),
    },
    notes: Array.from(new Set([...result.notes, "promissory-direct-answer-promoted"])),
  }
}

function buildTaskIntentEnvelope(
  result: TaskIntakeCoreResult,
  structuredRequest: TaskStructuredRequest,
): TaskIntentEnvelope {
  return {
    intent_type: result.intent.category,
    source_language: structuredRequest.source_language,
    normalized_english: structuredRequest.normalized_english,
    target: structuredRequest.target,
    destination: structuredRequest.to,
    context: structuredRequest.context,
    complete_condition: structuredRequest.complete_condition,
    schedule_spec: result.scheduling,
    execution_semantics: result.execution.execution_semantics,
    delivery_mode: result.execution.execution_semantics.artifactDelivery,
    requires_approval: result.execution.execution_semantics.approvalRequired,
    approval_tool: result.execution.execution_semantics.approvalTool,
    preferred_target: result.execution.suggested_target,
    needs_tools: result.execution.needs_tools,
    needs_web: result.execution.needs_web,
  }
}

function synthesizeStructuredRequest(
  userMessage: string,
  result: TaskIntakeCoreResult,
  environment: StructuredRequestEnvironment,
  normalized?: IntakeNormalizedRequest,
): TaskStructuredRequest {
  const base = {
    source_language: normalized?.sourceLanguage ?? inferStructuredRequestLanguage(userMessage),
    target: inferStructuredRequestTarget(userMessage, result.intent.summary, result.action_items),
    to: inferStructuredRequestTo(result.action_items, result.scheduling, result.execution, environment),
    context: inferStructuredRequestContext(userMessage, result.action_items, result.scheduling, environment),
    complete_condition: inferStructuredRequestCompleteCondition(result.intent, result.action_items, result.scheduling, environment),
  } satisfies Omit<TaskStructuredRequest, "normalized_english">

  return {
    ...base,
    normalized_english: normalized?.normalizedEnglish || buildNormalizedEnglishSummary(base),
  }
}

function parseTaskStructuredRequest(
  value: unknown,
  fallbackUserMessage: string,
  fallbackResult: TaskIntakeCoreResult,
  environment: StructuredRequestEnvironment,
  normalized?: IntakeNormalizedRequest,
): TaskStructuredRequest {
  if (!value || typeof value !== "object") {
    return synthesizeStructuredRequest(fallbackUserMessage, fallbackResult, environment, normalized)
  }

  const record = value as Record<string, unknown>
  const sourceLanguage = isStructuredRequestLanguage(record.source_language)
    ? record.source_language
    : normalized?.sourceLanguage ?? inferStructuredRequestLanguage(fallbackUserMessage)
  const target = normalizeStructuredText(typeof record.target === "string" ? record.target : "")
  const to = normalizeStructuredText(typeof record.to === "string" ? record.to : "")
  const context = normalizeStructuredList(record.context)
  const completeCondition = normalizeStructuredList(record.complete_condition)

  const request: Omit<TaskStructuredRequest, "normalized_english"> = {
    source_language: sourceLanguage,
    target: target || inferStructuredRequestTarget(fallbackUserMessage, fallbackResult.intent.summary, fallbackResult.action_items),
    to: to || inferStructuredRequestTo(fallbackResult.action_items, fallbackResult.scheduling, fallbackResult.execution, environment),
    context: context.length > 0
      ? context
      : inferStructuredRequestContext(fallbackUserMessage, fallbackResult.action_items, fallbackResult.scheduling, environment),
    complete_condition: completeCondition.length > 0
      ? completeCondition
      : inferStructuredRequestCompleteCondition(fallbackResult.intent, fallbackResult.action_items, fallbackResult.scheduling, environment),
  }
  const normalizedEnglish = typeof record.normalized_english === "string"
    ? normalizeStructuredText(record.normalized_english)
    : ""

  return {
    ...request,
    normalized_english: normalizedEnglish || normalized?.normalizedEnglish || buildNormalizedEnglishSummary(request),
  }
}

function withStructuredRequest(
  userMessage: string,
  result: TaskIntakeCoreResult,
  environment: StructuredRequestEnvironment,
  normalized?: IntakeNormalizedRequest,
): TaskIntakeResult {
  const artifacts = finalizeStructuredArtifacts({
    userMessage,
    result,
    environment,
    structuredRequest: synthesizeStructuredRequest(userMessage, result, environment, normalized),
    ...(normalized ? { normalized } : {}),
  })
  return {
    ...result,
    notes: artifacts.notes,
    structured_request: artifacts.structuredRequest,
    intent_envelope: artifacts.intentEnvelope,
  }
}

export async function analyzeTaskIntake(params: {
  userMessage: string
  sessionId?: string
  requestGroupId?: string
  model?: string
  workDir?: string
  source?: "webui" | "cli" | "telegram" | "slack"
}): Promise<TaskIntakeResult | null> {
  const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns
  const environment = buildStructuredRequestEnvironment(params.sessionId, params.source)
  const normalized = normalizeRequestForIntake(params.userMessage)
  const intakeMessage = normalized.normalizedEnglish || params.userMessage
  const deterministicIntakeAllowed = looksLikeSlashCommand(params.userMessage)

  if (deterministicIntakeAllowed) {
    const scheduleManagement = detectSessionScheduleManagementRequest(
      intakeMessage,
      params.sessionId,
      maxDelegationTurns,
      environment,
      params.userMessage,
      normalized,
    )
    if (scheduleManagement) {
      log.info("schedule management heuristic matched", {
        sessionId: params.sessionId ?? null,
        category: scheduleManagement.intent.category,
        actions: scheduleManagement.action_items.map((item) => item.type),
      })
      return scheduleManagement
    }

    const heuristic = detectRelativeScheduleRequest(
      intakeMessage,
      Date.now(),
      maxDelegationTurns,
      environment,
      params.userMessage,
      normalized,
    )
    if (heuristic) {
      log.info("relative schedule heuristic matched", {
        sessionId: params.sessionId ?? null,
        category: heuristic.intent.category,
        schedule: heuristic.scheduling.schedule_text,
        runAt: heuristic.scheduling.run_at ?? null,
        actions: heuristic.action_items.map((item) => item.type),
      })
      return heuristic
    }
  }

  const model = params.model ?? getDefaultModel()
  const providerId = detectAvailableProvider()
  const provider = getProvider(providerId)
  const context = buildConversationContext(
    params.sessionId,
    params.requestGroupId,
    params.userMessage,
    normalized.normalizedEnglish,
    params.source,
  )
  const instructions = loadMergedInstructions(params.workDir ?? process.cwd())
  const profileContext = buildUserProfilePromptContext()
  log.debug("starting intake analysis", {
    sessionId: params.sessionId ?? null,
    model,
    providerId,
    workDir: params.workDir ?? process.cwd(),
    contextLength: context.length,
    instructionSources: instructions.chain.sources.map((source) => source.path),
  })

  const messages: Message[] = [
    {
      role: "user",
      content: [
        "Analyze the following conversation and latest user request.",
        "Return valid JSON only.",
        "",
        context,
      ].join("\n"),
    },
  ]

  let raw = ""

  for await (const chunk of chatWithContextPreflight({
    provider,
    model,
    messages,
    system: [
      buildTaskIntakeSystemPrompt({ maxDelegationTurns }),
      instructions.mergedText ? `\n[Instruction Chain]\n${instructions.mergedText}` : "",
      profileContext ? `\n${profileContext}` : "",
    ].join("\n"),
    tools: [],
    signal: new AbortController().signal,
    metadata: {
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
      operation: "task_intake",
    },
  })) {
    if (chunk.type === "text_delta") raw += chunk.delta
  }

  const parsed = parseTaskIntakeResult(raw, maxDelegationTurns, params.userMessage, environment, normalized)
  log.debug("finished intake analysis", {
    sessionId: params.sessionId ?? null,
    parsed: parsed == null
      ? null
      : {
        category: parsed.intent.category,
        actions: parsed.action_items.map((item) => item.type),
        scheduling: parsed.scheduling,
      },
    rawPreview: raw.slice(0, 600),
  })
  return parsed
}

function detectSessionScheduleManagementRequest(
  userMessage: string,
  sessionId: string | undefined,
  maxDelegationTurns: number,
  environment: StructuredRequestEnvironment,
  originalUserMessage = userMessage,
  normalized?: IntakeNormalizedRequest,
): TaskIntakeResult | null {
  if (!sessionId) return null

  const trimmed = userMessage.trim()
  if (!trimmed) return null

  const activeSchedules = getSchedulesForSession(sessionId, true)
  const activeContractSchedules = activeSchedules.filter((schedule) => !isLegacySchedule(schedule))
  const mentionsSchedule = /(예약|알림|스케줄|schedule|schedules|reminder|reminders|notification|notifications|alarm|alarms)/iu.test(trimmed)
  const looksLikeScheduleCancel = mentionsSchedule
    && /(취소|중지|꺼|멈춰|삭제|cancel|stop|disable|delete|remove|turn off)/iu.test(trimmed)
  const looksLikeScheduleList = !looksLikeScheduleCancel
    && mentionsSchedule
    && /(현재|활성|목록|리스트|보여|알려줘|current|active|list|show|tell me)/iu.test(trimmed)

  if (looksLikeScheduleCancel) {
    if (activeSchedules.length === 0) {
      return withStructuredRequest(originalUserMessage, {
        intent: {
          category: "direct_answer",
          summary: "취소할 활성 예약 알림이 없음",
          confidence: 0.99,
        },
        user_message: {
          mode: "direct_answer",
          text: "현재 이 대화에 취소할 활성 예약 알림은 없습니다.",
        },
        action_items: [{
          id: "reply-no-active-schedules",
          type: "reply",
          title: "활성 예약 알림 없음 응답",
          priority: "normal",
          reason: "현재 세션에 활성 예약 알림이 없습니다.",
          payload: { content: "현재 이 대화에 취소할 활성 예약 알림은 없습니다." },
        }],
        scheduling: {
          detected: true,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution: {
          requires_run: false,
          requires_delegation: false,
          suggested_target: "auto",
          max_delegation_turns: maxDelegationTurns,
          needs_tools: false,
          needs_web: false,
          execution_semantics: defaultTaskExecutionSemantics(),
        },
        notes: ["session-schedule-management", "cancel-schedules", "none-active"],
      }, environment, normalized)
    }

    if (activeContractSchedules.length === 0) {
      const choices = activeSchedules.map((schedule, index) => `${index + 1}. ${schedule.name}`).join("\n")
      return withStructuredRequest(originalUserMessage, {
        intent: {
          category: "clarification",
          summary: "구조화된 취소 대상이 없어 예약 선택 필요",
          confidence: 0.95,
        },
        user_message: {
          mode: "clarification_receipt",
          text: `취소할 예약 알림을 직접 선택해 주세요.\n${choices}`,
        },
        action_items: [{
          id: "ask-cancel-schedule-target",
          type: "ask_user",
          title: "취소할 예약 알림 확인",
          priority: "normal",
          reason: "자연어 문구만으로 기존 예약을 확정 취소하지 않습니다.",
          payload: { question: "어떤 예약 알림을 취소할까요?", missing_fields: ["schedule_target"] },
        }],
        scheduling: {
          detected: true,
          kind: "recurring",
          status: "needs_clarification",
          schedule_text: activeSchedules.map((schedule) => describeCron(schedule.cron_expression)).join(", "),
        },
        execution: {
          requires_run: false,
          requires_delegation: false,
          suggested_target: "auto",
          max_delegation_turns: maxDelegationTurns,
          needs_tools: false,
          needs_web: false,
          execution_semantics: defaultTaskExecutionSemantics(),
        },
        notes: ["session-schedule-management", "cancel-schedules", "needs-target"],
      }, environment, normalized)
    }

    const choices = activeContractSchedules.map((schedule, index) => `${index + 1}. ${schedule.name}`).join("\n")
    return withStructuredRequest(originalUserMessage, {
      intent: {
        category: "clarification",
        summary: "예약 취소 대상 선택 필요",
        confidence: 0.95,
      },
      user_message: {
        mode: "clarification_receipt",
        text: `취소할 예약 알림을 선택해 주세요.\n${choices}`,
      },
      action_items: [{
        id: "ask-cancel-schedule-target",
        type: "ask_user",
        title: "취소할 예약 알림 확인",
        priority: "normal",
        reason: "scheduleId 없는 자연어 취소 요청은 확정 실행하지 않고 사용자의 선택을 받습니다.",
        payload: { question: "어떤 예약 알림을 취소할까요?", missing_fields: ["schedule_target"] },
      }],
      scheduling: {
        detected: true,
        kind: "recurring",
        status: "needs_clarification",
        schedule_text: activeContractSchedules.map((schedule) => describeCron(schedule.cron_expression)).join(", "),
      },
      execution: {
        requires_run: false,
        requires_delegation: false,
        suggested_target: "auto",
        max_delegation_turns: maxDelegationTurns,
        needs_tools: false,
        needs_web: false,
        execution_semantics: defaultTaskExecutionSemantics(),
      },
      notes: ["session-schedule-management", "cancel-schedules", "contract-target-clarification"],
    }, environment, normalized)
  }

  if (looksLikeScheduleList) {
    const content = activeSchedules.length === 0
      ? "현재 이 대화에 활성화된 예약 알림은 없습니다."
      : [
          "현재 이 대화에 활성화된 예약 알림입니다.",
          ...activeSchedules.map((schedule, index) => `${index + 1}. ${schedule.name} · ${describeCron(schedule.cron_expression)}`),
        ].join("\n")

    return withStructuredRequest(originalUserMessage, {
      intent: {
        category: "direct_answer",
        summary: "현재 대화의 활성 예약 알림 목록 조회",
        confidence: 0.99,
      },
      user_message: {
        mode: "direct_answer",
        text: content,
      },
      action_items: [{
        id: "reply-active-schedules",
        type: "reply",
        title: "활성 예약 알림 목록 응답",
        priority: "normal",
        reason: "현재 세션에 연결된 활성 예약 알림을 보여줍니다.",
        payload: { content },
      }],
      scheduling: {
        detected: true,
        kind: activeSchedules.length > 0 ? "recurring" : "none",
        status: "not_applicable",
        schedule_text: activeSchedules.map((schedule) => describeCron(schedule.cron_expression)).join(", "),
      },
      execution: {
        requires_run: false,
        requires_delegation: false,
        suggested_target: "auto",
        max_delegation_turns: maxDelegationTurns,
        needs_tools: false,
        needs_web: false,
        execution_semantics: defaultTaskExecutionSemantics(),
      },
      notes: ["session-schedule-management", "list-schedules"],
    }, environment, normalized)
  }
  return null
}

export function detectRelativeScheduleRequest(
  userMessage: string,
  now = Date.now(),
  maxDelegationTurns = getConfig().orchestration.maxDelegationTurns,
  environment: StructuredRequestEnvironment = buildStructuredRequestEnvironment(undefined, undefined),
  originalUserMessage = userMessage,
  normalized?: IntakeNormalizedRequest,
): TaskIntakeResult | null {
  const parsedItems = parseRelativeDelays(userMessage)
  if (parsedItems.length === 0) return null
  const originalParsedItems = originalUserMessage === userMessage ? parsedItems : parseRelativeDelays(originalUserMessage)
  const displayItems = originalParsedItems.length === parsedItems.length ? originalParsedItems : parsedItems

  const missingTaskItems = parsedItems.filter((item) => !item.task)
  if (missingTaskItems.length > 0) {
    return withStructuredRequest(originalUserMessage, {
      intent: {
        category: "clarification",
        summary: "상대시간 일정 요청 중 일부 실행할 작업이 비어 있습니다.",
        confidence: 0.98,
      },
      user_message: {
        mode: "clarification_receipt",
        text: `${missingTaskItems.map((item) => item.delayLabel).join(", ")} 후에 무엇을 해야 하는지 비어 있습니다. 실행할 내용을 함께 알려주세요.`,
      },
      action_items: [
        {
          id: "ask-delayed-task",
          type: "ask_user",
          title: "지연 실행 내용 확인",
          priority: "normal",
          reason: "상대시간은 파악했지만 실행할 작업 내용이 없습니다.",
          payload: {
            question: "각 시간마다 무엇을 해야 하나요?",
            missing_fields: ["task"],
          },
        },
      ],
      scheduling: {
        detected: true,
        kind: "one_time",
        status: "needs_clarification",
        schedule_text: displayItems.map((item) => item.delayLabel).join(", "),
      },
      execution: {
        requires_run: false,
        requires_delegation: false,
        suggested_target: "auto",
        max_delegation_turns: maxDelegationTurns,
        needs_tools: false,
        needs_web: false,
        execution_semantics: defaultTaskExecutionSemantics(),
      },
      notes: ["relative-delay-heuristic"],
    }, environment, normalized)
  }

  const actionItems = parsedItems.map((item, index) => {
    const displayItem = displayItems[index] ?? item
    const runAt = new Date(now + item.delayMs).toISOString()
    const taskText = displayItem.task || item.task
    const literalDeliveryText = extractLiteralDeliveryText(taskText)
    const goal = literalDeliveryText
      ? `Deliver the exact literal text "${literalDeliveryText}" to ${environment.destination}.`
      : taskText
    return {
      id: `create-relative-delay-schedule-${index + 1}`,
      type: "create_schedule" as const,
      title: `${displayItem.delayLabel} 후 실행`,
      priority: "normal" as const,
      reason: "상대시간 기반 일회성 지연 실행 요청입니다.",
      payload: {
        title: `${displayItem.delayLabel} 후 실행`,
        task: taskText,
        schedule_kind: "one_time",
        schedule_text: displayItem.delayLabel,
        run_at: runAt,
        followup_run_payload: {
          goal,
          literal_text: literalDeliveryText ?? undefined,
          destination: environment.destination,
          task_profile: inferTaskProfileFromTask(item.task),
          preferred_target: "auto",
        },
      },
    }
  })

  return withStructuredRequest(originalUserMessage, {
    intent: {
      category: "schedule_request",
      summary: displayItems.map((item) => `${item.delayLabel} 후 실행 요청: ${item.task}`).join(" / "),
      confidence: 0.99,
    },
    user_message: {
      mode: "accepted_receipt",
      text: displayItems.length === 1
        ? `${displayItems[0]?.delayLabel} 후에 "${displayItems[0]?.task}" 작업을 실행하도록 접수했습니다.`
        : "여러 예약 작업을 접수했습니다.",
    },
    action_items: actionItems,
    scheduling: {
      detected: true,
      kind: "one_time",
      status: "accepted",
      schedule_text: displayItems.map((item) => item.delayLabel).join(", "),
    },
      execution: {
        requires_run: false,
        requires_delegation: false,
        suggested_target: "auto",
        max_delegation_turns: maxDelegationTurns,
        needs_tools: false,
        needs_web: false,
        execution_semantics: defaultTaskExecutionSemantics(),
      },
      notes: parsedItems.length > 1
        ? ["relative-delay-heuristic", "multi-action-item"]
        : ["relative-delay-heuristic"],
  }, environment, normalized)
}

function buildConversationContext(
  sessionId: string | undefined,
  requestGroupId: string | undefined,
  latestUserMessage: string,
  normalizedEnglishMessage: string,
  source: "webui" | "cli" | "telegram" | "slack" | undefined,
): string {
  const lines: string[] = []
  const environment = buildStructuredRequestEnvironment(sessionId, source)

  if (sessionId) {
    const recentMessages = requestGroupId
      ? selectRequestGroupContextMessages(getMessagesForRequestGroupWithRunMeta(sessionId, requestGroupId))
      : getMessages(sessionId)
    const recent = recentMessages.slice(-8)
    if (recent.length > 0) {
      lines.push("Recent conversation:")
      for (const message of recent) {
        const role = message.role === "assistant" ? "assistant" : "user"
        const content = message.content.trim()
        if (content) {
          lines.push(`- ${role}: ${content}`)
        }
      }
      lines.push("")
    }
  }

  const runtimeContext = buildRuntimeIntakeContext()
  if (runtimeContext.length > 0) {
    lines.push("Runtime environment:")
    lines.push(...runtimeContext)
    lines.push("")
  }

  lines.push("Delivery environment:")
  lines.push(...environment.contextLines.map((line) => `- ${line}`))
  lines.push("")

  lines.push("Normalized English request:")
  lines.push(normalizedEnglishMessage.trim() || latestUserMessage.trim())
  lines.push("")

  lines.push("Latest user message (original):")
  lines.push(latestUserMessage.trim())

  return lines.join("\n")
}

function buildRuntimeIntakeContext(): string[] {
  const snapshots = getMqttExtensionSnapshots()
  const connected = snapshots.filter((item) => (item.state ?? "").toLowerCase() !== "offline")

  if (connected.length === 0) return []

  const lines = [`- Connected Yeonjang extensions: ${connected.length}`]
  for (const extension of connected.slice(0, 4)) {
    lines.push(
      `- Extension: ${extension.extensionId}`
      + `${extension.displayName ? ` (${extension.displayName})` : ""}`
      + `${extension.state ? `, state=${extension.state}` : ""}`,
    )
  }

  if (connected.length === 1) {
    const only = connected[0]
    lines.push(
      `- There is exactly one connected extension (${only?.extensionId ?? "unknown"}). `
      + "Unless the user explicitly mentions another device or another computer, do not ask which device to use.",
    )
  }

  return lines
}

function looksLikeExplicitScheduleManagementCommand(userMessage: string): boolean {
  const trimmed = userMessage.trim()
  if (!trimmed) return false

  const mentionsSchedule = /(예약|알림|스케줄|schedule|schedules|reminder|reminders|notification|notifications|alarm|alarms)/iu.test(trimmed)
  if (!mentionsSchedule) return false

  return /^(?:please\s+)?(?:(?:show|list|display|cancel|stop|disable|delete|remove|turn off|what(?:'s| is))\b|\b(?:current|active)\b|(?:현재|활성|목록|리스트|보여|알려줘|취소|중지|삭제))/iu.test(trimmed)
}

function looksLikeSlashCommand(userMessage: string): boolean {
  return /^\/[A-Za-z0-9][\w-]*/.test(userMessage.trim())
}

function parseRelativeDelays(userMessage: string): Array<{
  delayMs: number
  delayLabel: string
  task: string
}> {
  const trimmed = userMessage.trim()
  const koreanMatches = [...trimmed.matchAll(/(\d+)\s*(초|분|시간|일)\s*(?:뒤|후)(?:에)?/gu)]
  if (koreanMatches.length > 0) {
    return koreanMatches.flatMap((match, index) => {
      const amount = Number(match[1])
      const unit = match[2]
      if (!Number.isFinite(amount) || amount <= 0 || !unit || match.index == null) return []
      const nextIndex = koreanMatches[index + 1]?.index ?? trimmed.length
      const rawTask = trimmed.slice(match.index + match[0].length, nextIndex)
      const task = cleanRelativeDelayTask(rawTask)
      const unitMs = unit === "초"
        ? 1_000
        : unit === "분"
          ? 60_000
          : unit === "시간"
            ? 3_600_000
            : 86_400_000
      return [{
        delayMs: amount * unitMs,
        delayLabel: `${amount}${unit}`,
        task,
      }]
    })
  }

  const englishMatches = [...trimmed.matchAll(/(?:(?:in|after)\s+(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)|(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\s+later)/gi)]
  if (englishMatches.length > 0) {
    return englishMatches.flatMap((match, index) => {
      const amount = Number(match[1] ?? match[3])
      const unit = (match[2] ?? match[4] ?? "").toLowerCase()
      if (!Number.isFinite(amount) || amount <= 0 || !unit || match.index == null) return []
      const nextIndex = englishMatches[index + 1]?.index ?? trimmed.length
      const rawTask = trimmed.slice(match.index + match[0].length, nextIndex)
      const task = cleanRelativeDelayTask(rawTask)
      const unitMs = unit.startsWith("second") || unit.startsWith("sec")
        ? 1_000
        : unit.startsWith("minute") || unit.startsWith("min")
          ? 60_000
          : unit.startsWith("hour") || unit.startsWith("hr")
            ? 3_600_000
            : 86_400_000
      return [{
        delayMs: amount * unitMs,
        delayLabel: `${amount}${unit.startsWith("second") || unit.startsWith("sec") ? "초" : unit.startsWith("minute") || unit.startsWith("min") ? "분" : unit.startsWith("hour") || unit.startsWith("hr") ? "시간" : "일"}`,
        task,
      }]
    })
  }

  return []
}

function cleanRelativeDelayTask(value: string): string {
  return value
    .trim()
    .replace(/^[,\s]+/u, "")
    .replace(/^(?:그리고|그다음|그 다음|and then|and|then)\s+/iu, "")
    .replace(/^(?:는|은|이|가|을|를)\s+/u, "")
    .replace(/[,\s]+$/u, "")
    .replace(/\s*(?:그리고|그다음|그 다음|and then|and|then)\s*$/iu, "")
}

function inferTaskProfileFromTask(task: string): TaskIntakeTaskProfile {
  const normalized = task.toLowerCase()
  if (/\b(code|bug|fix|refactor|test|build|repo|file)\b/i.test(task) || /코드|버그|수정|리팩터링|테스트|빌드|파일/u.test(task)) {
    return "coding"
  }
  if (/\b(search|browse|web|latest|official|docs?)\b/i.test(normalized) || /검색|웹|최신|공식|문서/u.test(task)) {
    return "research"
  }
  if (/\b(plan|design|roadmap|architecture|compare)\b/i.test(normalized) || /계획|설계|로드맵|아키텍처|비교/u.test(task)) {
    return "planning"
  }
  if (/\b(run|execute|open|click|type|paste|app|process)\b/i.test(normalized) || /실행|열어|클릭|입력|붙여넣기|앱|프로세스/u.test(task)) {
    return "operations"
  }
  return "general_chat"
}

function parseTaskIntakeResult(
  raw: string,
  maxDelegationTurns: number,
  latestUserMessage: string,
  environment: StructuredRequestEnvironment,
  normalized?: IntakeNormalizedRequest,
): TaskIntakeResult | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const jsonLike = extractJsonObject(trimmed)
  if (!jsonLike) return null

  try {
    const parsed = JSON.parse(jsonLike) as Partial<TaskIntakeResult>
    if (!parsed.intent || !parsed.user_message || !Array.isArray(parsed.action_items) || !parsed.scheduling || !parsed.execution) {
      return null
    }
    if (typeof parsed.intent.summary !== "string" || typeof parsed.user_message.text !== "string") {
      return null
    }
    const resultWithoutStructuredArtifacts: TaskIntakeCoreResult = {
      intent: {
        category: isIntentCategory(parsed.intent.category) ? parsed.intent.category : "clarification",
        summary: parsed.intent.summary,
        confidence: typeof parsed.intent.confidence === "number" ? parsed.intent.confidence : 0,
      },
      user_message: {
        mode: isMessageMode(parsed.user_message.mode) ? parsed.user_message.mode : "clarification_receipt",
        text: parsed.user_message.text,
      },
      action_items: parsed.action_items
        .filter((item): item is TaskIntakeActionItem =>
          typeof item?.id === "string"
          && isActionType(item.type)
          && typeof item.title === "string"
          && isPriority(item.priority)
          && typeof item.reason === "string"
          && !!item.payload
          && typeof item.payload === "object",
        ),
      scheduling: {
        detected: Boolean(parsed.scheduling.detected),
        kind: parsed.scheduling.kind === "one_time" || parsed.scheduling.kind === "recurring" ? parsed.scheduling.kind : "none",
        status:
          parsed.scheduling.status === "accepted"
          || parsed.scheduling.status === "failed"
          || parsed.scheduling.status === "needs_clarification"
            ? parsed.scheduling.status
            : "not_applicable",
        schedule_text: typeof parsed.scheduling.schedule_text === "string" ? parsed.scheduling.schedule_text : "",
        ...(typeof parsed.scheduling.cron === "string" ? { cron: parsed.scheduling.cron } : {}),
        ...(typeof parsed.scheduling.run_at === "string" ? { run_at: parsed.scheduling.run_at } : {}),
        ...(typeof parsed.scheduling.failure_reason === "string" ? { failure_reason: parsed.scheduling.failure_reason } : {}),
      },
      execution: {
        requires_run: Boolean(parsed.execution.requires_run),
        requires_delegation: Boolean(parsed.execution.requires_delegation),
        suggested_target: typeof parsed.execution.suggested_target === "string" ? parsed.execution.suggested_target : "auto",
        max_delegation_turns: typeof parsed.execution.max_delegation_turns === "number" ? parsed.execution.max_delegation_turns : maxDelegationTurns,
        needs_tools: Boolean(parsed.execution.needs_tools),
        needs_web: Boolean(parsed.execution.needs_web),
        execution_semantics: parseTaskExecutionSemantics(parsed.execution.execution_semantics),
      },
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter((item): item is string => typeof item === "string") : [],
    }

    const artifacts = finalizeStructuredArtifacts({
      userMessage: latestUserMessage,
      result: resultWithoutStructuredArtifacts,
      environment,
      structuredRequest: parseTaskStructuredRequest(
        parsed.structured_request,
        latestUserMessage,
        resultWithoutStructuredArtifacts,
        environment,
        normalized,
      ),
      ...(normalized ? { normalized } : {}),
    })
    return promotePromissoryDirectAnswer({
      ...resultWithoutStructuredArtifacts,
      notes: artifacts.notes,
      structured_request: artifacts.structuredRequest,
      intent_envelope: artifacts.intentEnvelope,
    }, latestUserMessage)
  } catch {
    return null
  }
}

function extractJsonObject(text: string): string | null {
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  const start = withoutFence.indexOf("{")
  const end = withoutFence.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return withoutFence.slice(start, end + 1)
}

function isIntentCategory(value: unknown): value is TaskIntakeIntent["category"] {
  return value === "direct_answer" || value === "task_intake" || value === "schedule_request" || value === "clarification" || value === "reject"
}

function isMessageMode(value: unknown): value is TaskIntakeUserMessage["mode"] {
  return value === "direct_answer" || value === "accepted_receipt" || value === "failed_receipt" || value === "clarification_receipt"
}

function isActionType(value: unknown): value is TaskIntakeActionItem["type"] {
  return value === "reply"
    || value === "run_task"
    || value === "delegate_agent"
    || value === "create_schedule"
    || value === "update_schedule"
    || value === "cancel_schedule"
    || value === "ask_user"
    || value === "log_only"
}

function isPriority(value: unknown): value is TaskIntakeActionItem["priority"] {
  return value === "low" || value === "normal" || value === "high" || value === "urgent"
}

function isApprovalToolName(value: unknown): value is TaskApprovalToolName {
  return value === "screen_capture"
    || value === "yeonjang_camera_capture"
    || value === "mouse_click"
    || value === "keyboard_type"
    || value === "file_write"
    || value === "app_launch"
    || value === "external_action"
}

function isStructuredRequestLanguage(value: unknown): value is TaskStructuredRequestLanguage {
  return value === "ko" || value === "en" || value === "mixed" || value === "unknown"
}
