import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { homedir } from "node:os"
import type { AgentChunk, AgentContextMode } from "../agent/index.js"
import { reviewTaskCompletion } from "../agent/completion-review.js"
import {
  analyzeRequestEntrySemantics,
  analyzeTaskIntake,
  buildActiveQueueCancellationMessage,
  defaultTaskExecutionSemantics,
  defaultTaskStructuredRequest,
  type ActiveQueueCancellationMode,
  type TaskExecutionSemantics,
  type TaskStructuredRequest,
  type TaskIntakeActionItem,
  type TaskIntakeResult,
} from "../agent/intake.js"
import { runAgent } from "../agent/index.js"
import { eventBus } from "../events/index.js"
import type { ApprovalDecision, ApprovalResolutionReason } from "../events/index.js"
import { getDb, getSchedule, getSession, insertMessage, insertSchedule, insertSession, updateSchedule } from "../db/index.js"
import { getConfig } from "../config/index.js"
import type { LLMProvider } from "../llm/index.js"
import { inferProviderId } from "../llm/index.js"
import { createLogger } from "../logger/index.js"
import { loadMergedInstructions } from "../instructions/merge.js"
import { loadNobieMd } from "../memory/nobie-md.js"
import { condenseMemoryText, extractFocusedErrorMessage, insertMemoryJournalRecord } from "../memory/journal.js"
import { resolveRunRoute } from "./routing.js"
import { isValidCron } from "../scheduler/cron.js"
import { reconcileScheduleExecution, removeManagedScheduleExecution } from "../scheduler/system-cron.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import { runWorkerRuntime } from "./worker-runtime.js"
import { buildScheduledFollowupPrompt, extractDirectChannelDeliveryText, getScheduledRunExecutionOptions } from "./scheduled.js"
import { grantRunApprovalScope, grantRunSingleApproval } from "../tools/dispatcher.js"
import {
  appendRunEvent,
  bindActiveRunController,
  clearActiveRunController,
  createRootRun,
  cancelRootRun,
  getRootRun,
  isReusableRequestGroup,
  getRequestGroupDelegationTurnCount,
  listActiveSessionRequestGroups,
  findLatestWorkerSessionRun,
  findReconnectRequestGroupSelection,
  incrementDelegationTurnCount,
  interruptOrphanWorkerSessionRuns,
  setRunStepStatus,
  updateRunStatus,
  updateRunSummary,
} from "./store.js"

const log = createLogger("runs:start")
const MAX_DELAY_TIMER_MS = 2_147_483_647
const delayedRunTimers = new Map<string, NodeJS.Timeout>()
const delayedSessionQueues = new Map<string, Promise<void>>()
const requestGroupExecutionQueues = new Map<string, Promise<RootRun | undefined>>()
const syntheticApprovalScopes = new Set<string>()

function normalizeTaskProfile(taskProfile: string | undefined): TaskProfile {
  switch (taskProfile) {
    case "planning":
    case "coding":
    case "review":
    case "research":
    case "private_local":
    case "summarization":
    case "operations":
      return taskProfile
    default:
      return "general_chat"
  }
}

function mapTaskProfileToWorkerRole(taskProfile: TaskProfile): string {
  switch (taskProfile) {
    case "coding":
      return "coding"
    case "research":
      return "research"
    case "review":
      return "verification"
    case "operations":
    case "private_local":
      return "local-ops"
    case "planning":
    case "summarization":
      return "planning"
    default:
      return "general"
  }
}

