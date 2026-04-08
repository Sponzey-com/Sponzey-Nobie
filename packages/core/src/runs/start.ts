import type { AgentContextMode } from "../agent/index.js"
import {
  type TaskExecutionSemantics,
  type TaskIntentEnvelope,
  type TaskStructuredRequest,
} from "../agent/intake.js"
import { getConfig } from "../config/index.js"
import type { AIProvider } from "../ai/index.js"
import { detectAvailableProvider } from "../ai/index.js"
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
  enqueueRequestGroupExecution,
  hasRequestGroupExecutionQueue,
} from "./execution-queue.js"
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
  parentRunId?: string | undefined
  originRunId?: string | undefined
  originRequestGroupId?: string | undefined
  forceRequestGroupReuse?: boolean | undefined
  model: string | undefined
  providerId?: string | undefined
  provider?: AIProvider | undefined
  targetId?: string | undefined
  targetLabel?: string | undefined
  workerRuntime?: WorkerRuntimeTarget | undefined
  workDir?: string | undefined
  source: "webui" | "cli" | "telegram" | "slack"
  skipIntake?: boolean | undefined
  toolsEnabled?: boolean | undefined
  contextMode?: AgentContextMode | undefined
  taskProfile?: TaskProfile | undefined
  runScope?: "root" | "child" | "analysis" | undefined
  handoffSummary?: string | undefined
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
  const targetId = params.targetId ?? (params.model ? detectAvailableProvider() : undefined)
  const now = Date.now()
  const workDir = params.workDir ?? process.cwd()
  const finished = (async () => {
    const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns
    const startLaunch = await prepareStartLaunch({
      message: params.message,
      sessionId,
      runId,
      source: params.source,
      controller,
      now,
      maxDelegationTurns,
      ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
      ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
      ...(params.originRunId ? { originRunId: params.originRunId } : {}),
      ...(params.originRequestGroupId ? { originRequestGroupId: params.originRequestGroupId } : {}),
      ...(params.forceRequestGroupReuse ? { forceRequestGroupReuse: params.forceRequestGroupReuse } : {}),
      ...(params.contextMode ? { contextMode: params.contextMode } : {}),
      ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
      ...(params.runScope ? { runScope: params.runScope } : {}),
      ...(params.handoffSummary ? { handoffSummary: params.handoffSummary } : {}),
      ...(targetId ? { targetId } : {}),
      ...(params.targetLabel?.trim() ? { targetLabel: params.targetLabel.trim() } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
      hasRequestGroupExecutionQueue,
    })
    const { startPlan } = startLaunch
    const {
      entrySemantics,
      reconnectTarget,
      reconnectNeedsClarification,
      requestGroupId,
      isRootRequest,
      effectiveTaskProfile,
      effectiveContextMode,
      workerSessionId,
    } = startPlan
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
      logError: (message, payload) => log.error(message, payload),
    })

    return enqueueRequestGroupExecution({
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
  })().catch((error) => {
    log.error("start root run failed", {
      runId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  })

  return {
    runId,
    sessionId,
    status: "started",
    finished,
  }
}
