import type { SyntheticApprovalRequest, SyntheticApprovalRuntimeDependencies } from "./approval.js"
import { requestSyntheticApproval } from "./approval.js"
import {
  decideSyntheticApprovalContinuation,
  type SyntheticApprovalContinuation,
} from "./approval-application.js"

export async function runSyntheticApprovalPass(params: {
  request: SyntheticApprovalRequest
  runId: string
  sessionId: string
  signal: AbortSignal
  alreadyApproved: boolean
  sourceLabel: string
  originalRequest: string
  latestAssistantMessage: string
  runtimeDependencies: SyntheticApprovalRuntimeDependencies
}): Promise<SyntheticApprovalContinuation> {
  if (params.alreadyApproved) {
    return decideSyntheticApprovalContinuation({
      request: params.request,
      alreadyApproved: true,
    })
  }

  const decision = await requestSyntheticApproval({
    runId: params.runId,
    sessionId: params.sessionId,
    toolName: params.request.toolName,
    summary: params.request.summary,
    ...(params.request.guidance ? { guidance: params.request.guidance } : {}),
    params: {
      source: params.sourceLabel,
      originalRequest: params.originalRequest,
      latestAssistantMessage: params.latestAssistantMessage,
    },
    signal: params.signal,
  }, params.runtimeDependencies)

  if (params.signal.aborted) {
    return { kind: "stop" }
  }

  return decideSyntheticApprovalContinuation({
    request: params.request,
    decision,
    alreadyApproved: false,
  })
}
