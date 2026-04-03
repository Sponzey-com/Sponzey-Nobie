import { getConfig } from "../config/index.js"
import { createExecutionChunkStream } from "./execution-runtime.js"
import { applyExecutionChunkPass } from "./execution-chunk-pass.js"
import { applyErrorChunkPass } from "./error-chunk-pass.js"
import {
  deliverTrackedChunk,
  type RunChunkDeliveryHandler,
  type SuccessfulFileDelivery,
  type SuccessfulTextDelivery,
} from "./delivery.js"
import { getRootRun } from "./store.js"
import type { AgentContextMode } from "../agent/index.js"
import type { AIProvider } from "../ai/index.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"
import type { FinalizationSource } from "./finalization.js"
import type { ExecutionRecoveryPayload } from "./execution-postpass.js"
import type { RecoveryRetryApplicationDependencies } from "./retry-application.js"
import type { ExternalRecoveryAttemptDependencies } from "./external-retry-application.js"

export interface ExecutionAttemptPassResult {
  preview: string
  failed: boolean
  executionRecoveryLimitStop: {
    summary: string
    reason: string
    rawMessage?: string
    remainingItems: string[]
  } | null
  aiRecoveryLimitStop: {
    summary: string
    reason: string
    rawMessage?: string
    remainingItems: string[]
  } | null
  aiRecovery: {
    summary: string
    reason: string
    message: string
  } | null
  workerRuntimeRecovery: {
    summary: string
    reason: string
    message: string
  } | null
  executionRecovery: ExecutionRecoveryPayload | null
  sawRealFilesystemMutation: boolean
  commandFailureSeen: boolean
  commandRecoveredWithinSamePass: boolean
}

interface ExecutionAttemptPassDependencies
  extends RecoveryRetryApplicationDependencies,
    ExternalRecoveryAttemptDependencies {
  markAbortedRunCancelledIfActive: (runId: string) => void
}

interface ExecutionAttemptPassModuleDependencies {
  createExecutionChunkStream: typeof createExecutionChunkStream
  applyExecutionChunkPass: typeof applyExecutionChunkPass
  applyErrorChunkPass: typeof applyErrorChunkPass
  deliverTrackedChunk: typeof deliverTrackedChunk
  getRootRun: typeof getRootRun
}

const defaultModuleDependencies: ExecutionAttemptPassModuleDependencies = {
  createExecutionChunkStream,
  applyExecutionChunkPass,
  applyErrorChunkPass,
  deliverTrackedChunk,
  getRootRun,
}

