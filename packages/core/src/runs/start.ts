import type { AgentContextMode } from "../agent/index.js"
import {
  type TaskExecutionSemantics,
  type TaskIntentEnvelope,
  type TaskStructuredRequest,
} from "../agent/intake.js"
import { getConfig } from "../config/index.js"
import type { LLMProvider } from "../llm/index.js"
import { inferProviderId } from "../llm/index.js"
import { createLogger } from "../logger/index.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import {
  executeRootRunDriver,
} from "./root-run-driver.js"
import {
  prepareStartLaunch,
} from "./start-launch.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import {
  getRootRun,
} from "./store.js"
import {
  enqueueRequestGroupRun,
  hasRequestGroupQueue,
} from "./run-queueing.js"
import {
  buildStartRootRunDriverDependencies,
} from "./start-driver-dependencies.js"

const log = createLogger("runs:start")
const syntheticApprovalScopes = new Set<string>()

export interface StartRootRunParams {
  runId?: string | undefined
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
  intentEnvelope?: TaskIntentEnvelope | undefined
  immediateCompletionText?: string | undefined
  onChunk?: RunChunkDeliveryHandler
}

export interface StartedRootRun {
  runId: string
  sessionId: string
  status: "started"
  finished: Promise<RootRun | undefined>
}

export function startRootRun(params: StartRootRunParams): StartedRootRun {
  const sessionId = params.sessionId ?? crypto.randomUUID()
  const runId = params.runId ?? crypto.randomUUID()
  const controller = new AbortController()
  const targetId = params.targetId ?? (params.model ? inferProviderId(params.model) : undefined)
  const now = Date.now()
  const workDir = params.workDir ?? process.cwd()
  const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns
  const startLaunch = prepareStartLaunch({
    message: params.message,
    sessionId,
    runId,
    source: params.source,
    controller,
    now,
    maxDelegationTurns,
    ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    ...(params.forceRequestGroupReuse ? { forceRequestGroupReuse: params.forceRequestGroupReuse } : {}),
    ...(params.contextMode ? { contextMode: params.contextMode } : {}),
    ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
    ...(targetId ? { targetId } : {}),
    ...(params.targetLabel?.trim() ? { targetLabel: params.targetLabel.trim() } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
    hasRequestGroupQueue,
  })
  const { startPlan } = startLaunch
  const {
    entrySemantics,
    requestedClosedRequestGroup,
    shouldReconnectGroup,
    reconnectSelection,
    reconnectTarget,
    reconnectCandidateCount,
    reconnectNeedsClarification,
    requestGroupId,
    isRootRequest,
    effectiveTaskProfile,
    initialDelegationTurnCount,
    effectiveContextMode,
    workerSessionId,
    reusableWorkerSessionRun,
  } = startPlan
  const run = startLaunch.run
  const queuedBehindRequestGroupRun = startLaunch.queuedBehindRequestGroupRun
  const { syntheticApprovalRuntimeDependencies, driverDependencies } = buildStartRootRunDriverDependencies({
    runId,
    sessionId,
    requestGroupId,
    source: params.source,
    onChunk: params.onChunk,
    message: params.message,
    model: params.model,
    workDir,
    reuseConversationContext: entrySemantics.reuse_conversation_context,
    activeQueueCancellationMode: entrySemantics.active_queue_cancellation_mode,
    startNestedRootRun: startRootRun,
    syntheticApprovalScopes,
    logInfo: (message, payload) => log.info(message, payload),
    logWarn: (message) => log.warn(message),
  })

  const finished = enqueueRequestGroupRun({
    requestGroupId,
    runId,
    task: async () => {
      await executeRootRunDriver({
        runId,
        sessionId,
        requestGroupId,
        source: params.source,
        onChunk: params.onChunk,
        controller,
        message: params.message,
        ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
        ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
        ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
        ...(params.intentEnvelope ? { intentEnvelope: params.intentEnvelope } : {}),
        currentModel: params.model,
        currentProviderId: params.providerId,
        currentProvider: params.provider,
        currentTargetId: params.targetId,
        currentTargetLabel: params.targetLabel,
        workDir,
        ...(params.skipIntake ? { skipIntake: params.skipIntake } : {}),
        ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
        reconnectNeedsClarification,
        ...(reconnectTarget ? { reconnectTargetTitle: reconnectTarget.title } : {}),
        ...(reconnectSelection ? { reconnectSelection } : {}),
        queuedBehindRequestGroupRun,
        activeWorkerRuntime: params.workerRuntime,
        ...(workerSessionId ? { workerSessionId } : {}),
        ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
        isRootRequest,
        contextMode: effectiveContextMode,
        taskProfile: effectiveTaskProfile,
        syntheticApprovalRuntimeDependencies,
        defaultMaxDelegationTurns: getConfig().orchestration.maxDelegationTurns,
      }, driverDependencies)

      return getRootRun(runId)
    },
  }, {
    getRootRun,
    logInfo: (message, payload) => log.info(message, payload),
    logWarn: (message) => log.warn(message),
    logError: (message, payload) => log.error(message, payload),
  })

  return {
    runId: run.id,
    sessionId,
    status: "started",
    finished,
  }
}
