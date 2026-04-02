import type { ApprovalDecision, ApprovalResolutionReason } from "../events/index.js"
import type { SuccessfulFileDelivery } from "./delivery.js"
import type { SuccessfulToolEvidence } from "./recovery.js"

export interface SyntheticApprovalRequest {
  toolName: string
  summary: string
  guidance?: string
  continuationPrompt: string
}

export interface SyntheticApprovalRuntimeRequest {
  runId: string
  sessionId: string
  toolName: string
  summary: string
  guidance?: string
  params: Record<string, unknown>
  signal: AbortSignal
}

export interface SyntheticApprovalRuntimeDependencies {
  timeoutSec: number
  fallback: Extract<ApprovalDecision, "allow_once" | "deny">
  appendRunEvent: (runId: string, label: string) => void
  setRunStepStatus: (
    runId: string,
    stepKey: string,
    status: "running" | "completed" | "cancelled",
    summary: string,
  ) => void
  updateRunStatus: (
    runId: string,
    status: "awaiting_approval" | "running",
    summary: string,
    canCancel: boolean,
  ) => void
  cancelRun: (
    runId: string,
    denial: { eventLabel: string; stepSummary: string; runSummary: string },
  ) => void
  emitApprovalResolved: (payload: {
    runId: string
    decision: ApprovalDecision
    toolName: string
    reason?: ApprovalResolutionReason
  }) => void
  emitApprovalRequest: (payload: {
    runId: string
    toolName: string
    params: unknown
    kind?: "approval" | "screen_confirmation"
    guidance?: string
    resolve: (decision: ApprovalDecision, reason?: ApprovalResolutionReason) => void
  }) => void
  onRequested?: (payload: { runId: string; sessionId: string; toolName: string }) => void
}

export function detectSyntheticApprovalRequest(params: {
  executionProfile: {
    approvalRequired: boolean
    approvalTool: string
  }
  originalRequest: string
  preview: string
  review: {
    status?: string
    summary?: string
    userMessage?: string
  } | null
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

export function describeSyntheticApprovalDenial(
  toolName: string,
  reason: "user" | "timeout" | "system" | "abort",
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

export async function requestSyntheticApproval(
  params: SyntheticApprovalRuntimeRequest,
  dependencies: SyntheticApprovalRuntimeDependencies,
): Promise<ApprovalDecision> {
  dependencies.appendRunEvent(params.runId, `${params.toolName} 승인 요청`)
  dependencies.setRunStepStatus(params.runId, "reviewing", "completed", params.summary)
  dependencies.setRunStepStatus(params.runId, "awaiting_approval", "running", params.summary)
  dependencies.updateRunStatus(params.runId, "awaiting_approval", params.summary, true)
  dependencies.onRequested?.({
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
      dependencies.setRunStepStatus(params.runId, "awaiting_approval", "cancelled", denial.stepSummary)
      if (dependencies.fallback === "deny") {
        dependencies.cancelRun(params.runId, denial)
      } else {
        dependencies.setRunStepStatus(params.runId, "executing", "running", `${params.toolName} 실행을 계속합니다.`)
        dependencies.updateRunStatus(params.runId, "running", `${params.toolName} 실행을 계속합니다.`, true)
      }
      dependencies.emitApprovalResolved({
        runId: params.runId,
        decision: dependencies.fallback,
        toolName: params.toolName,
        reason: "timeout",
      })
      resolve(dependencies.fallback)
    }, Math.max(5, dependencies.timeoutSec) * 1000)

    params.signal.addEventListener("abort", () => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      resolve("deny")
    }, { once: true })

    dependencies.emitApprovalRequest({
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
          dependencies.setRunStepStatus(params.runId, "awaiting_approval", "cancelled", denial.stepSummary)
          dependencies.cancelRun(params.runId, denial)
        } else {
          dependencies.setRunStepStatus(
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