export async function runExecutionAttemptPass(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    onDeliveryError?: (message: string) => void
    currentMessage: string
    memorySearchQuery: string
    model?: string
    providerId?: string
    provider?: AIProvider
    workDir: string
    signal: AbortSignal
    toolsEnabled?: boolean
    isRootRequest: boolean
    requestGroupId: string
    contextMode: AgentContextMode
    preview: string
    activeWorkerRuntime?: WorkerRuntimeTarget
    workerSessionId?: string
    pendingToolParams: Map<string, unknown>
    successfulTools: SuccessfulToolEvidence[]
    filesystemMutationPaths: Set<string>
    failedCommandTools: FailedCommandTool[]
    successfulFileDeliveries: SuccessfulFileDelivery[]
    successfulTextDeliveries: SuccessfulTextDelivery[]
    commandFailureSeen: boolean
    recoveryBudgetUsage: RecoveryBudgetUsage
    executionRecoveryLimitStop: {
      summary: string
      reason: string
      remainingItems: string[]
    } | null
    stopAfterDirectArtifactDeliverySuccess: boolean
    abortExecutionStream: () => void
  },
  dependencies: ExecutionAttemptPassDependencies,
  moduleDependencies: ExecutionAttemptPassModuleDependencies = defaultModuleDependencies,
): Promise<ExecutionAttemptPassResult> {
  let preview = params.preview
  let failed = false
  let aiRecovery: ExecutionAttemptPassResult["aiRecovery"] = null
  let workerRuntimeRecovery: ExecutionAttemptPassResult["workerRuntimeRecovery"] = null
  let executionRecovery: ExecutionAttemptPassResult["executionRecovery"] = null
  let executionRecoveryLimitStop = params.executionRecoveryLimitStop
  let aiRecoveryLimitStop: ExecutionAttemptPassResult["aiRecoveryLimitStop"] = null
  let sawRealFilesystemMutation = false
  let commandFailureSeen = params.commandFailureSeen
  let commandRecoveredWithinSamePass = false
  const executionStreamController = new AbortController()
  const handleOuterAbort = () => {
    if (!executionStreamController.signal.aborted) {
      executionStreamController.abort()
    }
  }

  if (params.signal.aborted) {
    executionStreamController.abort()
  } else {
    params.signal.addEventListener("abort", handleOuterAbort, { once: true })
  }

  if (params.activeWorkerRuntime && params.workerSessionId) {
    dependencies.appendRunEvent(params.runId, `${params.workerSessionId} 실행 시작`)
    dependencies.updateRunSummary(params.runId, `${params.activeWorkerRuntime.label}에서 작업을 실행 중입니다.`)
  }

  const abortExecutionStream = () => {
    if (!executionStreamController.signal.aborted) {
      executionStreamController.abort()
    }
    params.abortExecutionStream()
  }

  try {
    const chunkStream = moduleDependencies.createExecutionChunkStream({
      userMessage: params.currentMessage,
      memorySearchQuery: params.memorySearchQuery,
      sessionId: params.sessionId,
      runId: params.runId,
      ...(params.model ? { model: params.model } : {}),
      ...(params.providerId ? { providerId: params.providerId } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
      workDir: params.workDir,
      source: params.source,
      signal: executionStreamController.signal,
      ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
      isRootRequest: params.isRootRequest,
      requestGroupId: params.requestGroupId,
      contextMode: params.contextMode,
    })

    for await (const chunk of chunkStream) {
      if (chunk.type !== "error" && chunk.type !== "done") {
        const currentRun = moduleDependencies.getRootRun(params.runId)
        const usedTurns = currentRun?.delegationTurnCount ?? 0
        const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns
        const executionChunkPass = moduleDependencies.applyExecutionChunkPass({
          chunk,
          runId: params.runId,
          sessionId: params.sessionId,
          source: params.source,
          preview,
          workDir: params.workDir,
          pendingToolParams: params.pendingToolParams,
          successfulTools: params.successfulTools,
          filesystemMutationPaths: params.filesystemMutationPaths,
          failedCommandTools: params.failedCommandTools,
          commandFailureSeen,
          recoveryBudgetUsage: params.recoveryBudgetUsage,
          usedTurns,
          maxDelegationTurns: maxTurns,
        }, dependencies)

        if (executionChunkPass.preview !== undefined) {
          preview = executionChunkPass.preview
        }
        if (executionChunkPass.executionRecoveryLimitStop) {
          executionRecoveryLimitStop = executionChunkPass.executionRecoveryLimitStop
        }
        if (executionChunkPass.executionRecovery) {
          executionRecovery = executionChunkPass.executionRecovery
        }
        if (executionChunkPass.aiRecoveryLimitStop) {
          aiRecoveryLimitStop = executionChunkPass.aiRecoveryLimitStop
        }
        if (executionChunkPass.aiRecovery) {
          aiRecovery = executionChunkPass.aiRecovery
        }
        if (executionChunkPass.sawRealFilesystemMutation) {
          sawRealFilesystemMutation = true
        }
        if (typeof executionChunkPass.commandFailureSeen === "boolean") {
          commandFailureSeen = executionChunkPass.commandFailureSeen
        }
        if (typeof executionChunkPass.commandRecoveredWithinSamePass === "boolean") {
          commandRecoveredWithinSamePass = executionChunkPass.commandRecoveredWithinSamePass
        }
        if (executionChunkPass.abortExecutionStream) {
          abortExecutionStream()
        }
      } else if (chunk.type === "error") {
        const currentRun = moduleDependencies.getRootRun(params.runId)
        const usedTurns = currentRun?.delegationTurnCount ?? 0
        const maxTurns = currentRun?.maxDelegationTurns ?? getConfig().orchestration.maxDelegationTurns
        const errorChunkPass = await moduleDependencies.applyErrorChunkPass({
          runId: params.runId,
          sessionId: params.sessionId,
          source: params.source,
          onChunk: params.onChunk,
          ...(params.onDeliveryError ? { onDeliveryError: params.onDeliveryError } : {}),
          chunk,
          aborted: params.signal.aborted,
          executionRecoveryLimitStop,
          activeWorkerRuntime: params.activeWorkerRuntime,
          ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
          recoveryBudgetUsage: params.recoveryBudgetUsage,
          usedTurns,
          maxDelegationTurns: maxTurns,
          successfulFileDeliveries: params.successfulFileDeliveries,
          successfulTextDeliveries: params.successfulTextDeliveries,
        }, dependencies)

        if (errorChunkPass.limitStop) {
          aiRecoveryLimitStop = errorChunkPass.limitStop
        }
        if (errorChunkPass.workerRuntimeRecovery) {
          workerRuntimeRecovery = errorChunkPass.workerRuntimeRecovery
        }
        if (errorChunkPass.failed) {
          failed = true
        }
        continue
      }

      const receipt = await moduleDependencies.deliverTrackedChunk({
        onChunk: params.onChunk,
        chunk,
        runId: params.runId,
        ...(params.onDeliveryError ? { onError: params.onDeliveryError } : {}),
        successfulFileDeliveries: params.successfulFileDeliveries,
        successfulTextDeliveries: params.successfulTextDeliveries,
        appendEvent: dependencies.appendRunEvent,
      })

      if (params.stopAfterDirectArtifactDeliverySuccess && (receipt?.artifactDeliveries?.length ?? 0) > 0) {
        abortExecutionStream()
        break
      }
    }
  } finally {
    params.signal.removeEventListener("abort", handleOuterAbort)
  }

  return {
    preview,
    failed,
    executionRecoveryLimitStop,
    aiRecoveryLimitStop,
    aiRecovery,
    workerRuntimeRecovery,
    executionRecovery,
    sawRealFilesystemMutation,
    commandFailureSeen,
    commandRecoveredWithinSamePass,
  }
}