function buildWorkerSessionId(params: {
  isRootRequest: boolean
  requestGroupId: string
  taskProfile: TaskProfile
  targetId?: string
  workerRuntime?: WorkerRuntimeTarget
}): string | undefined {
  if (params.isRootRequest && !params.workerRuntime) return undefined

  const workerRole = mapTaskProfileToWorkerRole(params.taskProfile)
  const rawTarget = params.workerRuntime?.kind || params.targetId || "default"
  const normalizedTarget = rawTarget
    .replace(/^provider:/, "")
    .replace(/^worker:/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()

  return `B-${params.requestGroupId.slice(0, 8)}-${workerRole}-${normalizedTarget || "default"}`
}

function markAbortedRunCancelledIfActive(runId: string): void {
  const current = getRootRun(runId)
  if (!current) return
  if (current.status === "interrupted" || current.status === "cancelled" || current.status === "completed" || current.status === "failed") {
    return
  }
  updateRunStatus(runId, "cancelled", "사용자가 실행을 취소했습니다.", false)
}

async function tryHandleActiveQueueCancellation(params: {
  runId: string
  sessionId: string
  source: StartRootRunParams["source"]
  onChunk: StartRootRunParams["onChunk"]
  message: string
  mode: ActiveQueueCancellationMode | null
}): Promise<LoopDirective | null> {
  if (!params.mode) return null

  const activeGroups = listActiveSessionRequestGroups(params.sessionId, params.runId)
  if (activeGroups.length === 0) {
    return {
      kind: "complete",
      text: buildActiveQueueCancellationMessage({
        originalMessage: params.message,
        mode: params.mode,
        cancelledTitles: [],
        remainingCount: 0,
        hadTargets: false,
      }),
      eventLabel: "취소 요청 결과 전달",
    }
  }

  const targets = params.mode === "all" ? activeGroups : activeGroups.length > 0 ? [activeGroups[0]!] : []
  const cancelledTitles: string[] = []
  for (const target of targets) {
    const cancelled = cancelRootRun(target.id)
    if (cancelled) cancelledTitles.push(target.title)
  }

  const remainingCount = Math.max(0, activeGroups.length - cancelledTitles.length)
  return {
    kind: "complete",
    text: buildActiveQueueCancellationMessage({
      originalMessage: params.message,
      mode: params.mode,
      cancelledTitles,
      remainingCount,
      hadTargets: cancelledTitles.length > 0,
    }),
    eventLabel: "취소 요청 결과 전달",
  }
}

function inferDelegatedTaskProfile(params: {
  intake: TaskIntakeResult
  action: TaskIntakeActionItem
}): string {
  const payload = params.action.payload
  const explicit = getString(payload.task_profile) || getString(payload.taskProfile)
  if (explicit) return explicit
  return normalizeTaskProfile(params.intake.intent.category === "schedule_request" ? "operations" : "general_chat")
}

export interface StartRootRunParams {
  message: string
  sessionId: string | undefined
  requestGroupId?: string | undefined
  forceRequestGroupReuse?: boolean | undefined
  model: string | undefined
  providerId?: string | undefined
  provider?: LLMProvider | undefined
  targetId?: string | undefined
  targetLabel?: string | undefined
  workerRuntime?: WorkerRuntimeTarget | undefined
  workDir?: string | undefined
  source: "webui" | "cli" | "telegram"
  skipIntake?: boolean | undefined
  toolsEnabled?: boolean | undefined
  contextMode?: AgentContextMode | undefined
  taskProfile?: TaskProfile | undefined
  originalRequest?: string | undefined
  executionSemantics?: TaskExecutionSemantics | undefined
  structuredRequest?: TaskStructuredRequest | undefined
  immediateCompletionText?: string | undefined
  onChunk?: ((chunk: AgentChunk) => Promise<ChunkDeliveryReceipt | void> | ChunkDeliveryReceipt | void) | undefined
}

export interface StartedRootRun {
  runId: string
  sessionId: string
  status: "started"
  finished: Promise<RootRun | undefined>
}

type LoopDirective =
  | {
      kind: "complete"
      text: string
      eventLabel?: string
    }
  | {
      kind: "retry_intake"
      summary: string
      reason: string
      message: string
      remainingItems?: string[]
      eventLabel?: string
    }
  | {
      kind: "awaiting_user"
      preview: string
      summary: string
      reason?: string
      userMessage?: string
      remainingItems?: string[]
      eventLabel?: string
    }

function buildResolvedExecutionProfile(params: {
  message: string
  originalRequest?: string
  executionSemantics?: TaskExecutionSemantics
  structuredRequest?: TaskStructuredRequest
}): {
  originalRequest: string
  structuredRequest: TaskStructuredRequest
  executionSemantics: TaskExecutionSemantics
  requiresFilesystemMutation: boolean
  requiresPrivilegedToolExecution: boolean
  wantsDirectArtifactDelivery: boolean
  approvalRequired: boolean
  approvalTool: string
} {
  const executionSemantics = params.executionSemantics ?? defaultTaskExecutionSemantics()
  const structuredRequest = params.structuredRequest ?? buildFallbackStructuredRequest(params.originalRequest?.trim() || params.message)
  return {
    originalRequest: params.originalRequest?.trim() || params.message,
    structuredRequest,
    executionSemantics,
    requiresFilesystemMutation: executionSemantics.filesystemEffect === "mutate",
    requiresPrivilegedToolExecution: executionSemantics.privilegedOperation === "required",
    wantsDirectArtifactDelivery: executionSemantics.artifactDelivery === "direct",
    approvalRequired: executionSemantics.approvalRequired,
    approvalTool: executionSemantics.approvalTool,
  }
}

function allowsTextOnlyCompletion(params: { executionSemantics: TaskExecutionSemantics }): boolean {
  return params.executionSemantics.filesystemEffect === "none"
    && params.executionSemantics.privilegedOperation === "none"
    && params.executionSemantics.artifactDelivery === "none"
}

function buildFallbackStructuredRequest(message: string): TaskStructuredRequest {
  const normalized = message.trim()
  const sourceLanguage = /[가-힣]/u.test(normalized)
    ? /[A-Za-z]/.test(normalized) ? "mixed" : "ko"
    : /[A-Za-z]/.test(normalized) ? "en" : "unknown"

  return {
    ...defaultTaskStructuredRequest(),
    source_language: sourceLanguage,
    normalized_english: normalized,
    target: normalized || "Execute the requested work.",
    to: "the current channel",
    context: normalized ? [`Original user request: ${normalized}`] : [],
    complete_condition: ["The requested work is completed and the result is delivered in the current channel."],
  }
}

export function startRootRun(params: StartRootRunParams): StartedRootRun {
  const sessionId = params.sessionId ?? crypto.randomUUID()
  const runId = crypto.randomUUID()
  const entrySemantics = analyzeRequestEntrySemantics(params.message)
  const explicitReusableRequestGroupId =
    params.requestGroupId && (params.forceRequestGroupReuse || isReusableRequestGroup(params.requestGroupId))
      ? params.requestGroupId
      : undefined
  const requestedClosedRequestGroup = Boolean(params.requestGroupId && !params.forceRequestGroupReuse && !explicitReusableRequestGroupId)
  const shouldReconnectGroup = params.requestGroupId == null && entrySemantics.reuse_conversation_context
  const reconnectSelection = shouldReconnectGroup
    ? findReconnectRequestGroupSelection(sessionId, params.message)
    : undefined
  const reconnectTarget = reconnectSelection?.best
  const reconnectCandidateCount = reconnectSelection?.candidates?.length ?? 0
  const reconnectNeedsClarification = Boolean(
    shouldReconnectGroup
      && explicitReusableRequestGroupId == null
      && reconnectCandidateCount > 0
      && (!reconnectTarget || reconnectSelection?.ambiguous),
  )
  const requestGroupId = explicitReusableRequestGroupId ?? (reconnectNeedsClarification ? runId : reconnectTarget?.requestGroupId) ?? runId
  const isRootRequest = requestGroupId === runId
  const controller = new AbortController()
  const targetId = params.targetId ?? (params.model ? inferProviderId(params.model) : undefined)
  const effectiveTaskProfile = normalizeTaskProfile(params.taskProfile)
  const initialDelegationTurnCount = isRootRequest ? 0 : getRequestGroupDelegationTurnCount(requestGroupId)
  const now = Date.now()
  const workDir = params.workDir ?? process.cwd()
  const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns
  const shouldReuseContext = entrySemantics.reuse_conversation_context
  const effectiveContextMode = params.contextMode ?? (isRootRequest ? (shouldReuseContext ? "full" : "isolated") : "request_group")
  const workerSessionId = buildWorkerSessionId({
    isRootRequest,
    requestGroupId,
    taskProfile: effectiveTaskProfile,
    ...(targetId ? { targetId } : {}),
    ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
  })

  const reusableWorkerSessionRun = workerSessionId
    ? findLatestWorkerSessionRun(requestGroupId, workerSessionId)
    : undefined

  ensureSessionExists(sessionId, params.source, now)

  const run = createRootRun({
    id: runId,
    sessionId,
    requestGroupId,
    prompt: params.message,
    source: params.source,
    maxDelegationTurns,
    ...(targetId ? { targetId } : {}),
    ...(params.targetLabel?.trim() ? { targetLabel: params.targetLabel.trim() } : {}),
    taskProfile: effectiveTaskProfile,
    delegationTurnCount: initialDelegationTurnCount,
    ...(params.workerRuntime ? { workerRuntimeKind: params.workerRuntime.kind } : {}),
    ...(workerSessionId ? { workerSessionId } : {}),
    contextMode: effectiveContextMode,
  })

  rememberRunInstruction({
    runId,
    sessionId,
    requestGroupId,
    source: params.source,
    message: params.message,
  })

  bindActiveRunController(runId, controller)
  const interruptedWorkerRuns = workerSessionId
    ? interruptOrphanWorkerSessionRuns({
        requestGroupId,
        workerSessionId,
        keepRunId: runId,
      })
    : []
  const queuedBehindRequestGroupRun = requestGroupExecutionQueues.has(requestGroupId)
  setRunStepStatus(runId, "received", "completed", "요청을 받았습니다.")
  setRunStepStatus(runId, "classified", "completed", "일반 채팅 요청으로 분류했습니다.")
  setRunStepStatus(
    runId,
    "target_selected",
    "completed",
    params.targetLabel?.trim()
      ? `${params.targetLabel.trim()} 대상을 선택했습니다.`
      : params.model?.trim()
        ? `${params.model.trim()} 모델을 선택했습니다.`
        : "기본 실행 대상을 선택했습니다.",
  )
  if (queuedBehindRequestGroupRun) {
    setRunStepStatus(runId, "executing", "pending", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.")
    updateRunStatus(runId, "queued", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.", true)
    appendRunEvent(runId, "같은 요청 그룹의 이전 작업 대기")
  } else {
    setRunStepStatus(runId, "executing", "running", "응답을 생성 중입니다.")
    updateRunStatus(runId, "running", "응답을 생성 중입니다.", true)
    appendRunEvent(runId, "실행 시작")
  }
  if (reconnectTarget && requestGroupId !== runId) {
    appendRunEvent(runId, `기존 요청 그룹 재연결: ${reconnectTarget.title}`)
    updateRunSummary(runId, `기존 요청 "${reconnectTarget.title}" 작업 흐름에 이어서 연결합니다.`)
  }
  if (shouldReconnectGroup && reconnectCandidateCount === 0) {
    appendRunEvent(runId, "재사용 가능한 기존 태스크 후보가 없어 새 태스크로 시작합니다.")
  }
  if (requestedClosedRequestGroup) {
    appendRunEvent(runId, "완료/실패/취소된 기존 태스크는 재사용하지 않고 새 태스크로 시작합니다.")
  }
  if (workerSessionId) {
    if (reusableWorkerSessionRun) {
      appendRunEvent(runId, `기존 작업 세션 재사용: ${workerSessionId}`)
    } else {
      appendRunEvent(runId, `새 작업 세션 생성: ${workerSessionId}`)
    }
    appendRunEvent(runId, `작업 세션 연결: ${workerSessionId}`)
    if (interruptedWorkerRuns.length > 0) {
      appendRunEvent(runId, `이전 작업 세션 잔여 실행 ${interruptedWorkerRuns.length}건 정리`)
    }
  }

  const finished = enqueueRequestGroupRun(requestGroupId, runId, async () => {
    let failed = false
    let currentMessage = params.message
    let executionProfile = buildResolvedExecutionProfile({
      message: params.message,
      ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
      ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
      ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
    })
    let originalUserRequest = executionProfile.originalRequest
    let currentModel = params.model
    let currentProviderId = params.providerId
    let currentProvider = params.provider
    let currentTargetId = params.targetId
    let currentTargetLabel = params.targetLabel
    const priorAssistantMessages: string[] = []
    const seenFollowupPrompts = new Set<string>()
    const seenCommandFailureRecoveryKeys = new Set<string>()
    const seenExecutionRecoveryKeys = new Set<string>()
    const seenLlmRecoveryKeys = new Set<string>()
    let executionRecoveryLimitStop: {
      summary: string
      reason: string
      remainingItems: string[]
    } | null = null
    let llmRecoveryLimitStop: {
      summary: string
      reason: string
      remainingItems: string[]
    } | null = null
    let activeWorkerRuntime = params.workerRuntime
    let requiresFilesystemMutation = executionProfile.requiresFilesystemMutation
    let requiresPrivilegedToolExecution = executionProfile.requiresPrivilegedToolExecution
    const pendingToolParams = new Map<string, unknown>()
    const filesystemMutationPaths = new Set<string>()
    let sawRealFilesystemMutation = false
    let filesystemMutationRecoveryAttempted = false
    let truncatedOutputRecoveryAttempted = false
    let intakeProcessed = params.skipIntake || reconnectNeedsClarification
    let pendingLoopDirective: LoopDirective | null = params.immediateCompletionText?.trim()
      ? {
          kind: "complete",
          text: params.immediateCompletionText.trim(),
          eventLabel: "예약 직접 전달 실행",
        }
      : reconnectNeedsClarification
        ? buildReconnectClarificationDirective({
            ...(reconnectTarget ? { reconnectTarget: { title: reconnectTarget.title } } : {}),
            ...(reconnectSelection ? { reconnectSelection } : {}),
          })
        : null

    if (queuedBehindRequestGroupRun && !controller.signal.aborted) {
      setRunStepStatus(runId, "executing", "running", "응답을 생성 중입니다.")
      updateRunStatus(runId, "running", "응답을 생성 중입니다.", true)
      appendRunEvent(runId, "대기 종료 후 실행 시작")
    }

    if (activeWorkerRuntime && (requiresFilesystemMutation || requiresPrivilegedToolExecution)) {
      appendRunEvent(runId, `${activeWorkerRuntime.label} 대신 실제 도구 실행 경로로 전환합니다.`)
      updateRunSummary(
        runId,
        requiresFilesystemMutation
          ? "실제 파일/폴더 작업을 위해 로컬 도구 실행으로 전환합니다."
          : "시스템 권한 또는 장치 제어 작업을 위해 실제 도구 실행으로 전환합니다.",
      )
      log.info('worker runtime bypassed for filesystem mutation request', {
        runId,
        sessionId,
        workerRuntime: activeWorkerRuntime.kind,
      })
      activeWorkerRuntime = undefined
    }

    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      while (!controller.signal.aborted) {
        if (pendingLoopDirective) {
          const directive = pendingLoopDirective
          pendingLoopDirective = null
          if (directive.kind === "retry_intake") {
            const currentRun = getRootRun(runId)
            const usedTurns = currentRun?.delegationTurnCount ?? 0
            const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns

            if (directive.eventLabel) {
              appendRunEvent(runId, directive.eventLabel)
            }
            rememberRunFailure({
              runId,
              sessionId,
              source: params.source,
              summary: directive.summary,
              detail: directive.reason,
              title: "schedule_intake_recovery",
            })

            if (maxTurns > 0 && usedTurns >= maxTurns) {
              await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                preview: "",
                summary: `일정 해석 복구 재시도 한도(${maxTurns}회)에 도달했습니다.`,
                reason: directive.reason,
                remainingItems: directive.remainingItems ?? ["일정 요청을 다시 해석해야 하지만 자동 재시도 한도에 도달했습니다."],
              })
              break
            }

            incrementDelegationTurnCount(runId, directive.summary)
            appendRunEvent(runId, `일정 해석 복구 재시도 ${usedTurns + 1}/${maxTurns > 0 ? maxTurns : "무제한"}`)
            setRunStepStatus(runId, "executing", "running", directive.summary)
            updateRunStatus(runId, "running", directive.summary, true)
            currentMessage = directive.message
            intakeProcessed = false
            continue
          }
          await executeLoopDirective({
            runId,
            sessionId,
            source: params.source,
            onChunk: params.onChunk,
            directive,
          })
          break
        }

        if (!intakeProcessed) {
          intakeProcessed = true
          const cancellationDirective = await tryHandleActiveQueueCancellation({
            runId,
            sessionId,
            source: params.source,
            onChunk: params.onChunk,
            message: params.message,
            mode: entrySemantics.active_queue_cancellation_mode,
          })
          if (cancellationDirective) {
            pendingLoopDirective = cancellationDirective
            continue
          }

          const intakeDirective = await tryHandleIntakeBridge({
            message: currentMessage,
            originalRequest: originalUserRequest,
            sessionId,
            requestGroupId,
            model: params.model,
            workDir,
            source: params.source,
            runId,
            onChunk: params.onChunk,
            reuseConversationContext: entrySemantics.reuse_conversation_context,
          })
          if (intakeDirective) {
            pendingLoopDirective = intakeDirective
            continue
          }
        }

        let preview = ""
        failed = false
        let llmRecovery: { summary: string; reason: string; message: string } | null = null
        let workerRuntimeRecovery: { summary: string; reason: string; message: string } | null = null
        let executionRecovery: { summary: string; reason: string; toolNames: string[] } | null = null
        const failedCommandTools: FailedCommandTool[] = []
        const successfulFileDeliveries: SuccessfulFileDelivery[] = []
        const successfulTools: SuccessfulToolEvidence[] = []
        let commandFailureSeen = false
        let commandRecoveredWithinSamePass = false

        if (activeWorkerRuntime && workerSessionId) {
          appendRunEvent(runId, `${workerSessionId} 실행 시작`)
          updateRunSummary(runId, `${activeWorkerRuntime.label}에서 작업을 실행 중입니다.`)
        }

        const chunkStream = activeWorkerRuntime
          ? runWorkerRuntime({
              runtime: activeWorkerRuntime,
              prompt: buildWorkerRuntimePrompt(currentMessage, workDir),
              sessionId,
              runId,
              signal: controller.signal,
            })
          : runAgent({
              userMessage: currentMessage,
              memorySearchQuery: params.message,
              sessionId,
              runId,
              model: currentModel,
              ...(currentProviderId ? { providerId: currentProviderId } : {}),
              ...(currentProvider ? { provider: currentProvider } : {}),
              workDir,
              source: params.source,
              signal: controller.signal,
              ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
              ...(isRootRequest ? {} : { requestGroupId }),
              contextMode: effectiveContextMode,
            })

        for await (const chunk of chunkStream) {
          if (chunk.type === "text") {
            preview = `${preview}${chunk.delta}`.trim()
            if (preview) updateRunSummary(runId, preview.slice(-500))
          } else if (chunk.type === "execution_recovery") {
            executionRecovery = chunk
            rememberRunFailure({
              runId,
              sessionId,
              source: params.source,
              summary: chunk.summary,
              detail: chunk.reason,
              title: `execution_recovery: ${chunk.toolNames.join(", ") || "tool"}`,
            })
            const currentRun = getRootRun(runId)
            const usedTurns = currentRun?.delegationTurnCount ?? 0
            const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns

            if (maxTurns > 0 && usedTurns >= maxTurns) {
              executionRecoveryLimitStop = {
                summary: `실행 복구 재시도 한도(${maxTurns}회)에 도달했습니다.`,
                reason: chunk.reason,
                remainingItems: [
                  `${chunk.toolNames.join(", ")} 실행 실패에 대한 추가 대안 탐색이 필요하지만 자동 한도에 도달했습니다.`,
                ],
              }
              appendRunEvent(runId, `실행 복구 한도 도달 ${maxTurns}/${maxTurns}`)
              controller.abort()
            } else {
              const nextTurn = usedTurns + 1
              incrementDelegationTurnCount(runId, chunk.summary)
              appendRunEvent(runId, `실행 복구 재시도 ${nextTurn}/${maxTurns > 0 ? maxTurns : "무제한"}`)
              setRunStepStatus(runId, "executing", "running", chunk.summary)
              updateRunStatus(runId, "running", chunk.summary, true)
            }
          } else if (chunk.type === "tool_start") {
            pendingToolParams.set(chunk.toolName, chunk.params)
            const summary = `${chunk.toolName} 실행 중`
            appendRunEvent(runId, `${chunk.toolName} 실행 시작`)
            updateRunSummary(runId, summary)
          } else if (chunk.type === "tool_end") {
            const toolParams = pendingToolParams.get(chunk.toolName)
            pendingToolParams.delete(chunk.toolName)
            if (chunk.success) {
              successfulTools.push({
                toolName: chunk.toolName,
                output: chunk.output,
              })
            }
            if (chunk.success && isRealFilesystemMutation(chunk.toolName, toolParams)) {
              sawRealFilesystemMutation = true
              for (const mutationPath of collectFilesystemMutationPaths(chunk.toolName, toolParams, workDir)) {
                filesystemMutationPaths.add(mutationPath)
              }
            }
            if (!chunk.success && isCommandFailureRecoveryTool(chunk.toolName)) {
              commandFailureSeen = true
              commandRecoveredWithinSamePass = false
              failedCommandTools.push({
                toolName: chunk.toolName,
                output: chunk.output,
                ...(toolParams !== undefined ? { params: toolParams } : {}),
              })
            } else if (chunk.success && isCommandFailureRecoveryTool(chunk.toolName) && commandFailureSeen) {
              commandRecoveredWithinSamePass = true
              failedCommandTools.length = 0
            }
            const summary = chunk.success ? `${chunk.toolName} 실행 완료` : `${chunk.toolName} 실행 실패`
            appendRunEvent(runId, summary)
            updateRunSummary(runId, summary)
          } else if (chunk.type === "llm_recovery") {
            rememberRunFailure({
              runId,
              sessionId,
              source: params.source,
              summary: chunk.summary,
              detail: `${chunk.reason}\n${chunk.message}`,
              title: "llm_recovery",
            })
            const currentRun = getRootRun(runId)
            const usedTurns = currentRun?.delegationTurnCount ?? 0
            const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns

            if (maxTurns > 0 && usedTurns >= maxTurns) {
              llmRecoveryLimitStop = {
                summary: `LLM 오류 복구 재시도 한도(${maxTurns}회)에 도달했습니다.`,
                reason: chunk.reason,
                remainingItems: ["모델 호출 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
              }
              appendRunEvent(runId, `LLM 복구 한도 도달 ${maxTurns}/${maxTurns}`)
            } else {
              incrementDelegationTurnCount(runId, chunk.summary)
              appendRunEvent(runId, `LLM 오류 복구 재시도 ${usedTurns + 1}/${maxTurns > 0 ? maxTurns : "무제한"}`)
              setRunStepStatus(runId, "executing", "running", chunk.summary)
              updateRunStatus(runId, "running", chunk.summary, true)
              llmRecovery = chunk
            }
        } else if (chunk.type === "error") {
            if (executionRecoveryLimitStop) {
              appendRunEvent(runId, "실행 복구 한도에 도달해 자동 진행을 중단합니다.")
              continue
            }
            if (activeWorkerRuntime && !controller.signal.aborted) {
              const currentRun = getRootRun(runId)
              const usedTurns = currentRun?.delegationTurnCount ?? 0
              const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns
              const summary = `${activeWorkerRuntime.label} 오류를 분석하고 다른 경로로 재시도합니다.`
              const reason = describeWorkerRuntimeErrorReason(chunk.message)

              rememberRunFailure({
                runId,
                sessionId,
                source: params.source,
                summary,
                detail: `${reason}\n${chunk.message}`,
                title: "worker_runtime_recovery",
              })

              if (maxTurns > 0 && usedTurns >= maxTurns) {
                llmRecoveryLimitStop = {
                  summary: `작업 세션 복구 재시도 한도(${maxTurns}회)에 도달했습니다.`,
                  reason,
                  remainingItems: ["작업 세션 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
                }
                appendRunEvent(runId, `작업 세션 복구 한도 도달 ${maxTurns}/${maxTurns}`)
              } else {
                incrementDelegationTurnCount(runId, summary)
                appendRunEvent(runId, `작업 세션 복구 재시도 ${usedTurns + 1}/${maxTurns > 0 ? maxTurns : "무제한"}`)
                setRunStepStatus(runId, "executing", "running", summary)
                updateRunStatus(runId, "running", summary, true)
                workerRuntimeRecovery = {
                  summary,
                  reason,
                  message: chunk.message,
                }
              }
              const receipt = await deliverChunk(params.onChunk, chunk, runId)
              applyChunkDeliveryReceipt(runId, receipt, successfulFileDeliveries)
              continue
            }

            failed = !controller.signal.aborted
            appendRunEvent(runId, chunk.message)
            if (activeWorkerRuntime && workerSessionId) {
              appendRunEvent(runId, `${workerSessionId} 실행 실패`)
            }
            if (controller.signal.aborted) {
              markAbortedRunCancelledIfActive(runId)
            } else {
              setRunStepStatus(runId, "executing", "failed", chunk.message)
              updateRunStatus(runId, "failed", chunk.message, false)
              rememberRunFailure({
                runId,
                sessionId,
                source: params.source,
                summary: "실행 중 오류로 요청이 중단되었습니다.",
                detail: chunk.message,
                title: "run_error",
              })
            }
          }

          const receipt = await deliverChunk(params.onChunk, chunk, runId)
          applyChunkDeliveryReceipt(runId, receipt, successfulFileDeliveries)
        }

        if (executionRecoveryLimitStop) {
          await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
            preview,
            summary: executionRecoveryLimitStop.summary,
            reason: executionRecoveryLimitStop.reason,
            remainingItems: executionRecoveryLimitStop.remainingItems,
          })
          break
        }

        if (llmRecoveryLimitStop) {
          await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
            preview,
            summary: llmRecoveryLimitStop.summary,
            reason: llmRecoveryLimitStop.reason,
            remainingItems: llmRecoveryLimitStop.remainingItems,
          })
          break
        }

        if (llmRecovery && !controller.signal.aborted) {
          const recoveryKey = buildLlmRecoveryKey({
            targetId: currentTargetId,
            workerRuntimeKind: activeWorkerRuntime?.kind,
            providerId: currentProviderId,
            model: currentModel,
            reason: llmRecovery.reason,
            message: llmRecovery.message,
          })
          const reroute = resolveRunRoute({
            taskProfile: effectiveTaskProfile,
            fallbackModel: currentModel,
            avoidTargets: buildLlmRecoveryAvoidTargets(currentTargetId, activeWorkerRuntime?.kind),
          })
          const routeChanged = hasMeaningfulRouteChange({
            currentTargetId,
            currentModel,
            currentProviderId,
            currentWorkerRuntimeKind: activeWorkerRuntime?.kind,
            nextTargetId: reroute.targetId,
            nextModel: reroute.model ?? currentModel,
            nextProviderId: reroute.providerId ?? currentProviderId,
            nextWorkerRuntimeKind: reroute.workerRuntime?.kind,
          })

          if (!routeChanged && seenLlmRecoveryKeys.has(recoveryKey)) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: "같은 LLM 오류가 같은 대상에서 반복되어 자동 진행을 멈췄습니다.",
              reason: llmRecovery.reason,
              remainingItems: ["같은 실행 대상과 같은 모델에서 동일한 LLM 오류가 반복되어 다른 수동 조치가 필요합니다."],
            })
            break
          }

          seenLlmRecoveryKeys.add(recoveryKey)
          appendRunEvent(runId, "LLM 오류를 분석하고 다른 방법으로 재시도합니다.")
          if (routeChanged) {
            appendRunEvent(
              runId,
              reroute.targetLabel
                ? `LLM 복구 경로 전환: ${currentTargetLabel ?? currentTargetId ?? currentModel ?? "현재 대상"} -> ${reroute.targetLabel}`
                : "LLM 복구를 위해 다른 실행 경로로 전환합니다.",
            )
            currentModel = reroute.model ?? currentModel
            currentProviderId = reroute.providerId ?? currentProviderId
            currentProvider = reroute.provider
            currentTargetId = reroute.targetId ?? currentTargetId
            currentTargetLabel = reroute.targetLabel ?? reroute.targetId ?? currentTargetLabel
            activeWorkerRuntime = reroute.workerRuntime
          } else if (activeWorkerRuntime) {
            appendRunEvent(runId, `${activeWorkerRuntime.label} 경로 대신 기본 추론 경로로 전환합니다.`)
            activeWorkerRuntime = undefined
            currentProvider = undefined
          }
          currentMessage = buildLlmErrorRecoveryPrompt({
            originalRequest: originalUserRequest,
            previousResult: preview,
            summary: llmRecovery.summary,
            reason: llmRecovery.reason,
            message: llmRecovery.message,
          })
          continue
        }

        if (workerRuntimeRecovery && !controller.signal.aborted) {
          const recoveryKey = buildWorkerRuntimeRecoveryKey({
            targetId: currentTargetId,
            workerRuntimeKind: activeWorkerRuntime?.kind,
            providerId: currentProviderId,
            model: currentModel,
            reason: workerRuntimeRecovery.reason,
            message: workerRuntimeRecovery.message,
          })
          const reroute = resolveRunRoute({
            taskProfile: effectiveTaskProfile,
            fallbackModel: currentModel,
            avoidTargets: buildLlmRecoveryAvoidTargets(currentTargetId, activeWorkerRuntime?.kind),
          })
          const routeChanged = hasMeaningfulRouteChange({
            currentTargetId,
            currentModel,
            currentProviderId,
            currentWorkerRuntimeKind: activeWorkerRuntime?.kind,
            nextTargetId: reroute.targetId,
            nextModel: reroute.model ?? currentModel,
            nextProviderId: reroute.providerId ?? currentProviderId,
            nextWorkerRuntimeKind: reroute.workerRuntime?.kind,
          })

          if (!routeChanged && seenLlmRecoveryKeys.has(recoveryKey)) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: "같은 작업 세션 오류가 같은 대상에서 반복되어 자동 진행을 멈췄습니다.",
              reason: workerRuntimeRecovery.reason,
              remainingItems: ["같은 작업 세션에서 동일한 오류가 반복되어 다른 수동 조치가 필요합니다."],
            })
            break
          }

          seenLlmRecoveryKeys.add(recoveryKey)
          appendRunEvent(runId, "작업 세션 오류를 분석하고 다른 방법으로 재시도합니다.")
          if (routeChanged) {
            appendRunEvent(
              runId,
              reroute.targetLabel
                ? `작업 세션 복구 경로 전환: ${currentTargetLabel ?? currentTargetId ?? currentModel ?? "현재 대상"} -> ${reroute.targetLabel}`
                : "작업 세션 복구를 위해 다른 실행 경로로 전환합니다.",
            )
            currentModel = reroute.model ?? currentModel
            currentProviderId = reroute.providerId ?? currentProviderId
            currentProvider = reroute.provider
            currentTargetId = reroute.targetId ?? currentTargetId
            currentTargetLabel = reroute.targetLabel ?? reroute.targetId ?? currentTargetLabel
            activeWorkerRuntime = reroute.workerRuntime
          } else if (activeWorkerRuntime) {
            appendRunEvent(runId, `${activeWorkerRuntime.label} 경로 대신 기본 추론 경로로 전환합니다.`)
            activeWorkerRuntime = undefined
            currentProvider = undefined
          }
          currentMessage = buildWorkerRuntimeErrorRecoveryPrompt({
            originalRequest: originalUserRequest,
            previousResult: preview,
            summary: workerRuntimeRecovery.summary,
            reason: workerRuntimeRecovery.reason,
            message: workerRuntimeRecovery.message,
          })
          continue
        }

        if (controller.signal.aborted || failed) {
          break
        }

        const hasAnySuccessfulDelivery = successfulFileDeliveries.length > 0
        const deliverySatisfied = executionProfile.wantsDirectArtifactDelivery && hasAnySuccessfulDelivery
        if (hasAnySuccessfulDelivery) {
          const deliverySummary = buildSuccessfulDeliverySummary(successfulFileDeliveries)
          preview = [preview.trim(), deliverySummary].filter(Boolean).join("\n\n")
          updateRunSummary(runId, deliverySummary)
        } else if (!preview.trim()) {
          const implicitPreview = buildImplicitExecutionSummary({
            successfulTools,
            sawRealFilesystemMutation,
          })
          if (implicitPreview) {
            preview = implicitPreview
            updateRunSummary(runId, implicitPreview)
          }
        }

        const postPassRun = getRootRun(runId)
        const usedTurnsAfterPass = postPassRun?.delegationTurnCount ?? 0
        const maxTurnsAfterPass = postPassRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns
        const commandFailureRecovery = selectCommandFailureRecovery({
          failedTools: failedCommandTools,
          commandFailureSeen,
          commandRecoveredWithinSamePass,
          seenKeys: seenCommandFailureRecoveryKeys,
        })

        if (commandFailureRecovery) {
          if (maxTurnsAfterPass > 0 && usedTurnsAfterPass >= maxTurnsAfterPass) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: `자동 후속 처리 한도(${maxTurnsAfterPass}회)에 도달했습니다.`,
              reason: commandFailureRecovery.reason,
              remainingItems: ["실패한 명령에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
            })
            break
          }

          seenCommandFailureRecoveryKeys.add(commandFailureRecovery.key)
          rememberRunFailure({
            runId,
            sessionId,
            source: params.source,
            summary: commandFailureRecovery.summary,
            detail: commandFailureRecovery.reason,
            title: "command_failure_recovery",
          })
          incrementDelegationTurnCount(runId, commandFailureRecovery.summary)
          appendRunEvent(runId, `명령 실패 대안 재시도 ${usedTurnsAfterPass + 1}/${maxTurnsAfterPass > 0 ? maxTurnsAfterPass : "무제한"}`)
          setRunStepStatus(runId, "executing", "running", commandFailureRecovery.summary)
          updateRunStatus(runId, "running", commandFailureRecovery.summary, true)
          activeWorkerRuntime = undefined
          currentMessage = buildCommandFailureRecoveryPrompt({
            originalRequest: originalUserRequest,
            previousResult: preview,
            summary: commandFailureRecovery.summary,
            reason: commandFailureRecovery.reason,
            failedTools: failedCommandTools,
          })
          continue
        }

        const genericExecutionRecovery = executionRecovery && !commandFailureRecovery
          ? selectGenericExecutionRecovery({
              executionRecovery,
              seenKeys: seenExecutionRecoveryKeys,
            })
          : null

        if (genericExecutionRecovery) {
          if (maxTurnsAfterPass > 0 && usedTurnsAfterPass >= maxTurnsAfterPass) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: `자동 후속 처리 한도(${maxTurnsAfterPass}회)에 도달했습니다.`,
              reason: genericExecutionRecovery.reason,
              remainingItems: ["실패한 도구에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
            })
            break
          }

          seenExecutionRecoveryKeys.add(genericExecutionRecovery.key)
          rememberRunFailure({
            runId,
            sessionId,
            source: params.source,
            summary: genericExecutionRecovery.summary,
            detail: genericExecutionRecovery.reason,
            title: "execution_recovery_followup",
          })
          incrementDelegationTurnCount(runId, genericExecutionRecovery.summary)
          appendRunEvent(runId, `도구 실패 대안 재시도 ${usedTurnsAfterPass + 1}/${maxTurnsAfterPass > 0 ? maxTurnsAfterPass : "무제한"}`)
          setRunStepStatus(runId, "executing", "running", genericExecutionRecovery.summary)
          updateRunStatus(runId, "running", genericExecutionRecovery.summary, true)
          activeWorkerRuntime = undefined
          currentMessage = buildExecutionRecoveryPrompt({
            originalRequest: originalUserRequest,
            previousResult: preview,
            summary: genericExecutionRecovery.summary,
            reason: genericExecutionRecovery.reason,
            toolNames: executionRecovery?.toolNames ?? [],
          })
          continue
        }

        if (requiresFilesystemMutation && !deliverySatisfied && !sawRealFilesystemMutation) {
          if (filesystemMutationRecoveryAttempted) {
            if (maxTurnsAfterPass > 0 && usedTurnsAfterPass >= maxTurnsAfterPass) {
              await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                preview,
                summary: "실제 파일/폴더 생성 또는 수정이 확인되지 않아 자동 진행을 멈췄습니다.",
                reason: "응답 내용만 생성되었고 실제 로컬 파일 작업이 확인되지 않았습니다.",
                remainingItems: [
                  "요청한 파일 또는 폴더가 실제로 생성되거나 수정되지 않았습니다.",
                  "로컬 도구 실행 권한과 대상 경로를 다시 확인해 주세요.",
                ],
              })
              break
            }

            const summary = "실제 파일/폴더 변경 증거가 없어 다른 방법으로 재시도합니다."
            rememberRunFailure({
              runId,
              sessionId,
              source: params.source,
              summary,
              detail: "응답 내용만 생성되었고 실제 로컬 파일 작업 증거가 아직 없습니다.",
              title: "filesystem_mutation_recovery",
            })
            incrementDelegationTurnCount(runId, summary)
            appendRunEvent(runId, `파일 작업 복구 재시도 ${usedTurnsAfterPass + 1}/${maxTurnsAfterPass > 0 ? maxTurnsAfterPass : "무제한"}`)
            updateRunSummary(runId, summary)
            setRunStepStatus(runId, "executing", "running", summary)
            updateRunStatus(runId, "running", summary, true)
            activeWorkerRuntime = undefined
            currentMessage = buildFilesystemVerificationRecoveryPrompt({
              originalRequest: params.message,
              previousResult: preview,
              verificationSummary: summary,
              verificationReason: "실행 응답만 있었고 실제 로컬 파일 또는 폴더 변경 증거가 아직 없습니다.",
              missingItems: [
                "요청한 파일 또는 폴더가 실제로 존재하는지 직접 확인해야 합니다.",
                "누락되었다면 다른 방법으로 직접 생성하거나 수정해야 합니다.",
              ],
              mutationPaths: [...filesystemMutationPaths],
            })
            continue
          }

          filesystemMutationRecoveryAttempted = true
          appendRunEvent(runId, "실제 파일/폴더 변경이 확인되지 않아 로컬 도구 작업으로 재시도합니다.")
          updateRunSummary(runId, "실제 파일/폴더 작업을 다시 시도합니다.")
          setRunStepStatus(runId, "executing", "running", "실제 파일/폴더 작업을 다시 시도합니다.")
          updateRunStatus(runId, "running", "실제 파일/폴더 작업을 다시 시도합니다.", true)
          activeWorkerRuntime = undefined
          currentMessage = buildFilesystemMutationFollowupPrompt({
            originalRequest: originalUserRequest,
            previousResult: preview,
          })
          continue
        }

        if (requiresFilesystemMutation && !deliverySatisfied && sawRealFilesystemMutation) {
          const verification = await runFilesystemVerificationSubtask({
            parentRunId: runId,
            requestGroupId,
            sessionId,
            source: params.source,
            onChunk: params.onChunk,
            originalRequest: originalUserRequest,
            mutationPaths: [...filesystemMutationPaths],
            workDir,
          })

          if (!verification.ok) {
            if (maxTurnsAfterPass > 0 && usedTurnsAfterPass >= maxTurnsAfterPass) {
              await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                preview,
                summary: verification.summary,
                ...(verification.reason ? { reason: verification.reason } : {}),
                ...(verification.remainingItems ? { remainingItems: verification.remainingItems } : {}),
              })
              break
            }

            rememberRunFailure({
              runId,
              sessionId,
              source: params.source,
              summary: verification.summary,
              detail: verification.reason ?? verification.summary,
              title: "filesystem_verification_recovery",
            })
            incrementDelegationTurnCount(runId, verification.summary)
            appendRunEvent(runId, `파일 검증 복구 재시도 ${usedTurnsAfterPass + 1}/${maxTurnsAfterPass > 0 ? maxTurnsAfterPass : "무제한"}`)
            updateRunSummary(runId, verification.summary)
            setRunStepStatus(runId, "executing", "running", verification.summary)
            updateRunStatus(runId, "running", verification.summary, true)
            activeWorkerRuntime = undefined
            currentMessage = buildFilesystemVerificationRecoveryPrompt({
              originalRequest: originalUserRequest,
              previousResult: preview,
              verificationSummary: verification.summary,
              ...(verification.reason ? { verificationReason: verification.reason } : {}),
              ...(verification.remainingItems ? { missingItems: verification.remainingItems } : {}),
              mutationPaths: [...filesystemMutationPaths],
            })
            continue
          }

          appendRunEvent(runId, "실제 파일/폴더 결과 검증을 완료했습니다.")
          updateRunSummary(runId, verification.summary)
          preview = [preview.trim(), verification.summary].filter(Boolean).join("\n\n")
        }

        if (activeWorkerRuntime && workerSessionId) {
          appendRunEvent(runId, `${workerSessionId} 실행 종료`)
        }

        if (activeWorkerRuntime && preview) {
          insertMessage({
            id: crypto.randomUUID(),
            session_id: sessionId,
            root_run_id: runId,
            role: "assistant",
            content: preview,
            tool_calls: null,
            tool_call_id: null,
            created_at: Date.now(),
          })
        }
        logAssistantReply(params.source, preview)
        setRunStepStatus(runId, "executing", "completed", preview || "응답 생성을 마쳤습니다.")
        setRunStepStatus(runId, "reviewing", "running", "남은 작업이 있는지 검토 중입니다.")

        const directArtifactDeliveryRequested = executionProfile.wantsDirectArtifactDelivery

        if (deliverySatisfied) {
          const deliverySummary = buildSuccessfulDeliverySummary(successfulFileDeliveries)
          rememberRunSuccess({
            runId,
            sessionId,
            source: params.source,
            text: preview || deliverySummary,
            summary: deliverySummary,
          })
          setRunStepStatus(runId, "reviewing", "completed", deliverySummary)
          setRunStepStatus(runId, "finalizing", "completed", "전달 결과를 저장했습니다.")
          setRunStepStatus(runId, "completed", "completed", preview || deliverySummary)
          updateRunStatus(runId, "completed", preview || deliverySummary, false)
          appendRunEvent(runId, "직접 파일 전달 요청 완료")
          break
        }

        if (directArtifactDeliveryRequested) {
          if (maxTurnsAfterPass > 0 && usedTurnsAfterPass >= maxTurnsAfterPass) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: "메신저로 결과물을 직접 전달하지 못해 자동 진행을 멈췄습니다.",
              reason: "사용자는 결과물 자체를 보여주거나 보내달라고 요청했지만 실제 전달이 완료되지 않았습니다.",
              remainingItems: ["결과물 자체를 메신저로 실제 전달하는 단계가 남아 있습니다."],
            })
            break
          }

          const summary = "메신저 결과 전달이 아직 끝나지 않아 다른 방법으로 계속 진행합니다."
          rememberRunFailure({
            runId,
            sessionId,
            source: params.source,
            summary,
            detail: "설명이나 로컬 저장만으로는 완료가 아니며, 요청된 결과물 자체를 메신저로 전달해야 합니다.",
            title: "direct_artifact_delivery_recovery",
          })
          incrementDelegationTurnCount(runId, summary)
          appendRunEvent(runId, `메신저 결과 전달 재시도 ${usedTurnsAfterPass + 1}/${maxTurnsAfterPass > 0 ? maxTurnsAfterPass : "무제한"}`)
          updateRunSummary(runId, summary)
          setRunStepStatus(runId, "reviewing", "running", summary)
          setRunStepStatus(runId, "executing", "running", summary)
          updateRunStatus(runId, "running", summary, true)
          activeWorkerRuntime = undefined
          currentMessage = buildDirectArtifactDeliveryRecoveryPrompt({
            originalRequest: originalUserRequest,
            previousResult: preview,
            successfulTools,
            successfulFileDeliveries,
          })
          continue
        }

        const review = await reviewTaskCompletion({
          originalRequest: originalUserRequest,
          latestAssistantMessage: preview,
          priorAssistantMessages,
          ...(currentModel ? { model: currentModel } : {}),
          ...(currentProviderId ? { providerId: currentProviderId } : {}),
          ...(currentProvider ? { provider: currentProvider } : {}),
          workDir,
        }).catch((error) => {
          log.warn(`completion review failed: ${error instanceof Error ? error.message : String(error)}`)
          return null
        })

        priorAssistantMessages.push(preview)

        const hasCompletionEvidence = hasMeaningfulCompletionEvidence({
          executionProfile,
          preview,
          deliverySatisfied,
          successfulTools,
          sawRealFilesystemMutation,
        })

        const syntheticApproval = detectSyntheticApprovalRequest({
          executionProfile,
          originalRequest: originalUserRequest,
          preview,
          review,
          usesWorkerRuntime: Boolean(activeWorkerRuntime),
          requiresPrivilegedToolExecution,
          successfulTools,
          successfulFileDeliveries,
          sawRealFilesystemMutation,
        })
        if (syntheticApproval) {
          if (syntheticApprovalScopes.has(runId)) {
            appendRunEvent(runId, `${syntheticApproval.toolName} 전체 승인 상태로 계속 진행합니다.`)
            setRunStepStatus(runId, "reviewing", "completed", syntheticApproval.summary)
            setRunStepStatus(runId, "executing", "running", "승인된 작업을 계속 진행합니다.")
            updateRunStatus(runId, "running", "승인된 작업을 계속 진행합니다.", true)
            activeWorkerRuntime = undefined
            currentProvider = undefined
            currentMessage = syntheticApproval.continuationPrompt
            continue
          }

          const decision = await requestSyntheticApproval({
            runId,
            sessionId,
            toolName: syntheticApproval.toolName,
            summary: syntheticApproval.summary,
            ...(syntheticApproval.guidance ? { guidance: syntheticApproval.guidance } : {}),
            params: {
              source: activeWorkerRuntime?.kind ?? "agent_reply",
              originalRequest: originalUserRequest,
              latestAssistantMessage: preview,
            },
            signal: controller.signal,
          })

          if (decision === "deny" || controller.signal.aborted) {
            break
          }

          if (decision === "allow_run") {
            syntheticApprovalScopes.add(runId)
            grantRunApprovalScope(runId)
          } else {
            grantRunSingleApproval(runId)
          }

          appendRunEvent(runId, decision === "allow_run" ? `${syntheticApproval.toolName} 전체 승인` : `${syntheticApproval.toolName} 단계 승인`)
          setRunStepStatus(runId, "reviewing", "completed", syntheticApproval.summary)
          setRunStepStatus(runId, "executing", "running", "승인된 작업을 계속 진행합니다.")
          updateRunStatus(runId, "running", "승인된 작업을 계속 진행합니다.", true)
          activeWorkerRuntime = undefined
          currentProvider = undefined
          currentMessage = syntheticApproval.continuationPrompt
          continue
        }

        if (!review && !hasCompletionEvidence) {
          if (maxTurnsAfterPass > 0 && usedTurnsAfterPass >= maxTurnsAfterPass) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: "실행 결과가 비어 있고 완료 근거가 없어 자동 진행을 멈췄습니다.",
              reason: "명확한 응답, 성공한 도구 결과, 실제 파일 변경, 전달 완료 중 어떤 근거도 확인되지 않았습니다.",
              remainingItems: ["실제 실행 결과를 남기거나 다른 방법으로 다시 시도해야 합니다."],
            })
            break
          }

          const summary = "실행 결과가 비어 있어 다른 방법으로 다시 시도합니다."
          rememberRunFailure({
            runId,
            sessionId,
            source: params.source,
            summary,
            detail: "명확한 응답, 성공한 도구 결과, 실제 파일 변경, 전달 완료 중 어떤 근거도 확인되지 않았습니다.",
            title: "empty_result_recovery",
          })
          incrementDelegationTurnCount(runId, summary)
          appendRunEvent(runId, `빈 결과 복구 재시도 ${usedTurnsAfterPass + 1}/${maxTurnsAfterPass > 0 ? maxTurnsAfterPass : "무제한"}`)
          updateRunSummary(runId, summary)
          setRunStepStatus(runId, "reviewing", "running", summary)
          setRunStepStatus(runId, "executing", "running", summary)
          updateRunStatus(runId, "running", summary, true)
          currentMessage = buildEmptyResultRecoveryPrompt({
            originalRequest: originalUserRequest,
            previousResult: preview,
            successfulTools,
            sawRealFilesystemMutation,
          })
          continue
        }

        if (!review || review.status === "complete") {
          const reviewSummary =
            review?.summary?.trim()
            || preview
            || buildImplicitExecutionSummary({ successfulTools, sawRealFilesystemMutation })
            || "실행을 완료했습니다."
          rememberRunSuccess({
            runId,
            sessionId,
            source: params.source,
            text: preview || reviewSummary,
            summary: reviewSummary,
          })
          setRunStepStatus(runId, "reviewing", "completed", reviewSummary)
          setRunStepStatus(runId, "finalizing", "completed", "실행 결과를 저장했습니다.")
          setRunStepStatus(runId, "completed", "completed", preview || "실행을 완료했습니다.")
          updateRunStatus(runId, "completed", preview || "실행을 완료했습니다.", false)
          appendRunEvent(runId, "실행 완료")
          break
        }

        const currentRun = getRootRun(runId)
        const usedTurns = currentRun?.delegationTurnCount ?? 0
        const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns

        if (review.status === "followup") {
          const followupPrompt = review.followupPrompt?.trim()
          const normalizedPrompt = followupPrompt?.replace(/\s+/g, " ").trim().toLowerCase()

          if (!followupPrompt) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: review.summary || "추가 작업이 남아 있지만 후속 지시가 비어 있습니다.",
              reason: review.reason || "후속 처리 지시 생성 실패",
              remainingItems: review.remainingItems,
            })
            break
          }

          if (normalizedPrompt && seenFollowupPrompts.has(normalizedPrompt)) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: "같은 후속 지시가 반복되어 자동 진행을 멈췄습니다.",
              reason: review.reason || "반복 후속 지시 감지",
              remainingItems: review.remainingItems,
            })
            break
          }

          if (maxTurns > 0 && usedTurns >= maxTurns) {
            await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
              preview,
              summary: `자동 후속 처리 한도(${maxTurns}회)에 도달했습니다.`,
              reason: review.reason || "최대 자동 후속 처리 횟수 초과",
              remainingItems: review.remainingItems,
            })
            break
          }

          if (normalizedPrompt) {
            seenFollowupPrompts.add(normalizedPrompt)
          }
          incrementDelegationTurnCount(runId, review.summary || "추가 자동 처리를 시작합니다.")
          appendRunEvent(runId, `후속 처리 ${usedTurns + 1}/${maxTurns > 0 ? maxTurns : "무제한"}`)
          setRunStepStatus(runId, "reviewing", "completed", review.summary || "추가 처리가 필요합니다.")
          setRunStepStatus(runId, "executing", "running", review.summary || "추가 자동 처리를 시작합니다.")
          currentMessage = followupPrompt
          continue
        }

        if (shouldRetryTruncatedOutput({
          review,
          preview,
          executionProfile,
        })) {
          if (!truncatedOutputRecoveryAttempted) {
            if (maxTurns > 0 && usedTurns >= maxTurns) {
              await moveRunToCancelledAfterStop(runId, sessionId, params.source, params.onChunk, {
                preview,
                summary: `자동 후속 처리 한도(${maxTurns}회)에 도달했습니다.`,
                reason: review.reason || "최대 자동 후속 처리 횟수 초과",
                remainingItems: review.remainingItems,
                ...(review.userMessage ? { userMessage: review.userMessage } : {}),
              })
              break
            }

            truncatedOutputRecoveryAttempted = true
            incrementDelegationTurnCount(runId, review.summary || "중간에 끊긴 작업을 자동으로 다시 시도합니다.")
            appendRunEvent(runId, `중간 절단 복구 재시도 ${usedTurns + 1}/${maxTurns > 0 ? maxTurns : "무제한"}`)
            setRunStepStatus(runId, "reviewing", "completed", review.summary || "중간에 끊긴 작업을 다시 시도합니다.")
            setRunStepStatus(runId, "executing", "running", "중간에 끊긴 작업을 자동으로 다시 시도합니다.")
            updateRunStatus(runId, "running", "중간에 끊긴 작업을 자동으로 다시 시도합니다.", true)
            activeWorkerRuntime = undefined
            currentMessage = buildTruncatedOutputRecoveryPrompt({
              originalRequest: originalUserRequest,
              previousResult: preview,
              summary: review.summary,
              reason: review.reason,
              remainingItems: review.remainingItems,
            })
            continue
          }
        }

        await moveRunToAwaitingUser(runId, sessionId, params.source, params.onChunk, {
          preview,
          summary: review.summary || "사용자 추가 입력이 필요합니다.",
          reason: review.reason,
          remainingItems: review.remainingItems,
          ...(review.userMessage ? { userMessage: review.userMessage } : {}),
        })
        break
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (controller.signal.aborted) {
        markAbortedRunCancelledIfActive(runId)
      } else {
        setRunStepStatus(runId, "executing", "failed", message)
        updateRunStatus(runId, "failed", message, false)
        appendRunEvent(runId, message)
        rememberRunFailure({
          runId,
          sessionId,
          source: params.source,
          summary: "예상하지 못한 실행 오류가 발생했습니다.",
          detail: message,
          title: "unexpected_error",
        })
      }

      await deliverChunk(params.onChunk, { type: "error", message }, runId)
    } finally {
      syntheticApprovalScopes.delete(runId)
      clearActiveRunController(runId)
    }

    return getRootRun(runId)
  })

  return {
    runId: run.id,
    sessionId,
    status: "started",
    finished,
  }
}

