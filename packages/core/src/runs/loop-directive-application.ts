import type { RunChunkDeliveryHandler } from "./delivery.js"
import {
  completeRunWithAssistantMessage,
  markRunCompleted,
  type FinalizationDependencies,
  type FinalizationSource,
} from "./finalization.js"
import { applyTerminalApplication } from "./terminal-application.js"
import type { LoopDirective } from "./loop-directive.js"

interface LoopDirectiveApplicationModuleDependencies {
  completeRunWithAssistantMessage: typeof completeRunWithAssistantMessage
  markRunCompleted: typeof markRunCompleted
  applyTerminalApplication: typeof applyTerminalApplication
}

const defaultModuleDependencies: LoopDirectiveApplicationModuleDependencies = {
  completeRunWithAssistantMessage,
  markRunCompleted,
  applyTerminalApplication,
}

export async function applyLoopDirective(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    directive: LoopDirective
    finalizationDependencies: FinalizationDependencies
  },
  moduleDependencies: LoopDirectiveApplicationModuleDependencies = defaultModuleDependencies,
): Promise<"break"> {
  if (params.directive.eventLabel) {
    params.finalizationDependencies.appendRunEvent(params.runId, params.directive.eventLabel)
  }

  if (params.directive.kind === "complete") {
    await moduleDependencies.completeRunWithAssistantMessage({
      runId: params.runId,
      sessionId: params.sessionId,
      text: params.directive.text,
      source: params.source,
      onChunk: params.onChunk,
      dependencies: params.finalizationDependencies,
    })
    return "break"
  }

  if (params.directive.kind === "complete_silent") {
    moduleDependencies.markRunCompleted({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      text: "",
      summary: params.directive.summary,
      reviewingSummary: params.directive.summary,
      completedSummary: params.directive.summary,
      dependencies: params.finalizationDependencies,
    })
    return "break"
  }

  if (params.directive.kind === "retry_intake") {
    throw new Error("retry_intake directive must be handled inside the main loop before applyLoopDirective")
  }

  await moduleDependencies.applyTerminalApplication({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    onChunk: params.onChunk,
    application: {
      kind: "awaiting_user",
      preview: params.directive.preview,
      summary: params.directive.summary,
      ...(params.directive.reason ? { reason: params.directive.reason } : {}),
      ...(params.directive.userMessage ? { userMessage: params.directive.userMessage } : {}),
      ...(params.directive.remainingItems ? { remainingItems: params.directive.remainingItems } : {}),
    },
    dependencies: params.finalizationDependencies,
  })
  return "break"
}
