import type { AgentContextMode } from "../agent/index.js"
import type {
  TaskExecutionSemantics,
  TaskIntentEnvelope,
  TaskStructuredRequest,
} from "../agent/intake.js"
import type { AIProvider } from "../ai/index.js"
import { resolveRunRoute } from "./routing.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

const MAX_DELAY_TIMER_MS = 2_147_483_647
const delayedRunTimers = new Map<string, NodeJS.Timeout>()
const delayedSessionQueues = new Map<string, Promise<void>>()

interface QueueLoggingDependencies {
  logInfo: (message: string, payload?: Record<string, unknown>) => void
  logWarn: (message: string) => void
  logError: (message: string, payload?: Record<string, unknown>) => void
}

interface DelayedRunDependencies extends QueueLoggingDependencies {
  startRootRun: (params: {
    message: string
    sessionId: string
    requestGroupId?: string | undefined
    originRunId?: string | undefined
    originRequestGroupId?: string | undefined
    model: string | undefined
    providerId?: string | undefined
    provider?: AIProvider | undefined
    targetId?: string | undefined
    targetLabel?: string | undefined
    workerRuntime?: WorkerRuntimeTarget | undefined
    workDir?: string | undefined
    source: "webui" | "cli" | "telegram" | "slack"
    skipIntake: true
    toolsEnabled?: boolean | undefined
    contextMode?: AgentContextMode | undefined
    taskProfile?: TaskProfile | undefined
    originalRequest?: string | undefined
    executionSemantics?: TaskExecutionSemantics | undefined
    structuredRequest?: TaskStructuredRequest | undefined
    intentEnvelope?: TaskIntentEnvelope | undefined
    immediateCompletionText?: string | undefined
    onChunk?: RunChunkDeliveryHandler
  }) => { finished: Promise<RootRun | undefined> }
  now?: () => number
  resolveRoute?: typeof resolveRunRoute
  setTimer?: typeof setTimeout
}

function enqueueDelayedSessionRun(
  params: {
    sessionId: string
    jobId: string
    task: () => Promise<void>
  },
  dependencies: QueueLoggingDependencies,
): void {
  const previous = delayedSessionQueues.get(params.sessionId)
  if (previous) {
    dependencies.logInfo("delayed run queued behind active session task", {
      jobId: params.jobId,
      sessionId: params.sessionId,
    })
  }

  const next = (previous ?? Promise.resolve())
    .catch((error) => {
      dependencies.logWarn(
        `previous delayed run queue recovered: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    .then(params.task)
    .catch((error) => {
      dependencies.logError("delayed run queue task failed", {
        jobId: params.jobId,
        sessionId: params.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      if (delayedSessionQueues.get(params.sessionId) === next) {
        delayedSessionQueues.delete(params.sessionId)
      }
    })

  delayedSessionQueues.set(params.sessionId, next)
}

export function scheduleDelayedRootRun(
  params: {
    runAtMs: number
    message: string
    sessionId: string
    originRunId?: string
    originRequestGroupId?: string
    model: string | undefined
    originalRequest?: string
    executionSemantics?: TaskExecutionSemantics
    structuredRequest?: TaskStructuredRequest
    intentEnvelope?: TaskIntentEnvelope
    workDir?: string
    source: "webui" | "cli" | "telegram" | "slack"
    onChunk: RunChunkDeliveryHandler | undefined
    immediateCompletionText?: string
    preferredTarget?: string
    taskProfile?: TaskProfile
    toolsEnabled?: boolean
    contextMode?: AgentContextMode
  },
  dependencies: DelayedRunDependencies,
): void {
  const jobId = crypto.randomUUID()
  const now = dependencies.now ?? Date.now
  const resolveRouteImpl = dependencies.resolveRoute ?? resolveRunRoute
  const setTimer = dependencies.setTimer ?? setTimeout

  dependencies.logInfo("delayed run armed", {
    jobId,
    sessionId: params.sessionId,
    originRunId: params.originRunId ?? null,
    source: params.source,
    runAtMs: params.runAtMs,
    originRequestGroupId: params.originRequestGroupId ?? null,
    directDelivery: params.immediateCompletionText != null,
    preferredTarget: params.preferredTarget ?? null,
    taskProfile: params.taskProfile ?? null,
    toolsEnabled: params.toolsEnabled ?? true,
    contextMode: params.contextMode ?? "full",
  })

  const fire = () => {
    delayedRunTimers.delete(jobId)
    enqueueDelayedSessionRun({
      sessionId: params.sessionId,
      jobId,
      task: async () => {
        const route = resolveRouteImpl({
          preferredTarget: params.preferredTarget,
          taskProfile: params.taskProfile,
          fallbackModel: params.model,
        })
        dependencies.logInfo("delayed run firing", {
          jobId,
          sessionId: params.sessionId,
          originRunId: params.originRunId ?? null,
          originRequestGroupId: params.originRequestGroupId ?? null,
          targetId: route.targetId ?? null,
          targetLabel: route.targetLabel ?? null,
          model: route.model ?? params.model ?? null,
          providerId: route.providerId ?? null,
          workerRuntime: route.workerRuntime?.kind ?? null,
          toolsEnabled: params.toolsEnabled ?? true,
          contextMode: params.contextMode ?? "full",
        })

        const started = dependencies.startRootRun({
          message: params.message,
          sessionId: params.sessionId,
          ...(params.originRunId ? { originRunId: params.originRunId } : {}),
          ...(params.originRequestGroupId ? { originRequestGroupId: params.originRequestGroupId } : {}),
          ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
          ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
          ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
          ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
          ...(params.intentEnvelope ? { intentEnvelope: params.intentEnvelope } : {}),
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
      },
    }, dependencies)
  }

  const arm = () => {
    const remaining = params.runAtMs - now()
    if (remaining <= 0) {
      fire()
      return
    }
    const handle = setTimer(arm, Math.min(remaining, MAX_DELAY_TIMER_MS))
    delayedRunTimers.set(jobId, handle)
  }

  arm()
}