interface SyntheticApprovalRequest {
  toolName: string
  summary: string
  guidance?: string
  continuationPrompt: string
}

function detectSyntheticApprovalRequest(params: {
  executionProfile: ReturnType<typeof buildResolvedExecutionProfile>
  originalRequest: string
  preview: string
  review: Awaited<ReturnType<typeof reviewTaskCompletion>>
  usesWorkerRuntime: boolean
  requiresPrivilegedToolExecution: boolean
  successfulTools: SuccessfulToolEvidence[]
  successfulFileDeliveries: SuccessfulFileDelivery[]
  sawRealFilesystemMutation: boolean
}): SyntheticApprovalRequest | null {
  if (!params.preview.trim() && params.review?.status !== "ask_user") return null
  if (params.successfulTools.length > 0 || params.successfulFileDeliveries.length > 0 || params.sawRealFilesystemMutation) {
    return null
  }

  const reviewExplicitlyNeedsApproval = params.review?.status === "ask_user"
  const privilegedRequestNeedsApproval = params.executionProfile.approvalRequired || params.requiresPrivilegedToolExecution

  if (!reviewExplicitlyNeedsApproval && !privilegedRequestNeedsApproval) return null
  if (!params.usesWorkerRuntime && !params.requiresPrivilegedToolExecution) return null

  const toolName = params.executionProfile.approvalTool || "external_action"
  const summary =
    params.review?.summary?.trim()
    || defaultSyntheticApprovalSummary(toolName)
  const guidance =
    params.review?.userMessage?.trim()
    || extractSyntheticApprovalGuidance(params.preview)

  return {
    toolName,
    summary,
    ...(guidance ? { guidance } : {}),
    continuationPrompt: buildSyntheticApprovalContinuationPrompt({
      originalRequest: params.originalRequest,
      preview: params.preview,
      toolName,
    }),
  }
}

