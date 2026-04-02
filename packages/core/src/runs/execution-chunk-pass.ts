import type { AgentChunk } from "../agent/index.js"
import {
  applyToolEndChunk,
  applyToolStartChunk,
  type ToolChunkApplicationDependencies,
} from "./tool-chunk-application.js"
import {
  applyExecutionRecoveryAttempt,
  type ExecutionRecoveryAttemptDependencies,
  type ExecutionRecoveryAttemptResult,
  type ExecutionRecoveryPayload,
} from "./execution-retry-application.js"
import {
  applyExternalRecoveryAttempt,
  type ExternalRecoveryAttemptDependencies,
  type ExternalRecoveryAttemptResult,
} from "./external-retry-application.js"
import type { FinalizationSource } from "./finalization.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js"

type ChunkPassChunk = Exclude<AgentChunk, { type: "error" } | { type: "done" }>

export interface ExecutionChunkPassResult {
  handled: boolean
  preview?: string
  executionRecovery?: ExecutionRecoveryPayload
  executionRecoveryLimitStop?: {
    summary: string
    reason: string
    remainingItems: string[]
  }
  llmRecovery?: {
    summary: string
    reason: string
    message: string
  }
  llmRecoveryLimitStop?: {
    summary: string
    reason: string
    remainingItems: string[]
  }
  sawRealFilesystemMutation?: boolean
  commandFailureSeen?: boolean
  commandRecoveredWithinSamePass?: boolean
  abortExecutionStream?: boolean
}

type ExecutionChunkPassDependencies =
  & ToolChunkApplicationDependencies
  & ExecutionRecoveryAttemptDependencies
  & ExternalRecoveryAttemptDependencies

interface ExecutionChunkPassModuleDependencies {
  applyToolStartChunk: typeof applyToolStartChunk
  applyToolEndChunk: typeof applyToolEndChunk
  applyExecutionRecoveryAttempt: typeof applyExecutionRecoveryAttempt
  applyExternalRecoveryAttempt: typeof applyExternalRecoveryAttempt
}

const defaultModuleDependencies: ExecutionChunkPassModuleDependencies = {
  applyToolStartChunk,
  applyToolEndChunk,
  applyExecutionRecoveryAttempt,
  applyExternalRecoveryAttempt,
}

export function applyExecutionChunkPass(
  params: {
    chunk: ChunkPassChunk
    runId: string
    sessionId: string
    source: FinalizationSource
    preview: string
    workDir: string
    pendingToolParams: Map<string, unknown>
    successfulTools: SuccessfulToolEvidence[]
    filesystemMutationPaths: Set<string>
    failedCommandTools: FailedCommandTool[]
    commandFailureSeen: boolean
    recoveryBudgetUsage: RecoveryBudgetUsage
    usedTurns: number
    maxDelegationTurns: number
  },
  dependencies: ExecutionChunkPassDependencies,
  moduleDependencies: ExecutionChunkPassModuleDependencies = defaultModuleDependencies,
): ExecutionChunkPassResult {
  if (params.chunk.type === "text") {
    const preview = `${params.preview}${params.chunk.delta}`.trim()
    if (preview) {
      dependencies.updateRunSummary(params.runId, preview.slice(-500))
    }
    return {
      handled: true,
      preview,
    }
  }

  if (params.chunk.type === "execution_recovery") {
    const executionRecoveryAttempt: ExecutionRecoveryAttemptResult = moduleDependencies.applyExecutionRecoveryAttempt({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      recoveryBudgetUsage: params.recoveryBudgetUsage,
      usedTurns: params.usedTurns,
      maxDelegationTurns: params.maxDelegationTurns,
      payload: params.chunk,
    }, dependencies)

    if (executionRecoveryAttempt.kind === "stop") {
      return {
        handled: true,
        executionRecoveryLimitStop: executionRecoveryAttempt.stop,
        abortExecutionStream: true,
      }
    }

    return {
      handled: true,
      executionRecovery: executionRecoveryAttempt.payload,
    }
  }

  if (params.chunk.type === "tool_start") {
    moduleDependencies.applyToolStartChunk({
      runId: params.runId,
      toolName: params.chunk.toolName,
      toolParams: params.chunk.params,
      pendingToolParams: params.pendingToolParams,
    }, dependencies)
    return { handled: true }
  }

  if (params.chunk.type === "tool_end") {
    const toolReceiptState = moduleDependencies.applyToolEndChunk({
      runId: params.runId,
      toolName: params.chunk.toolName,
      success: params.chunk.success,
      output: params.chunk.output,
      toolDetails: params.chunk.details,
      workDir: params.workDir,
      pendingToolParams: params.pendingToolParams,
      successfulTools: params.successfulTools,
      filesystemMutationPaths: params.filesystemMutationPaths,
      failedCommandTools: params.failedCommandTools,
      commandFailureSeen: params.commandFailureSeen,
    }, dependencies)

    return {
      handled: true,
      ...(toolReceiptState.sawRealFilesystemMutation ? { sawRealFilesystemMutation: true } : {}),
      commandFailureSeen: toolReceiptState.commandFailureSeen,
      commandRecoveredWithinSamePass: toolReceiptState.commandRecoveredWithinSamePass,
    }
  }

  const llmRecoveryAttempt: ExternalRecoveryAttemptResult = moduleDependencies.applyExternalRecoveryAttempt({
    kind: "llm",
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
    usedTurns: params.usedTurns,
    maxDelegationTurns: params.maxDelegationTurns,
    failureTitle: "llm_recovery",
    payload: params.chunk,
    limitRemainingItems: ["모델 호출 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
  }, dependencies)

  if (llmRecoveryAttempt.kind === "stop") {
    return {
      handled: true,
      llmRecoveryLimitStop: llmRecoveryAttempt.stop,
    }
  }

  return {
    handled: true,
    llmRecovery: llmRecoveryAttempt.payload,
  }
}