function buildSyntheticApprovalContinuationPrompt(params: {
  originalRequest: string
  preview: string
  toolName: string
}): string {
  return [
    "[Approval Granted Continuation]",
    "사용자가 앞서 요청된 로컬 작업을 승인했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `이전 승인 요청 응답: ${params.preview}`,
    "이제 실제 작업을 계속 진행하세요.",
    "같은 권한 요청을 다시 반복하지 마세요.",
    `승인 대상 작업: ${params.toolName}`,
    "설명이나 수동 해결 방법을 다시 제시하지 말고, 사용 가능한 Nobie/Yeonjang 도구를 이용해 승인된 작업을 실제로 수행하고 마무리하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요. 사용자가 번역을 요청하지 않았다면 언어를 바꾸지 마세요.",
  ].join("\n\n")
}

function extractSyntheticApprovalGuidance(preview: string): string | undefined {
  const trimmed = preview.trim()
  if (!trimmed) return undefined
  return trimmed.length > 600 ? `${trimmed.slice(0, 599)}…` : trimmed
}

function defaultSyntheticApprovalSummary(toolName: string): string {
  switch (toolName) {
    case "screen_capture":
      return "화면 캡처 진행 전 승인이 필요합니다."
    case "yeonjang_camera_capture":
      return "카메라 촬영 진행 전 승인이 필요합니다."
    case "mouse_click":
      return "마우스 제어 진행 전 승인이 필요합니다."
    case "keyboard_type":
      return "키보드 제어 진행 전 승인이 필요합니다."
    case "app_launch":
      return "프로그램 실행 전 승인이 필요합니다."
    case "file_write":
      return "파일 작업 진행 전 승인이 필요합니다."
    default:
      return "로컬 작업 진행 전 사용자 승인이 필요합니다."
  }
}

function describeSyntheticApprovalDenial(
  toolName: string,
  reason: ApprovalResolutionReason,
): { eventLabel: string; stepSummary: string; runSummary: string } {
  if (reason === "timeout") {
    return {
      eventLabel: `${toolName} 승인 시간 초과`,
      stepSummary: `${toolName} 승인 대기 시간이 지나 시스템이 요청을 중단했습니다.`,
      runSummary: `${toolName} 승인 시간이 지나 시스템이 요청을 중단했습니다.`,
    }
  }

  if (reason === "system" || reason === "abort") {
    return {
      eventLabel: `${toolName} 승인 처리 중단`,
      stepSummary: `${toolName} 승인 처리가 시스템에 의해 중단되었습니다.`,
      runSummary: `${toolName} 승인 처리가 시스템에 의해 중단되었습니다.`,
    }
  }

  return {
    eventLabel: `${toolName} 실행 거부`,
    stepSummary: `${toolName} 실행이 거부되어 요청을 취소했습니다.`,
    runSummary: `${toolName} 실행이 거부되어 요청을 취소했습니다.`,
  }
}

async function requestSyntheticApproval(params: {
  runId: string
  sessionId: string
  toolName: string
  summary: string
  guidance?: string
  params: Record<string, unknown>
  signal: AbortSignal
}): Promise<ApprovalDecision> {
  const timeoutSec = getConfig().security.approvalTimeout
  const fallback = getConfig().security.approvalTimeoutFallback === "allow" ? "allow_once" : "deny"
  appendRunEvent(params.runId, `${params.toolName} 승인 요청`)
  setRunStepStatus(params.runId, "reviewing", "completed", params.summary)
  setRunStepStatus(params.runId, "awaiting_approval", "running", params.summary)
  updateRunStatus(params.runId, "awaiting_approval", params.summary, true)
  log.info("synthetic approval requested", {
    runId: params.runId,
    sessionId: params.sessionId,
    toolName: params.toolName,
  })

  return new Promise<ApprovalDecision>((resolve) => {
    let resolved = false
    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      const denial = describeSyntheticApprovalDenial(params.toolName, "timeout")
      setRunStepStatus(params.runId, "awaiting_approval", "cancelled", denial.stepSummary)
      if (fallback === "deny") {
        cancelRootRun(params.runId, denial)
      } else {
        setRunStepStatus(params.runId, "executing", "running", `${params.toolName} 실행을 계속합니다.`)
        updateRunStatus(params.runId, "running", `${params.toolName} 실행을 계속합니다.`, true)
      }
      eventBus.emit("approval.resolved", { runId: params.runId, decision: fallback, toolName: params.toolName, reason: "timeout" })
      resolve(fallback)
    }, Math.max(5, timeoutSec) * 1000)

    params.signal.addEventListener("abort", () => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      resolve("deny")
    }, { once: true })

    eventBus.emit("approval.request", {
      runId: params.runId,
      toolName: params.toolName,
      params: params.params,
      kind: "approval",
      ...(params.guidance ? { guidance: params.guidance } : {}),
      resolve: (decision, reason = "user") => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        if (decision === "deny") {
          const denial = describeSyntheticApprovalDenial(params.toolName, reason)
          setRunStepStatus(params.runId, "awaiting_approval", "cancelled", denial.stepSummary)
          cancelRootRun(params.runId, denial)
        } else {
          setRunStepStatus(
            params.runId,
            "awaiting_approval",
            "completed",
            decision === "allow_run"
              ? `${params.toolName} 실행을 이 요청 전체에 대해 허용했습니다.`
              : `${params.toolName} 실행을 이번 단계에 대해 허용했습니다.`,
          )
        }
        resolve(decision)
      },
    })
  })
}

async function moveRunToAwaitingUser(
  runId: string,
  sessionId: string,
  source: StartRootRunParams["source"],
  onChunk: StartRootRunParams["onChunk"],
  params: {
    preview: string
    summary: string
    reason?: string
    userMessage?: string
    remainingItems?: string[]
  },
): Promise<void> {
  const message = buildAwaitingUserMessage(params)
  if (message) {
    await emitStandaloneAssistantMessage(runId, sessionId, message, source, onChunk)
  }
  const summary = params.summary || "추가 입력이 필요해 자동 진행을 멈췄습니다."
  setRunStepStatus(runId, "reviewing", "completed", summary)
  setRunStepStatus(runId, "awaiting_user", "running", summary)
  updateRunStatus(runId, "awaiting_user", summary, true)
  appendRunEvent(runId, "사용자 추가 입력 대기")
}

async function moveRunToCancelledAfterStop(
  runId: string,
  sessionId: string,
  source: StartRootRunParams["source"],
  onChunk: StartRootRunParams["onChunk"],
  params: {
    preview: string
    summary: string
    reason?: string
    userMessage?: string
    remainingItems?: string[]
  },
): Promise<void> {
  const message = buildAwaitingUserMessage(params)
  if (message) {
    await emitStandaloneAssistantMessage(runId, sessionId, message, source, onChunk)
  }
  const summary = params.summary || "자동 진행을 중단하고 요청을 취소했습니다."
  rememberRunFailure({
    runId,
    sessionId,
    source,
    summary,
    detail: [params.reason, params.userMessage, params.preview, params.remainingItems?.join("\n")].filter(Boolean).join("\n"),
    title: "cancelled_after_stop",
  })
  setRunStepStatus(runId, "reviewing", "completed", summary)
  setRunStepStatus(runId, "finalizing", "completed", "중단 결과를 사용자에게 안내했습니다.")
  updateRunStatus(runId, "cancelled", summary, false)
  appendRunEvent(runId, "자동 진행 중단 후 요청 취소")
}

function buildReconnectClarificationDirective(params: {
  reconnectTarget?: { title: string } | undefined
  reconnectSelection?: { candidates?: Array<{ title: string }> } | undefined
}): LoopDirective {
  return {
    kind: "awaiting_user",
    preview: "",
    summary: params.reconnectTarget
      ? "수정할 기존 작업 후보가 여러 개라서 확인이 필요합니다."
      : "수정할 기존 작업을 찾지 못해 확인이 필요합니다.",
    reason: params.reconnectTarget
      ? "같은 채팅 안에 비슷한 작업이 여러 개 있어 자동으로 하나를 선택하지 않았습니다."
      : "참조형 수정 요청으로 보이지만 연결할 기존 작업 후보를 찾지 못했습니다.",
    userMessage: params.reconnectTarget
      ? "어느 기존 작업을 수정하려는지 더 구체적으로 적어 주세요. 폴더명이나 파일명, 예를 들어 달력 또는 계산기처럼 지정해 주세요."
      : "수정할 기존 작업을 더 구체적으로 적어 주세요. 폴더명, 파일명, 프로그램명 중 하나를 함께 적어 주세요.",
    remainingItems: params.reconnectSelection?.candidates?.length
      ? params.reconnectSelection.candidates.map((candidate) => `후보: ${candidate.title}`)
      : ["수정할 대상 작업 이름 또는 경로를 지정해 주세요."],
    eventLabel: "기존 작업 수정 대상 확인 필요",
  }
}

async function executeLoopDirective(params: {
  runId: string
  sessionId: string
  source: StartRootRunParams["source"]
  onChunk: StartRootRunParams["onChunk"]
  directive: LoopDirective
}): Promise<"break"> {
  if (params.directive.eventLabel) {
    appendRunEvent(params.runId, params.directive.eventLabel)
  }

  if (params.directive.kind === "complete") {
    await completeRunWithAssistantMessage(
      params.runId,
      params.sessionId,
      params.directive.text,
      params.source,
      params.onChunk,
    )
    return "break"
  }

  if (params.directive.kind === "retry_intake") {
    throw new Error("retry_intake directive must be handled inside the main loop before executeLoopDirective")
  }

  await moveRunToAwaitingUser(params.runId, params.sessionId, params.source, params.onChunk, {
    preview: params.directive.preview,
    summary: params.directive.summary,
    ...(params.directive.reason ? { reason: params.directive.reason } : {}),
    ...(params.directive.userMessage ? { userMessage: params.directive.userMessage } : {}),
    ...(params.directive.remainingItems ? { remainingItems: params.directive.remainingItems } : {}),
  })
  return "break"
}

function ensureSessionExists(sessionId: string, source: StartRootRunParams["source"], now: number): void {
  const existing = getSession(sessionId)
  if (!existing) {
    insertSession({
      id: sessionId,
      source,
      source_id: null,
      created_at: now,
      updated_at: now,
      summary: null,
    })
    return
  }

  getDb()
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(now, sessionId)
}

async function tryHandleIntakeBridge(params: {
  message: string
  originalRequest: string
  sessionId: string
  requestGroupId: string
  model: string | undefined
  workDir: string
  source: StartRootRunParams["source"]
  runId: string
  onChunk: StartRootRunParams["onChunk"]
  reuseConversationContext: boolean
}): Promise<LoopDirective | null> {
  const intakeSessionId = params.requestGroupId !== params.runId || params.reuseConversationContext
    ? params.sessionId
    : undefined
  const intake = await analyzeTaskIntake({
    userMessage: params.message,
    ...(intakeSessionId ? { sessionId: intakeSessionId } : {}),
    requestGroupId: params.requestGroupId,
    ...(params.model ? { model: params.model } : {}),
    workDir: params.workDir,
    source: params.source,
  }).catch(() => null)

  if (!intake) return null

  log.info("intake bridge result", {
    runId: params.runId,
    sessionId: params.sessionId,
    category: intake.intent.category,
    actions: intake.action_items.map((item) => item.type),
    scheduling: intake.scheduling,
  })

  appendRunEvent(params.runId, `Intake: ${intake.intent.category}`)
  if (intake.intent.summary.trim()) {
    updateRunSummary(params.runId, intake.intent.summary.trim())
  }

  const replyAction = intake.action_items.find((item) => item.type === "reply")
  if (replyAction) {
    const content = getString(replyAction.payload.content)
    if (content) {
      return {
        kind: "complete",
        text: content,
        eventLabel: "intake 즉시 응답 완료",
      }
    }
  }

  const scheduleActions = intake.action_items.filter((item) => item.type === "create_schedule" || item.type === "cancel_schedule")
  const delegatedActions = intake.action_items.filter(
    (item) => item.type === "run_task" || item.type === "delegate_agent",
  )

  if (scheduleActions.length > 0 || delegatedActions.length > 0 || intake.intent.category === "schedule_request") {
    const responseParts: string[] = []

    if (scheduleActions.length > 0 || intake.intent.category === "schedule_request") {
      const scheduleResult = executeScheduleActions(scheduleActions, intake, params)
      log.info("schedule action handled", {
        runId: params.runId,
        sessionId: params.sessionId,
        count: scheduleActions.length,
        ok: scheduleResult.ok,
        message: scheduleResult.message,
      })
      const shouldRetryScheduleIntake = !scheduleResult.ok
        && scheduleResult.successCount === 0
        && delegatedActions.length === 0

      if (shouldRetryScheduleIntake) {
        return {
          kind: "retry_intake",
          summary: "일정 요청을 다시 분석하고 가능한 일정 방안으로 재시도합니다.",
          reason: scheduleResult.detail || scheduleResult.message,
          message: buildScheduleIntakeRecoveryPrompt({
            originalRequest: params.originalRequest,
            previousReceipt: scheduleResult.message,
            reason: scheduleResult.detail || scheduleResult.message,
          }),
          remainingItems: [
            "유효한 run_at 또는 cron 일정으로 다시 해석",
            "필요한 경우에만 최소한의 확인 질문 생성",
          ],
          eventLabel: "일정 해석 실패로 재분석",
        }
      }

      if (scheduleResult.message.trim()) {
        responseParts.push(scheduleResult.message.trim())
      }
    }

    if (delegatedActions.length > 0) {
      const delegatedReceipt = buildDelegatedReceipt(intake, delegatedActions, responseParts.length > 0)
      if (delegatedReceipt) responseParts.push(delegatedReceipt)
    }

    for (const delegatedAction of delegatedActions) {
      const delegatedTaskProfile = inferDelegatedTaskProfile({
        intake,
        action: delegatedAction,
      })
      const followupPrompt = buildFollowupPrompt(params.originalRequest, intake, delegatedAction, delegatedTaskProfile)
      const route = resolveRunRoute({
        preferredTarget:
          getString(delegatedAction.payload.preferred_target)
          || getString(delegatedAction.payload.preferredTarget)
          || intake.execution.suggested_target,
        taskProfile: delegatedTaskProfile,
        fallbackModel: params.model,
      })

      appendRunEvent(
        params.runId,
        route.targetLabel
          ? `후속 실행 생성: ${delegatedAction.title} -> ${route.targetLabel} (${delegatedTaskProfile})`
          : `후속 실행 생성: ${delegatedAction.title} (${delegatedTaskProfile})`,
      )
      log.info("delegated follow-up run created", {
        runId: params.runId,
        sessionId: params.sessionId,
        delegatedType: delegatedAction.type,
        delegatedTitle: delegatedAction.title,
        delegatedTaskProfile,
        targetId: route.targetId ?? null,
        targetLabel: route.targetLabel ?? null,
        model: route.model ?? params.model ?? null,
        providerId: route.providerId ?? null,
        workerRuntime: route.workerRuntime?.kind ?? null,
      })
      incrementDelegationTurnCount(params.runId, `${delegatedAction.title} 후속 작업을 시작합니다.`)

      startRootRun({
        message: followupPrompt,
        sessionId: params.sessionId,
        taskProfile: normalizeTaskProfile(delegatedTaskProfile),
        requestGroupId: params.requestGroupId,
        originalRequest: params.message,
        executionSemantics: intake.execution.execution_semantics,
        structuredRequest: intake.structured_request,
        model: route.model ?? params.model,
        ...(route.providerId ? { providerId: route.providerId } : {}),
        ...(route.provider ? { provider: route.provider } : {}),
        ...(route.workerRuntime ? { workerRuntime: route.workerRuntime } : {}),
        ...(route.targetId ? { targetId: route.targetId } : {}),
        ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
        workDir: params.workDir,
        source: params.source,
        skipIntake: true,
        onChunk: params.onChunk,
      })
    }

    if (responseParts.length > 0) {
      return {
        kind: "complete",
        text: responseParts.join("\n\n"),
        eventLabel: "intake 처리 결과 전달",
      }
    }

    if (delegatedActions.length > 0) {
      return {
        kind: "complete",
        text: "후속 실행을 시작했습니다.",
        eventLabel: "intake 후속 실행 생성 완료",
      }
    }
    return null
  }

  if (intake.user_message.mode === "clarification_receipt" || intake.user_message.mode === "failed_receipt") {
    const text = intake.user_message.text.trim()
    if (text) {
      return {
        kind: "complete",
        text,
        eventLabel: "intake 확인 응답 완료",
      }
    }
  }

  return null
}

interface ScheduleActionExecutionResult {
  ok: boolean
  message: string
  detail: string
  successCount: number
  failureCount: number
}

function executeScheduleActions(
  actions: TaskIntakeActionItem[],
  intake: TaskIntakeResult,
  params: {
    message: string
    originalRequest: string
    sessionId: string
    requestGroupId: string
    model: string | undefined
    workDir?: string | undefined
    source: StartRootRunParams["source"]
    onChunk: StartRootRunParams["onChunk"]
  },
): ScheduleActionExecutionResult {
  if (actions.length === 0) {
    const receipt = intake.user_message.text.trim()
    return {
      ok: false,
      message: receipt || "일정 요청을 해석했지만 생성할 스케줄 정보가 부족합니다.",
      detail: "일정 생성 항목이 없습니다.",
      successCount: 0,
      failureCount: 1,
    }
  }

  if (actions.length === 1) {
    return executeScheduleAction(actions[0], intake, params, intake.user_message.text.trim())
  }

  const results = actions.map((action) => executeScheduleAction(action, intake, params, ""))
  const receipt = intake.user_message.text.trim() || "여러 예약 작업을 접수했습니다."
  const hasCreate = actions.some((action) => action.type === "create_schedule")
  const heading = results.every((result) => result.ok)
    ? hasCreate ? "일정 요청을 처리했습니다." : "예약 변경을 처리했습니다."
    : hasCreate ? "일부 일정 생성에 실패했습니다." : "일부 예약 변경에 실패했습니다."

  return {
    ok: results.every((result) => result.ok),
    message: [receipt, "", heading, ...results.map((result) => `- ${result.detail}`)].join("\n"),
    detail: results.map((result) => result.detail).join(" / "),
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
  }
}

function executeScheduleAction(
  action: TaskIntakeActionItem | undefined,
  intake: TaskIntakeResult,
  params: {
    message: string
    originalRequest: string
    sessionId: string
    requestGroupId: string
    model: string | undefined
    workDir?: string | undefined
    source: StartRootRunParams["source"]
    onChunk: StartRootRunParams["onChunk"]
  },
  receipt: string,
): ScheduleActionExecutionResult {
  if (!action || action.type === "create_schedule") {
    return executeCreateScheduleAction(action, intake, params, receipt)
  }
  if (action.type === "cancel_schedule") {
    return executeCancelScheduleAction(action, intake, receipt)
  }

  return {
    ok: false,
    message: receipt || "현재 이 일정 요청 유형은 아직 처리할 수 없습니다.",
    detail: action.title,
    successCount: 0,
    failureCount: 1,
  }
}

function executeCreateScheduleAction(
  action: TaskIntakeActionItem | undefined,
  intake: TaskIntakeResult,
  params: {
    message: string
    originalRequest: string
    sessionId: string
    requestGroupId: string
    model: string | undefined
    workDir?: string | undefined
    source: StartRootRunParams["source"]
    onChunk: StartRootRunParams["onChunk"]
  },
  receipt: string,
): ScheduleActionExecutionResult {
  if (!action) {
    return {
      ok: false,
      message: receipt || "일정 요청을 해석했지만 생성할 스케줄 정보가 부족합니다.",
      detail: "일정 생성 정보가 부족합니다.",
      successCount: 0,
      failureCount: 1,
    }
  }

  const title = getString(action.payload.title) || "Scheduled Task"
  const task = getString(action.payload.task) || intake.intent.summary || title
  const cron = getString(action.payload.cron) || intake.scheduling.cron
  const runAt = getString(action.payload.run_at) || intake.scheduling.run_at
  const actionScheduleText = getString(action.payload.schedule_text)

  if (runAt) {
    const scheduledAt = Date.parse(runAt)
    if (Number.isNaN(scheduledAt)) {
      return {
        ok: false,
        message: receipt
          ? `${receipt}\n\n일정 생성 실패: run_at 형식이 올바르지 않습니다.`
          : "일정 생성 실패: run_at 형식이 올바르지 않습니다.",
        detail: `${actionScheduleText ?? title}: run_at 형식이 올바르지 않습니다.`,
        successCount: 0,
        failureCount: 1,
      }
    }

    const followup = getFollowupRunPayload(action)
    const immediateCompletionText = followup.literalText ?? extractDirectChannelDeliveryText(task)
    log.info("registering delayed run", {
      sessionId: params.sessionId,
      title,
      runAt,
      task,
      directDelivery: immediateCompletionText != null,
      preferredTarget: followup.preferredTarget ?? null,
      taskProfile: followup.taskProfile ?? null,
    })
    const scheduledTaskProfile = normalizeTaskProfile(followup.taskProfile ?? "general_chat")
    const executionOptions = getScheduledRunExecutionOptions(task, scheduledTaskProfile)
    scheduleDelayedRootRun({
      runAtMs: scheduledAt,
      message: buildScheduledFollowupPrompt({
        task,
        goal: followup.goal ?? task,
        taskProfile: scheduledTaskProfile,
        preferredTarget: followup.preferredTarget ?? intake.execution.suggested_target,
        toolsEnabled: executionOptions.toolsEnabled,
        destination: followup.destination ?? intake.structured_request.to,
      }),
      sessionId: params.sessionId,
      requestGroupId: params.requestGroupId,
      model: params.model,
      originalRequest: params.originalRequest,
      executionSemantics: intake.execution.execution_semantics,
      structuredRequest: intake.structured_request,
      source: params.source,
      onChunk: params.onChunk,
      ...(immediateCompletionText ? { immediateCompletionText } : {}),
      toolsEnabled: executionOptions.toolsEnabled,
      contextMode: executionOptions.contextMode,
      ...(params.workDir ? { workDir: params.workDir } : {}),
      ...(followup.preferredTarget ? { preferredTarget: followup.preferredTarget } : {}),
      taskProfile: scheduledTaskProfile,
    })

    const scheduleText = actionScheduleText || new Date(scheduledAt).toLocaleString("ko-KR")
    return {
      ok: true,
      message: receipt
        ? `${receipt}\n\n일회성 예약 실행이 저장되었습니다.\n- 이름: ${title}\n- 실행 시각: ${scheduleText}`
        : `일회성 예약 실행이 저장되었습니다.\n- 이름: ${title}\n- 실행 시각: ${scheduleText}`,
      detail: `${scheduleText}: ${task}`,
      successCount: 1,
      failureCount: 0,
    }
  }

  if (!cron || !isValidCron(cron)) {
    const reason = intake.scheduling.failure_reason
      ?? "현재 실행 브리지에서는 유효한 cron 일정이 필요합니다."
    return {
      ok: false,
      message: receipt
        ? `${receipt}\n\n일정 생성 실패: ${reason}`
        : `일정 생성 실패: ${reason}`,
      detail: `${actionScheduleText ?? title}: ${reason}`,
      successCount: 0,
      failureCount: 1,
    }
  }

  const now = Date.now()
  const scheduleId = crypto.randomUUID()
  insertSchedule({
    id: scheduleId,
    name: title,
    cron_expression: cron,
    prompt: task,
    enabled: 1,
    target_channel: params.source === "telegram" ? "telegram" : "agent",
    target_session_id: params.source === "telegram" ? params.sessionId : null,
    execution_driver: "internal",
    model: params.model ?? null,
    max_retries: 3,
    timeout_sec: 300,
    created_at: now,
    updated_at: now,
  })
  const executionSync = reconcileScheduleExecution(scheduleId)

  const scheduleText = actionScheduleText || cron
  return {
    ok: true,
    message: receipt
      ? `${receipt}\n\n스케줄이 저장되었습니다.\n- 이름: ${title}\n- 일정: ${scheduleText}${executionSync.reason ? `\n- 실행 방식: 내부 scheduler (${executionSync.reason})` : executionSync.driver === "internal" ? "\n- 실행 방식: 내부 scheduler" : "\n- 실행 방식: 시스템 스케줄러"}`
      : `스케줄이 저장되었습니다.\n- 이름: ${title}\n- 일정: ${scheduleText}${executionSync.reason ? `\n- 실행 방식: 내부 scheduler (${executionSync.reason})` : executionSync.driver === "internal" ? "\n- 실행 방식: 내부 scheduler" : "\n- 실행 방식: 시스템 스케줄러"}`,
    detail: `${scheduleText}: ${task}`,
    successCount: 1,
    failureCount: 0,
  }
}

function executeCancelScheduleAction(
  action: TaskIntakeActionItem,
  intake: TaskIntakeResult,
  receipt: string,
): ScheduleActionExecutionResult {
  const scheduleIds = Array.isArray(action.payload.schedule_ids)
    ? action.payload.schedule_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : []

  if (scheduleIds.length === 0) {
    return {
      ok: false,
      message: receipt || "취소할 예약 알림을 찾지 못했습니다.",
      detail: "취소 대상 스케줄 ID가 없습니다.",
      successCount: 0,
      failureCount: 1,
    }
  }

  const cancelledNames: string[] = []
  for (const scheduleId of scheduleIds) {
    const schedule = getSchedule(scheduleId)
    if (!schedule) continue
    updateSchedule(scheduleId, { enabled: 0 })
    removeManagedScheduleExecution(scheduleId)
    cancelledNames.push(schedule.name)
  }

  if (cancelledNames.length === 0) {
    return {
      ok: false,
      message: receipt || "취소할 예약 알림을 찾지 못했습니다.",
      detail: "활성 예약 알림을 찾지 못했습니다.",
      successCount: 0,
      failureCount: 1,
    }
  }

  const summary = cancelledNames.length === 1
    ? `"${cancelledNames[0]}" 예약 알림을 취소했습니다.`
    : `${cancelledNames.length}개의 예약 알림을 취소했습니다.\n- ${cancelledNames.join("\n- ")}`

  return {
    ok: true,
    message: receipt ? `${receipt}\n\n${summary}` : summary,
    detail: cancelledNames.join(", "),
    successCount: cancelledNames.length,
    failureCount: 0,
  }
}

function buildDelegatedReceipt(
  intake: TaskIntakeResult,
  actions: TaskIntakeActionItem[],
  appendMode: boolean,
): string {
  if (actions.length === 0) return ""

  if (actions.length === 1) {
    const fallback = "요청을 접수했습니다. 후속 실행을 시작합니다."
    if (appendMode) return "추가 후속 실행을 시작합니다."
    return intake.user_message.text.trim() || fallback
  }

  const lines = actions.map((action) => `- ${action.title}`)
  const header = appendMode
    ? "추가 후속 실행을 시작합니다."
    : (intake.user_message.text.trim() || "여러 요청을 접수했고 후속 실행을 시작합니다.")

  return [header, ...lines].join("\n")
}

function formatStructuredRequestBlock(intake: TaskIntakeResult, fallbackContext: string, fallbackTarget: string): string {
  const structured = intake.structured_request
  const target = structured.target.trim() || fallbackTarget.trim()
  const destination = structured.to.trim() || "the current execution target"
  const contextLines = structured.context.length > 0
    ? structured.context
    : [fallbackContext.trim()].filter(Boolean)
  const completeConditionLines = structured.complete_condition.length > 0
    ? structured.complete_condition
    : ["Produce the requested result in the current execution."]

  return [
    "[target]",
    target,
    "",
    "[to]",
    destination,
    "",
    "[context]",
    ...contextLines.map((item) => `- ${item}`),
    structured.normalized_english
      ? ["", "[normalized-english]", structured.normalized_english].join("\n")
      : "",
    "",
    "[complete-condition]",
    ...completeConditionLines.map((item) => `- ${item}`),
  ]
    .filter(Boolean)
    .join("\n")
}

function buildFollowupPrompt(originalMessage: string, intake: TaskIntakeResult, action: TaskIntakeActionItem, taskProfile: string): string {
  const payload = action.payload
  const goal = getString(payload.goal) || action.title
  const context = getString(payload.context) || intake.intent.summary || originalMessage
  const successCriteria = toStringList(payload.success_criteria)
  const constraints = toStringList(payload.constraints)
  const preferredTarget = getString(payload.preferred_target) || getString(payload.preferredTarget) || intake.execution.suggested_target
  const requiresFilesystemMutation = intake.execution.execution_semantics.filesystemEffect === "mutate"

  return [
    "[Task Intake Bridge]",
    "이 요청은 intake router에서 접수되어 후속 실행으로 전달되었습니다.",
    `원래 사용자 요청: ${originalMessage}`,
    formatStructuredRequestBlock(intake, context, goal),
    `작업 프로필: ${taskProfile}`,
    preferredTarget ? `선호 대상: ${preferredTarget}` : "",
    successCriteria.length > 0 ? ["성공 조건:", ...successCriteria.map((item) => `- ${item}`)].join("\n") : "",
    constraints.length > 0 ? ["제약 사항:", ...constraints.map((item) => `- ${item}`)].join("\n") : "",
    "사용자가 지정한 이름, 따옴표 안 문자열, 파일명, 폴더명, 경로, 언어를 그대로 유지하세요. 폴더명 같은 리터럴을 번역하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요. 사용자가 번역을 요청하지 않았다면 언어를 바꾸지 마세요.",
    requiresFilesystemMutation
      ? "이 요청은 실제 로컬 파일 또는 폴더 변경이 필요합니다. 로컬 도구를 사용해 실제로 생성하거나 수정하세요. 코드 조각, 설명문, 수동 안내만 남기고 끝내지 마세요."
      : "지금 실제 작업을 수행하세요. 다시 intake 접수 메시지를 만들지 말고, 실제 결과를 만들어 내세요.",
  ].filter(Boolean).join("\n\n")
}

function buildScheduleIntakeRecoveryPrompt(params: {
  originalRequest: string
  previousReceipt: string
  reason: string
}): string {
  return [
    "[Schedule Intake Recovery]",
    "The previous schedule-analysis pass did not create a valid schedule action.",
    `Original user request: ${params.originalRequest}`,
    `Previous schedule receipt: ${params.previousReceipt}`,
    `Failure reason: ${params.reason}`,
    "Re-analyze this as a scheduling request.",
    "Produce a concrete create_schedule or cancel_schedule action with a valid run_at or cron value.",
    "Only ask a clarification question if a required time expression or delivery target is truly missing.",
    "Do not return a success receipt unless a schedule action can actually be executed.",
  ].join("\n\n")
}

function getFollowupRunPayload(action: TaskIntakeActionItem): {
  goal?: string
  literalText?: string
  destination?: string
  taskProfile?: string
  preferredTarget?: string
} {
  const payload = action.payload.followup_run_payload
  if (!payload || typeof payload !== "object") {
    return {}
  }

  const record = payload as Record<string, unknown>
  const goal = getString(record.goal)
  const literalText = getString(record.literal_text) || getString(record.literalText)
  const destination = getString(record.destination)
  const taskProfile = getString(record.task_profile) || getString(record.taskProfile)
  const preferredTarget = getString(record.preferred_target) || getString(record.preferredTarget)

  return {
    ...(goal ? { goal } : {}),
    ...(literalText ? { literalText } : {}),
    ...(destination ? { destination } : {}),
    ...(taskProfile ? { taskProfile } : {}),
    ...(preferredTarget ? { preferredTarget } : {}),
  }
}

async function completeRunWithAssistantMessage(
  runId: string,
  sessionId: string,
  text: string,
  source: StartRootRunParams["source"],
  onChunk: StartRootRunParams["onChunk"],
): Promise<void> {
  eventBus.emit("agent.start", { sessionId, runId })
  if (text) {
    insertMessage({
      id: crypto.randomUUID(),
      session_id: sessionId,
      root_run_id: runId,
      role: "assistant",
      content: text,
      tool_calls: null,
      tool_call_id: null,
      created_at: Date.now(),
    })
    logAssistantReply(source, text)
    eventBus.emit("agent.stream", { sessionId, runId, delta: text })
    await deliverChunk(onChunk, { type: "text", delta: text }, runId)
  }
  rememberRunSuccess({
    runId,
    sessionId,
    source,
    text,
    summary: text || "실행을 완료했습니다.",
  })
  eventBus.emit("agent.end", { sessionId, runId, durationMs: 0 })
  await deliverChunk(onChunk, { type: "done", totalTokens: 0 }, runId)

  setRunStepStatus(runId, "executing", "completed", text || "응답 생성을 마쳤습니다.")
  setRunStepStatus(runId, "reviewing", "completed", text || "응답을 정리했습니다.")
  setRunStepStatus(runId, "finalizing", "completed", "실행 결과를 저장했습니다.")
  setRunStepStatus(runId, "completed", "completed", text || "실행을 완료했습니다.")
  updateRunStatus(runId, "completed", text || "실행을 완료했습니다.", false)
  appendRunEvent(runId, "실행 완료")
}

async function emitStandaloneAssistantMessage(
  runId: string,
  sessionId: string,
  text: string,
  source: StartRootRunParams["source"],
  onChunk: StartRootRunParams["onChunk"],
): Promise<void> {
  if (!text.trim()) return
  eventBus.emit("agent.start", { sessionId, runId })
  insertMessage({
    id: crypto.randomUUID(),
    session_id: sessionId,
    root_run_id: runId,
    role: "assistant",
    content: text,
    tool_calls: null,
    tool_call_id: null,
    created_at: Date.now(),
  })
  logAssistantReply(source, text)
  eventBus.emit("agent.stream", { sessionId, runId, delta: text })
  await deliverChunk(onChunk, { type: "text", delta: text }, runId)
  eventBus.emit("agent.end", { sessionId, runId, durationMs: 0 })
  await deliverChunk(onChunk, { type: "done", totalTokens: 0 }, runId)
}

function buildAwaitingUserMessage(params: {
  preview: string
  summary: string
  reason?: string
  userMessage?: string
  remainingItems?: string[]
}): string {
  const remainingItems = params.remainingItems?.filter((item) => item.trim()) ?? []
  const lines = [
    params.userMessage?.trim() || params.summary.trim(),
    params.preview.trim() ? `현재까지 결과:\n${params.preview.trim()}` : "",
    remainingItems.length > 0 ? `남은 항목:\n- ${remainingItems.join("\n- ")}` : "",
    params.reason?.trim() ? `중단 사유: ${params.reason.trim()}` : "",
  ].filter(Boolean)

  return lines.join("\n\n")
}

function rememberRunInstruction(params: {
  runId: string
  sessionId: string
  requestGroupId: string
  source: StartRootRunParams["source"]
  message: string
}): void {
  safeInsertMemoryJournalRecord({
    kind: "instruction",
    title: "instruction",
    content: params.message,
    summary: condenseMemoryText(params.message, 280),
    sessionId: params.sessionId,
    runId: params.runId,
    requestGroupId: params.requestGroupId,
    source: params.source,
    tags: ["instruction"],
  })
}

function rememberRunSuccess(params: {
  runId: string
  sessionId: string
  source: StartRootRunParams["source"]
  text: string
  summary: string
}): void {
  const run = getRootRun(params.runId)
  safeInsertMemoryJournalRecord({
    kind: "success",
    title: "success",
    content: params.text,
    summary: condenseMemoryText(params.summary || params.text, 280),
    sessionId: params.sessionId,
    runId: params.runId,
    ...(run?.requestGroupId ? { requestGroupId: run.requestGroupId } : {}),
    source: params.source,
    tags: ["success"],
  })
}

function rememberRunFailure(params: {
  runId: string
  sessionId: string
  source: StartRootRunParams["source"]
  summary: string
  detail?: string
  title?: string
}): void {
  const run = getRootRun(params.runId)
  const detail = params.detail?.trim() || params.summary
  safeInsertMemoryJournalRecord({
    kind: "failure",
    title: params.title || "failure",
    content: detail,
    summary: extractFocusedErrorMessage(detail, 280) || condenseMemoryText(params.summary, 280),
    sessionId: params.sessionId,
    runId: params.runId,
    ...(run?.requestGroupId ? { requestGroupId: run.requestGroupId } : {}),
    source: params.source,
    tags: ["failure"],
  })
}

function safeInsertMemoryJournalRecord(params: {
  kind: "instruction" | "success" | "failure" | "response"
  title: string
  content: string
  summary: string
  sessionId?: string
  runId?: string
  requestGroupId?: string
  source?: string
  tags?: string[]
}): void {
  try {
    insertMemoryJournalRecord(params)
  } catch (error) {
    log.warn(`memory journal insert failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface FilesystemVerificationResult {
  ok: boolean
  summary: string
  reason?: string
  remainingItems?: string[]
}

interface FilesystemVerificationTarget {
  path: string
  kind: "file" | "dir"
  expect: "exists" | "missing"
}

async function runFilesystemVerificationSubtask(params: {
  parentRunId: string
  requestGroupId: string
  sessionId: string
  source: StartRootRunParams["source"]
  onChunk: StartRootRunParams["onChunk"]
  originalRequest: string
  mutationPaths: string[]
  workDir: string
}): Promise<FilesystemVerificationResult> {
  const runId = crypto.randomUUID()
  const prompt = buildFilesystemVerificationPrompt(params.originalRequest, params.mutationPaths)
  createRootRun({
    id: runId,
    sessionId: params.sessionId,
    requestGroupId: params.requestGroupId,
    prompt,
    source: params.source,
    taskProfile: "review",
    targetLabel: "결과 검증",
    contextMode: "request_group",
    maxDelegationTurns: 0,
  })

  appendRunEvent(params.parentRunId, "결과 검증 하위 작업을 생성했습니다.")
  setRunStepStatus(runId, "received", "completed", "결과 검증 하위 작업을 생성했습니다.")
  setRunStepStatus(runId, "classified", "completed", "파일 생성 결과 검증 요청으로 분류했습니다.")
  setRunStepStatus(runId, "target_selected", "completed", "로컬 파일 검증 대상을 선택했습니다.")
  setRunStepStatus(runId, "executing", "running", "생성 결과를 확인 중입니다.")
  updateRunStatus(runId, "running", "생성 결과를 확인 중입니다.", true)
  appendRunEvent(runId, "결과 검증 시작")

  const verification = verifyFilesystemTargets({
    originalRequest: params.originalRequest,
    mutationPaths: params.mutationPaths,
    workDir: params.workDir,
  })

  if (verification.ok) {
    finalizeAnalysisOnlySubrun(runId, {
      executionSummary: verification.summary,
      relaySummary: "검증 분석 결과를 상위 태스크에 전달했습니다.",
      eventLabel: "검증 분석 종료",
    })
    appendRunEvent(params.parentRunId, "결과 검증 하위 작업이 성공 분석 결과를 전달했습니다.")
    return { ok: true, summary: verification.summary }
  }

  finalizeAnalysisOnlySubrun(runId, {
    executionSummary: verification.summary,
    relaySummary: "검증 분석 결과를 상위 태스크에 전달했습니다.",
    eventLabel: "검증 분석 종료",
  })
  appendRunEvent(params.parentRunId, "결과 검증 하위 작업이 실패 분석 결과를 전달했습니다.")
  return {
    ok: false,
    summary: verification.summary,
    ...(verification.reason ? { reason: verification.reason } : {}),
    ...(verification.remainingItems ? { remainingItems: verification.remainingItems } : {}),
  }
}

function finalizeAnalysisOnlySubrun(runId: string, params: {
  executionSummary: string
  relaySummary: string
  eventLabel?: string
}): void {
  setRunStepStatus(runId, "executing", "completed", params.executionSummary)
  setRunStepStatus(runId, "reviewing", "completed", params.relaySummary)
  setRunStepStatus(runId, "finalizing", "completed", "보조 분석 결과를 상위 태스크에 넘겼습니다.")
  updateRunStatus(runId, "interrupted", params.relaySummary, false)
  if (params.eventLabel) appendRunEvent(runId, params.eventLabel)
}

function buildFilesystemVerificationPrompt(originalRequest: string, mutationPaths: string[]): string {
  const lines = [
    "[Filesystem Verification]",
    `원래 사용자 요청: ${originalRequest}`,
  ]
  if (mutationPaths.length > 0) {
    lines.push("검증 대상 경로:")
    for (const mutationPath of mutationPaths) lines.push(`- ${mutationPath}`)
  }
  return lines.join("\n")
}

function verifyFilesystemTargets(params: {
  originalRequest: string
  mutationPaths: string[]
  workDir: string
}): {
  ok: boolean
  summary: string
  message: string
  reason?: string
  remainingItems?: string[]
} {
  const targets = inferFilesystemVerificationTargets(params.originalRequest, params.mutationPaths, params.workDir)
  if (targets.length === 0) {
    return {
      ok: false,
      summary: "생성 결과를 검증할 경로를 찾지 못했습니다.",
      message: "검증 결과:\n- 검증할 파일 또는 폴더 경로를 자동으로 추론하지 못했습니다.",
      reason: "검증 대상 경로 추론 실패",
      remainingItems: ["생성 또는 수정이 일어난 경로를 다시 확인해 주세요."],
    }
  }

  const confirmed: string[] = []
  const missing: string[] = []
  const readableSummaries: string[] = []

  for (const target of targets) {
    if (!existsSync(target.path)) {
      if (target.expect === "exists") missing.push(`${displayHomePath(target.path)} (${target.kind})`)
      else confirmed.push(`삭제 확인: ${displayHomePath(target.path)}`)
      continue
    }

    const stat = safeStat(target.path)
    if (!stat) {
      missing.push(`${displayHomePath(target.path)} (${target.kind})`)
      continue
    }

    if (target.expect === "missing") {
      missing.push(`${displayHomePath(target.path)} (삭제되어야 함)`)
      continue
    }

    if (target.kind === "dir" && !stat.isDirectory()) {
      missing.push(`${displayHomePath(target.path)} (폴더가 아님)`)
      continue
    }
    if (target.kind === "file" && !stat.isFile()) {
      missing.push(`${displayHomePath(target.path)} (파일이 아님)`)
      continue
    }

    confirmed.push(`${target.kind === "dir" ? "폴더 확인" : "파일 확인"}: ${displayHomePath(target.path)}`)
    if (target.kind === "file" && readableSummaries.length < 2) {
      const snippet = safeReadSnippet(target.path)
      if (snippet) readableSummaries.push(`읽기 확인: ${displayHomePath(target.path)} -> ${snippet}`)
    }
  }

  if (missing.length > 0) {
    const remainingItems = missing.map((item) => `${item} 경로를 다시 확인해야 합니다.`)
    const lines = [
      "검증 결과:",
      ...confirmed.map((item) => `- ${item}`),
      ...readableSummaries.map((item) => `- ${item}`),
      ...missing.map((item) => `- 누락: ${item}`),
    ]
    return {
      ok: false,
      summary: "생성된 파일 또는 폴더를 자동 검증하지 못했습니다.",
      message: lines.join("\n"),
      reason: "실제 생성 증거가 충분하지 않습니다.",
      remainingItems,
    }
  }

  const lines = [
    "검증 결과:",
    ...confirmed.map((item) => `- ${item}`),
    ...readableSummaries.map((item) => `- ${item}`),
  ]
  const firstConfirmed = confirmed[0]
  return {
    ok: true,
    summary: firstConfirmed
      ? `실제 파일/폴더 생성 검증 완료: ${firstConfirmed.replace(/^.+?:\s*/, "")}`
      : "실제 파일/폴더 생성 검증을 완료했습니다.",
    message: lines.join("\n"),
  }
}

function inferFilesystemVerificationTargets(originalRequest: string, mutationPaths: string[], workDir: string): FilesystemVerificationTarget[] {
  const targets = new Map<string, FilesystemVerificationTarget>()
  const requestForInference = originalRequest.trim()
  const normalizedMutationPaths = mutationPaths
    .map((item) => normalizeFilesystemPath(item, workDir))
    .filter((item): item is string => Boolean(item))

  const expectsDeletion = /(삭제|지워|remove|delete)/iu.test(requestForInference)
  for (const mutationPath of normalizedMutationPaths) {
    const normalized = mutationPath.replace(/\/$/, "")
    if (!normalized) continue
    const kind: "file" | "dir" = extname(normalized) ? "file" : "dir"
    targets.set(normalized, { path: normalized, kind, expect: expectsDeletion ? "missing" : "exists" })
    if (kind === "file") {
      const parent = resolve(normalized, "..")
      if (!targets.has(parent) && !expectsDeletion) {
        targets.set(parent, { path: parent, kind: "dir", expect: "exists" })
      }
    }
  }

  const baseDir = inferFilesystemBaseDir(requestForInference)
  const quotedNames = extractQuotedFilesystemNames(requestForInference)
  const mentionsFolder = /(폴더|디렉터리|folder|directory)/iu.test(requestForInference)
  const mentionsWebProgram = /(웹\s*(달력|계산기|페이지|프로그램)|html|css|js|javascript|web\s*(app|page)|calendar|calculator)/iu.test(requestForInference)

  if (baseDir && quotedNames.length > 0) {
    for (const name of quotedNames) {
      if (!name.includes("/")) {
        const dirPath = resolve(join(baseDir, name))
        if (mentionsFolder || mentionsWebProgram) {
          targets.set(dirPath, { path: dirPath, kind: "dir", expect: expectsDeletion ? "missing" : "exists" })
          if (mentionsWebProgram && !expectsDeletion) {
            const indexPath = join(dirPath, "index.html")
            targets.set(indexPath, { path: indexPath, kind: "file", expect: "exists" })
          }
        }
      }
      if (/\.[a-z0-9]+$/iu.test(name)) {
        const filePath = resolve(join(baseDir, name))
        targets.set(filePath, { path: filePath, kind: "file", expect: expectsDeletion ? "missing" : "exists" })
      }
    }
  }

  return [...targets.values()]
}

function extractQuotedFilesystemNames(value: string): string[] {
  const names = new Set<string>()

  for (const quote of ['"', "'"]) {
    let cursor = 0
    while (cursor < value.length) {
      const startIndex = value.indexOf(quote, cursor)
      if (startIndex < 0) break
      const endIndex = value.indexOf(quote, startIndex + 1)
      if (endIndex < 0) break

      const token = value.slice(startIndex + 1, endIndex).trim()
      if (token && isSafeFilesystemLiteral(token)) names.add(token)
      cursor = endIndex + 1
    }
  }

  return [...names]
}

function isSafeFilesystemLiteral(value: string): boolean {
  if (!value) return false

  for (const blockedCharacter of ["\r", "\n", "\t", "<", ">"] as const) {
    if (value.includes(blockedCharacter)) return false
  }

  const lowered = value.toLowerCase()
  const blockedPrefixes = [
    "context",
    "goal",
    "success criteria",
    "\uc6d0\ub798 \uc0ac\uc6a9\uc790 \uc694\uccad",
    "\ubb38\ub9e5",
    "\ubaa9\ud45c",
    "\uc81c\uc57d \uc0ac\ud56d",
  ]

  if (blockedPrefixes.some((prefix) => lowered.startsWith(prefix.toLowerCase()))) {
    return false
  }

  const wordCount = value.trim().split(" ").filter(Boolean).length
  if (wordCount > 6 && !value.includes("/") && !value.includes("\\")) {
    return false
  }

  return true
}

function inferFilesystemBaseDir(originalRequest: string): string | undefined {
  const lowered = originalRequest.toLowerCase()

  if (lowered.includes("downloads") || originalRequest.includes("\ub2e4\uc6b4\ub85c\ub4dc")) {
    return join(homedir(), "Downloads")
  }

  if (lowered.includes("desktop") || originalRequest.includes("\ubc14\ud0d5\ud654\uba74")) {
    return join(homedir(), "Desktop")
  }

  if (lowered.includes("documents") || originalRequest.includes("\ubb38\uc11c")) {
    return join(homedir(), "Documents")
  }

  return undefined
}

function normalizeFilesystemPath(value: string | undefined, workDir: string): string | undefined {
  if (!value) return undefined

  let trimmed = value.trim()
  if (!trimmed) return undefined

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1)
  }

  if (!trimmed) return undefined

  const home = homedir()
  if (trimmed.startsWith("~/")) return resolve(join(home, trimmed.slice(2)))
  if (trimmed.startsWith("$HOME/")) return resolve(join(home, trimmed.slice(6)))
  if (trimmed.startsWith("/")) return resolve(trimmed)

  for (const homeRelativePrefix of ["Downloads/", "Desktop/", "Documents/"] as const) {
    if (trimmed.startsWith(homeRelativePrefix)) {
      return resolve(join(home, trimmed))
    }
  }

  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return resolve(workDir, trimmed)
  }

  return undefined
}

function collectFilesystemMutationPaths(toolName: string, params: unknown, workDir: string): string[] {
  if (!params || typeof params !== "object") return []
  const record = params as Record<string, unknown>

  if (toolName === "file_write" || toolName === "file_delete") {
    const path = normalizeFilesystemPath(getString(record.path), workDir)
    return path ? [path] : []
  }

  if (toolName === "file_patch") {
    const patch = getString(record.patch)
    if (!patch) return []

    const paths: string[] = []
    for (const line of patch.split("\n")) {
      for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Delete File: "] as const) {
        if (!line.startsWith(prefix)) continue
        const rawPath = line.slice(prefix.length).trim()
        if (!rawPath) continue
        paths.push(normalizeFilesystemPath(rawPath, workDir) ?? resolve(workDir, rawPath))
      }
    }

    return [...new Set(paths)]
  }

  if (toolName !== "shell_exec") return []

  const command = getString(record.command)
  if (!command) return []

  const tokens = command
    .split("\n")
    .join(" ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)

  const paths = new Set<string>()
  for (const token of tokens) {
    const cleaned = token.replace(/^["'()]+|["'();,&|]+$/g, "")
    const normalized = normalizeFilesystemPath(cleaned, workDir)
    if (normalized) paths.add(normalized)
  }

  return [...paths]
}

function displayHomePath(value: string): string {
  const home = homedir()
  return value.startsWith(home) ? value.replace(home, "~") : value
}

function buildSuccessfulDeliverySummary(deliveries: SuccessfulFileDelivery[]): string {
  if (deliveries.length === 0) return "파일 전달 완료"
  const last = deliveries[deliveries.length - 1]
  if (!last) return "파일 전달 완료"
  return `${last.channel === "telegram" ? "텔레그램" : "채널"} 파일 전달 완료: ${displayHomePath(last.filePath)}`
}

function buildImplicitExecutionSummary(params: {
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
}): string | undefined {
  const uniqueTools = [...new Set(params.successfulTools.map((tool) => tool.toolName).filter(Boolean))]
  if (uniqueTools.length > 0) {
    if (uniqueTools.length === 1) {
      return `${uniqueTools[0]} 실행을 완료했습니다.`
    }
    return `${uniqueTools.slice(0, 3).join(", ")} 실행을 완료했습니다.`
  }

  if (params.sawRealFilesystemMutation) {
    return "실제 파일 또는 폴더 작업을 완료했습니다."
  }

  return undefined
}

function buildDirectArtifactDeliveryRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  successfulTools: SuccessfulToolEvidence[]
  successfulFileDeliveries: SuccessfulFileDelivery[]
}): string {
  const toolLines = params.successfulTools
    .slice(-5)
    .map((tool, index) => `${index + 1}. ${tool.toolName}`)
  const deliveryLines = params.successfulFileDeliveries
    .slice(-3)
    .map((delivery, index) => `${index + 1}. ${delivery.channel}: ${displayHomePath(delivery.filePath)}`)

  return [
    "[Direct Artifact Delivery Recovery]",
    "사용자는 결과물 자체를 보여주거나 보내달라고 요청했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.previousResult.trim() ? `이전 결과: ${params.previousResult.trim()}` : "",
    toolLines.length > 0 ? ["성공한 도구 실행:", ...toolLines].join("\n") : "",
    deliveryLines.length > 0 ? ["이미 전달된 파일:", ...deliveryLines].join("\n") : "",
    "설명, 권한 안내, 수동 해결 방법 제시만으로 완료 처리하지 마세요.",
    "결과물 자체를 실제로 전달하거나, 전달이 불가능하면 다른 실행 경로를 찾아 계속 진행하세요.",
    "도구 목록을 다시 확인하고, 적절한 Yeonjang 도구나 전달 도구를 우선 사용하세요.",
    "사용자가 요청한 결과물 자체가 실제로 전달되기 전에는 완료라고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function hasMeaningfulCompletionEvidence(params: {
  executionProfile: ReturnType<typeof buildResolvedExecutionProfile>
  preview: string
  deliverySatisfied: boolean
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
}): boolean {
  if (params.deliverySatisfied) return true
  if (params.successfulTools.length > 0) return true
  if (params.sawRealFilesystemMutation) return true
  if (!params.preview.trim()) return false
  return allowsTextOnlyCompletion({ executionSemantics: params.executionProfile.executionSemantics })
}

function safeStat(value: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(value)
  } catch {
    return undefined
  }
}

function safeReadSnippet(value: string): string | undefined {
  try {
    const raw = readFileSync(value, "utf-8").replace(/\s+/g, " ").trim()
    if (!raw) return undefined
    return raw.length > 120 ? `${raw.slice(0, 119)}...` : raw
  } catch {
    return undefined
  }
}

function isRealFilesystemMutation(toolName: string, params: unknown): boolean {
  if (toolName === "file_write" || toolName === "file_patch" || toolName === "file_delete") {
    return true
  }

  if (toolName !== "shell_exec" || !params || typeof params !== "object") {
    return false
  }

  const command = getString((params as Record<string, unknown>).command)
  if (!command) return false

  const normalizedCommand = command
    .split("&&").join("\n")
    .split("||").join("\n")
    .split(";").join("\n")
  const segments = normalizedCommand
    .split("\n")
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.some((segment) => {
    if (["mkdir ", "touch ", "cp ", "mv ", "install ", "rm ", "unzip ", "tar "].some((prefix) => segment.includes(prefix))) return true
    if (segment.includes("ln -s")) return true
    if (segment.includes("git clone")) return true
    if (segment.includes("npm install") || segment.includes("pnpm install")) return true
    if (segment.includes("tee") && segment.includes(">")) return true
    if ((segment.includes("cat") || segment.includes("printf") || segment.includes("echo")) && segment.includes(">")) return true
    return false
  })
}

interface FailedCommandTool {
  toolName: string
  output: string
  params?: unknown
}

interface SuccessfulFileDelivery {
  toolName: string
  channel: "telegram"
  filePath: string
  caption?: string
  messageId?: number
}

interface SuccessfulToolEvidence {
  toolName: string
  output: string
}

interface ChunkDeliveryReceipt {
  artifactDeliveries?: SuccessfulFileDelivery[]
}

function isCommandFailureRecoveryTool(toolName: string): boolean {
  return toolName === "shell_exec" || toolName === "app_launch" || toolName === "process_kill"
}

function normalizeCommandFailureKey(toolName: string, output: string): string {
  return `${toolName}:${output.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 240)}`
}

function describeCommandFailureReason(output: string): string {
  if (/(not found|command not found|enoent|is not recognized)/i.test(output)) {
    return "실행 명령을 찾지 못해 다른 명령이나 다른 도구 경로를 찾아야 합니다."
  }
  if (/(permission denied|operation not permitted|eacces|권한)/i.test(output)) {
    return "권한 또는 접근 제한 때문에 같은 방법으로는 실행할 수 없습니다."
  }
  if (/(no such file|cannot find|not a directory|경로|파일을 찾을 수 없음)/i.test(output)) {
    return "대상 경로나 파일 이름이 맞지 않아 다른 경로나 다른 생성 방법을 찾아야 합니다."
  }
  if (/(timeout|timed out|시간 초과)/i.test(output)) {
    return "시간 초과가 발생해 더 짧거나 다른 실행 방법을 찾아야 합니다."
  }
  return "이전 명령이 실패해서 다른 방법을 찾아 다시 시도해야 합니다."
}

function selectCommandFailureRecovery(params: {
  failedTools: FailedCommandTool[]
  commandFailureSeen: boolean
  commandRecoveredWithinSamePass: boolean
  seenKeys: Set<string>
}): { key: string; summary: string; reason: string } | null {
  if (!params.commandFailureSeen || params.commandRecoveredWithinSamePass || params.failedTools.length === 0) {
    return null
  }

  for (let index = params.failedTools.length - 1; index >= 0; index -= 1) {
    const failedTool = params.failedTools[index]
    if (!failedTool) continue
    const key = normalizeCommandFailureKey(failedTool.toolName, failedTool.output)
    if (params.seenKeys.has(key)) continue

    return {
      key,
      summary: `${failedTool.toolName} 실패 후 다른 방법을 자동으로 찾는 중입니다.`,
      reason: describeCommandFailureReason(failedTool.output),
    }
  }

  return null
}

function normalizeExecutionRecoveryKey(toolNames: string[], reason: string): string {
  const normalizedTools = [...new Set(toolNames)].sort().join(",")
  const normalizedReason = reason.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 240)
  return `${normalizedTools}:${normalizedReason}`
}

function selectGenericExecutionRecovery(params: {
  executionRecovery: { summary: string; reason: string; toolNames: string[] }
  seenKeys: Set<string>
}): { key: string; summary: string; reason: string } | null {
  if (params.executionRecovery.toolNames.length === 0) return null
  const key = normalizeExecutionRecoveryKey(params.executionRecovery.toolNames, params.executionRecovery.reason)
  if (params.seenKeys.has(key)) return null
  return {
    key,
    summary: params.executionRecovery.summary,
    reason: params.executionRecovery.reason,
  }
}

function buildCommandFailureRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  failedTools: FailedCommandTool[]
}): string {
  const failedLines = params.failedTools.slice(-3).map((tool, index) => {
    const preview = tool.output.trim().replace(/\s+/g, " ").slice(0, 280)
    return `${index + 1}. ${tool.toolName} 실패: ${preview}`
  })

  return [
    "[Command Failure Recovery]",
    "이전 시도에서 로컬 명령 실행이 실패했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `실패 분석: ${params.reason}`,
    failedLines.length > 0 ? ["실패한 명령 기록:", ...failedLines].join("\n") : "",
    params.previousResult.trim() ? `이전 결과: ${params.previousResult.trim()}` : "",
    "실패 원인을 먼저 확인하고, 같은 실패 명령을 그대로 반복하지 마세요.",
    "경로, 권한, 명령 형식, 대상 프로그램 상태를 점검한 뒤 다른 실행 방법이나 다른 로컬 도구를 선택하세요.",
    "필요하면 shell_exec 대신 파일 도구, 앱 실행 도구, 다른 안전한 로컬 도구를 사용하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function buildExecutionRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  toolNames: string[]
}): string {
  const toolLine = params.toolNames.length > 0
    ? `실패한 도구: ${[...new Set(params.toolNames)].join(", ")}`
    : ""

  return [
    "[Execution Recovery]",
    "이전 시도에서 실행 도구가 실패했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `실패 분석: ${params.reason}`,
    toolLine,
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "도구 목록을 다시 확인하고, 같은 실패 경로를 그대로 반복하지 마세요.",
    "가능한 경우 Yeonjang 도구를 먼저 사용하고, 불가능하면 다른 실행 도구 또는 다른 경로를 선택하세요.",
    "도구의 가능 여부를 다시 확인한 뒤 남은 작업을 이어서 처리하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function buildLlmErrorRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  message: string
}): string {
  return [
    "[LLM Error Recovery]",
    "이전 시도에서 모델 호출 중 오류가 발생했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `오류 분석: ${params.reason}`,
    `원본 오류: ${params.message}`,
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "방금 실패한 접근을 그대로 반복하지 말고, 오류 원인에 맞춰 다른 진행 방법을 찾으세요.",
    "필요하면 더 짧은 응답, 더 단순한 단계 분해, 다른 도구 조합, 다른 실행 경로를 선택하세요.",
    "이미 성공한 작업은 유지하고, 남은 작업만 이어서 처리하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function describeWorkerRuntimeErrorReason(message: string): string {
  if (/(exited with code 1|exit code 1|code 1)/i.test(message)) {
    return "작업 세션 프로세스가 오류 종료되어 같은 경로로는 진행할 수 없습니다."
  }
  if (/(not found|enoent|command not found)/i.test(message)) {
    return "작업 세션 실행 명령을 찾지 못했습니다."
  }
  if (/(permission denied|operation not permitted|eacces|권한)/i.test(message)) {
    return "작업 세션 실행 권한 또는 접근 제한 때문에 실패했습니다."
  }
  if (/(timeout|timed out|시간 초과)/i.test(message)) {
    return "작업 세션 응답이 시간 안에 끝나지 않았습니다."
  }
  return "작업 세션 경로에서 오류가 발생해 다른 경로나 다른 대상 전환이 필요합니다."
}

function buildWorkerRuntimeErrorRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary: string
  reason: string
  message: string
}): string {
  return [
    "[Worker Runtime Error Recovery]",
    "이전 시도에서 외부 작업 세션 실행이 실패했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `복구 요약: ${params.summary}`,
    `오류 분석: ${params.reason}`,
    `원본 오류: ${params.message}`,
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "같은 작업 세션 경로를 그대로 반복하지 말고, 다른 실행 경로, 다른 대상, 또는 기본 추론 경로를 선택하세요.",
    "이미 성공한 작업은 유지하고, 남은 작업만 이어서 처리하세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function buildLlmRecoveryAvoidTargets(
  targetId: string | undefined,
  workerRuntimeKind: string | undefined,
): string[] {
  return [targetId, workerRuntimeKind]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
}

function buildLlmRecoveryKey(params: {
  targetId: string | undefined
  workerRuntimeKind: string | undefined
  providerId: string | undefined
  model: string | undefined
  reason: string
  message: string
}): string {
  const route = params.workerRuntimeKind || params.targetId || params.providerId || params.model || "default"
  const fingerprint = normalizeLlmRecoveryFingerprint(params.reason, params.message)
  return `${route}::${fingerprint}`
}

function buildWorkerRuntimeRecoveryKey(params: {
  targetId: string | undefined
  workerRuntimeKind: string | undefined
  providerId: string | undefined
  model: string | undefined
  reason: string
  message: string
}): string {
  const route = params.workerRuntimeKind || params.targetId || params.providerId || params.model || "default"
  const fingerprint = normalizeLlmRecoveryFingerprint(params.reason, params.message)
  return `worker::${route}::${fingerprint}`
}

function normalizeLlmRecoveryFingerprint(reason: string, message: string): string {
  const combined = `${reason}\n${message}`
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<id>")
    .replace(/\b\d{3,}\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()

  if (/timeout|timed out|etimedout|deadline/i.test(combined)) return "timeout"
  if (/rate limit|too many requests|429/i.test(combined)) return "rate-limit"
  if (/cloudflare|challenge|auth|unauthorized|forbidden|401|403|api key/i.test(combined)) return "auth"
  if (/context|token|too large|max context|maximum context/i.test(combined)) return "context-limit"
  if (/schema|parameter|unsupported|invalid_request|tool|function/i.test(combined)) return "request-schema"
  if (/network|socket|connect|connection|reset|refused|econn|dns|fetch failed/i.test(combined)) return "network"
  return combined.slice(0, 160)
}

function hasMeaningfulRouteChange(params: {
  currentTargetId: string | undefined
  currentModel: string | undefined
  currentProviderId: string | undefined
  currentWorkerRuntimeKind: string | undefined
  nextTargetId: string | undefined
  nextModel: string | undefined
  nextProviderId: string | undefined
  nextWorkerRuntimeKind: string | undefined
}): boolean {
  return (params.currentWorkerRuntimeKind ?? "") !== (params.nextWorkerRuntimeKind ?? "")
    || (params.currentTargetId ?? "") !== (params.nextTargetId ?? "")
    || (params.currentProviderId ?? "") !== (params.nextProviderId ?? "")
    || (params.currentModel ?? "") !== (params.nextModel ?? "")
}

function buildFilesystemMutationFollowupPrompt(params: {
  originalRequest: string
  previousResult: string
}): string {
  return [
    "[Filesystem Execution Required]",
    "원래 사용자 요청은 실제 로컬 파일 또는 폴더 변경이 필요합니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.previousResult.trim() ? `이전 불완전 결과: ${params.previousResult.trim()}` : "",
    "요청한 파일이나 폴더가 로컬 환경에서 실제로 생성되거나 수정되어야만 완료입니다.",
    "이제 사용 가능한 파일 또는 쉘 도구로 실제 로컬 작업을 수행하세요.",
    "수동 안내, 예시 코드만 제시하거나 실제 파일 변경 없이 완료했다고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function buildFilesystemVerificationRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  verificationSummary: string
  verificationReason?: string
  missingItems?: string[]
  mutationPaths?: string[]
}): string {
  const missing = params.missingItems?.filter((item) => item.trim()).map((item) => `- ${item}`) ?? []
  const targets = params.mutationPaths?.filter((item) => item.trim()).map((item) => `- ${displayHomePath(item)}`) ?? []

  return [
    "[Filesystem Verification Recovery]",
    "이전 시도에서 실제 파일 또는 폴더 결과를 자동 검증하지 못했습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    `검증 요약: ${params.verificationSummary}`,
    params.verificationReason?.trim() ? `검증 사유: ${params.verificationReason.trim()}` : "",
    targets.length > 0 ? ["현재 확인 대상 경로:", ...targets].join("\n") : "",
    missing.length > 0 ? ["누락되었거나 다시 확인할 항목:", ...missing].join("\n") : "",
    params.previousResult.trim() ? `현재까지 결과: ${params.previousResult.trim()}` : "",
    "실제 파일 도구나 로컬 명령으로 경로 존재 여부를 직접 확인하세요.",
    "대상이 없으면 다른 방법으로 직접 생성하거나 수정하세요.",
    "이미 생성되었다면 실제 경로를 다시 찾아 검증 근거를 확보하세요.",
    "실제 존재 여부를 다시 확인하기 전에는 완료라고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function buildEmptyResultRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  successfulTools: SuccessfulToolEvidence[]
  sawRealFilesystemMutation: boolean
}): string {
  const successfulToolLines = params.successfulTools
    .slice(-3)
    .map((tool, index) => `${index + 1}. ${tool.toolName}`)

  return [
    "[Empty Result Recovery]",
    "이전 시도는 실행이 끝났지만 완료로 볼 수 있는 명확한 결과가 남지 않았습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.previousResult.trim() ? `현재까지 텍스트 결과: ${params.previousResult.trim()}` : "",
    successfulToolLines.length > 0 ? ["성공한 도구 실행:", ...successfulToolLines].join("\n") : "",
    params.sawRealFilesystemMutation ? "실제 파일 또는 폴더 변경은 감지되었지만 사용자에게 전달할 명확한 결과 정리가 없습니다." : "",
    "이전 시도를 그대로 완료 처리하지 말고, 무엇이 실제로 완료되었는지 확인하세요.",
    "결과가 있다면 그 결과를 명확하게 정리해 전달하세요.",
    "결과가 부족하다면 남은 작업을 이어서 실제로 완료하세요.",
    "아무 일도 하지 않았는데 완료라고 말하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function shouldRetryTruncatedOutput(params: {
  review: NonNullable<Awaited<ReturnType<typeof reviewTaskCompletion>>>
  preview: string
  executionProfile: ReturnType<typeof buildResolvedExecutionProfile>
}): boolean {
  if (params.review.status !== "ask_user") return false
  if (!params.executionProfile.requiresFilesystemMutation) return false

  const combined = [
    params.review.summary,
    params.review.reason,
    params.review.userMessage,
    ...(params.review.remainingItems ?? []),
    params.preview,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")

  return /(중간[^\n]{0,20}(절단|중단)|절단 오류|코드[^\n]{0,20}(절단|중단)|미완성|incomplete|truncat|cut off|unfinished)/iu.test(combined)
}

function buildTruncatedOutputRecoveryPrompt(params: {
  originalRequest: string
  previousResult: string
  summary?: string
  reason?: string
  remainingItems?: string[]
}): string {
  const remaining = params.remainingItems?.filter((item) => item.trim()).map((item) => `- ${item}`) ?? []
  return [
    "[Truncated Output Recovery]",
    "이전 시도에서 코드 또는 결과가 중간에 끊기거나 미완성으로 끝났습니다.",
    `원래 사용자 요청: ${params.originalRequest}`,
    params.summary?.trim() ? `검토 요약: ${params.summary.trim()}` : "",
    params.reason?.trim() ? `검토 사유: ${params.reason.trim()}` : "",
    remaining.length > 0 ? ["남은 항목:", ...remaining].join("\n") : "",
    params.previousResult.trim() ? `이전 불완전 결과:
${params.previousResult.trim()}` : "",
    "지금 작업을 다시 시도하고 완전하게 끝내세요.",
    "파일을 써야 한다면 로컬 파일 또는 쉘 도구를 이용해 최종 파일을 실제로 생성하세요.",
    "부분 코드만 반복하지 말고, 파일 중간에서 끊기지 말고, 닫히지 않은 태그·함수·블록·문장으로 끝내지 마세요.",
    "사용자가 지정한 이름, 폴더명, 경로, 언어를 그대로 유지하고 번역하지 마세요.",
    "최종 답변은 원래 사용자 요청과 같은 언어로 작성하세요.",
  ].filter(Boolean).join("\n\n")
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

async function deliverChunk(
  onChunk: StartRootRunParams["onChunk"],
  chunk: AgentChunk,
  runId: string,
): Promise<ChunkDeliveryReceipt | undefined> {
  if (!onChunk) return undefined
  try {
    return (await onChunk(chunk)) ?? undefined
  } catch (error) {
    log.warn(`runId=${runId} chunk delivery failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function applyChunkDeliveryReceipt(
  runId: string,
  receipt: ChunkDeliveryReceipt | undefined,
  successfulFileDeliveries: SuccessfulFileDelivery[],
): void {
  for (const delivery of receipt?.artifactDeliveries ?? []) {
    const alreadyRecorded = successfulFileDeliveries.some((existing) =>
      existing.channel === delivery.channel
      && existing.filePath === delivery.filePath
      && existing.messageId === delivery.messageId,
    )
    if (alreadyRecorded) continue

    successfulFileDeliveries.push(delivery)
    appendRunEvent(runId, `텔레그램 파일 전달 완료: ${displayHomePath(delivery.filePath)}`)
  }
}

function logAssistantReply(source: StartRootRunParams["source"], text: string): void {
  if (source !== "webui" && source !== "telegram") return
  const normalized = text.trim()
  if (!normalized) return
  process.stdout.write(`${normalized}\n`)
}

function buildWorkerRuntimePrompt(message: string, workDir: string): string {
  const instructions = loadMergedInstructions(workDir)
  const nobieMd = loadNobieMd(workDir)
  return [
    instructions.mergedText ? `[Instruction Chain]\n${instructions.mergedText}` : "",
    nobieMd ? `[프로젝트 메모리]\n${nobieMd}` : "",
    message,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function scheduleDelayedRootRun(params: {
  runAtMs: number
  message: string
  sessionId: string
  requestGroupId?: string
  model: string | undefined
  originalRequest?: string
  executionSemantics?: TaskExecutionSemantics
  structuredRequest?: TaskStructuredRequest
  workDir?: string
  source: StartRootRunParams["source"]
  onChunk: StartRootRunParams["onChunk"]
  immediateCompletionText?: string
  preferredTarget?: string
  taskProfile?: TaskProfile
  toolsEnabled?: boolean
  contextMode?: AgentContextMode
}): void {
  const jobId = crypto.randomUUID()
  log.info("delayed run armed", {
    jobId,
    sessionId: params.sessionId,
    source: params.source,
    runAtMs: params.runAtMs,
    directDelivery: params.immediateCompletionText != null,
    preferredTarget: params.preferredTarget ?? null,
    taskProfile: params.taskProfile ?? null,
    toolsEnabled: params.toolsEnabled ?? true,
    contextMode: params.contextMode ?? "full",
  })

  const fire = () => {
    delayedRunTimers.delete(jobId)
    void enqueueDelayedSessionRun(params.sessionId, jobId, async () => {
      const route = resolveRunRoute({
        preferredTarget: params.preferredTarget,
        taskProfile: params.taskProfile,
        fallbackModel: params.model,
      })
      log.info("delayed run firing", {
        jobId,
        sessionId: params.sessionId,
        targetId: route.targetId ?? null,
        targetLabel: route.targetLabel ?? null,
        model: route.model ?? params.model ?? null,
        providerId: route.providerId ?? null,
        workerRuntime: route.workerRuntime?.kind ?? null,
        toolsEnabled: params.toolsEnabled ?? true,
        contextMode: params.contextMode ?? "full",
      })

      const started = startRootRun({
        message: params.message,
        sessionId: params.sessionId,
        ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
        requestGroupId: params.requestGroupId,
        ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
        ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
        ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
        ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
        model: route.model ?? params.model,
        ...(route.providerId ? { providerId: route.providerId } : {}),
        ...(route.provider ? { provider: route.provider } : {}),
        ...(route.workerRuntime ? { workerRuntime: route.workerRuntime } : {}),
        ...(route.targetId ? { targetId: route.targetId } : {}),
        ...(route.targetLabel ? { targetLabel: route.targetLabel } : {}),
        ...(params.workDir ? { workDir: params.workDir } : {}),
        source: params.source,
        skipIntake: true,
        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
        ...(params.contextMode ? { contextMode: params.contextMode } : {}),
        onChunk: params.onChunk,
      })

      await started.finished
    })
  }

  const arm = () => {
    const remaining = params.runAtMs - Date.now()
    if (remaining <= 0) {
      fire()
      return
    }
    const handle = setTimeout(arm, Math.min(remaining, MAX_DELAY_TIMER_MS))
    delayedRunTimers.set(jobId, handle)
  }

  arm()
}

function enqueueRequestGroupRun(
  requestGroupId: string,
  runId: string,
  task: () => Promise<RootRun | undefined>,
): Promise<RootRun | undefined> {
  const previous = requestGroupExecutionQueues.get(requestGroupId)
  if (previous) {
    log.info("request group run queued behind active group task", { runId, requestGroupId })
  }

  const next = (previous ?? Promise.resolve<RootRun | undefined>(undefined))
    .catch((error) => {
      log.warn(`previous request group queue recovered: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    })
    .then(() => task())
    .catch((error) => {
      log.error("request group queue task failed", {
        runId,
        requestGroupId,
        error: error instanceof Error ? error.message : String(error),
      })
      return getRootRun(runId)
    })
    .finally(() => {
      if (requestGroupExecutionQueues.get(requestGroupId) === next) {
        requestGroupExecutionQueues.delete(requestGroupId)
      }
    })

  requestGroupExecutionQueues.set(requestGroupId, next)
  return next
}

function enqueueDelayedSessionRun(sessionId: string, jobId: string, task: () => Promise<void>): void {
  const previous = delayedSessionQueues.get(sessionId)
  if (previous) {
    log.info("delayed run queued behind active session task", { jobId, sessionId })
  }

  const next = (previous ?? Promise.resolve())
    .catch((error) => {
      log.warn(`previous delayed run queue recovered: ${error instanceof Error ? error.message : String(error)}`)
    })
    .then(task)
    .catch((error) => {
      log.error("delayed run queue task failed", {
        jobId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      if (delayedSessionQueues.get(sessionId) === next) {
        delayedSessionQueues.delete(sessionId)
      }
    })

  delayedSessionQueues.set(sessionId, next)
}
