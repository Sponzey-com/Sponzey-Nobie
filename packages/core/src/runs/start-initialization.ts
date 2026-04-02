import type { FinalizationSource } from "./finalization.js"

interface StartInitializationDependencies {
  rememberRunInstruction: (params: {
    runId: string
    sessionId: string
    requestGroupId: string
    source: FinalizationSource
    message: string
  }) => void
  bindActiveRunController: (runId: string, controller: AbortController) => void
  interruptOrphanWorkerSessionRuns: (params: {
    requestGroupId: string
    workerSessionId: string
    keepRunId: string
    summary?: string
  }) => Array<unknown>
  appendRunEvent: (runId: string, message: string) => void
  updateRunSummary: (runId: string, summary: string) => void
  setRunStepStatus: (
    runId: string,
    stepKey: string,
    status: "running" | "completed" | "cancelled" | "pending" | "failed",
    summary: string,
  ) => void
  updateRunStatus: (
    runId: string,
    status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted",
    summary: string,
    canCancel: boolean,
  ) => void
}

export function applyStartInitialization(
  params: {
    runId: string
    sessionId: string
    requestGroupId: string
    source: FinalizationSource
    message: string
    controller: AbortController
    requestGroupQueueActive: boolean
    targetLabel?: string | undefined
    model?: string | undefined
    reconnectTargetTitle?: string | undefined
    shouldReconnectGroup: boolean
    reconnectCandidateCount: number
    requestedClosedRequestGroup: boolean
    workerSessionId?: string | undefined
    reusableWorkerSessionRun?: boolean | undefined
  },
  dependencies: StartInitializationDependencies,
): {
  queuedBehindRequestGroupRun: boolean
  interruptedWorkerRunCount: number
} {
  dependencies.rememberRunInstruction({
    runId: params.runId,
    sessionId: params.sessionId,
    requestGroupId: params.requestGroupId,
    source: params.source,
    message: params.message,
  })

  dependencies.bindActiveRunController(params.runId, params.controller)

  const interruptedWorkerRunCount = params.workerSessionId
    ? dependencies.interruptOrphanWorkerSessionRuns({
        requestGroupId: params.requestGroupId,
        workerSessionId: params.workerSessionId,
        keepRunId: params.runId,
      }).length
    : 0
  const queuedBehindRequestGroupRun = params.requestGroupQueueActive

  dependencies.setRunStepStatus(params.runId, "received", "completed", "요청을 받았습니다.")
  dependencies.setRunStepStatus(params.runId, "classified", "completed", "일반 채팅 요청으로 분류했습니다.")
  dependencies.setRunStepStatus(
    params.runId,
    "target_selected",
    "completed",
    params.targetLabel?.trim()
      ? `${params.targetLabel.trim()} 대상을 선택했습니다.`
      : params.model?.trim()
        ? `${params.model.trim()} 모델을 선택했습니다.`
        : "기본 실행 대상을 선택했습니다.",
  )

  if (queuedBehindRequestGroupRun) {
    dependencies.setRunStepStatus(params.runId, "executing", "pending", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.")
    dependencies.updateRunStatus(params.runId, "queued", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.", true)
    dependencies.appendRunEvent(params.runId, "같은 요청 그룹의 이전 작업 대기")
  } else {
    dependencies.setRunStepStatus(params.runId, "executing", "running", "응답을 생성 중입니다.")
    dependencies.updateRunStatus(params.runId, "running", "응답을 생성 중입니다.", true)
    dependencies.appendRunEvent(params.runId, "실행 시작")
  }

  if (params.reconnectTargetTitle && params.requestGroupId !== params.runId) {
    dependencies.appendRunEvent(params.runId, `기존 요청 그룹 재연결: ${params.reconnectTargetTitle}`)
    dependencies.updateRunSummary(params.runId, `기존 요청 "${params.reconnectTargetTitle}" 작업 흐름에 이어서 연결합니다.`)
  }
  if (params.shouldReconnectGroup && params.reconnectCandidateCount === 0) {
    dependencies.appendRunEvent(params.runId, "재사용 가능한 기존 태스크 후보가 없어 새 태스크로 시작합니다.")
  }
  if (params.requestedClosedRequestGroup) {
    dependencies.appendRunEvent(params.runId, "완료/실패/취소된 기존 태스크는 재사용하지 않고 새 태스크로 시작합니다.")
  }
  if (params.workerSessionId) {
    if (params.reusableWorkerSessionRun) {
      dependencies.appendRunEvent(params.runId, `기존 작업 세션 재사용: ${params.workerSessionId}`)
    } else {
      dependencies.appendRunEvent(params.runId, `새 작업 세션 생성: ${params.workerSessionId}`)
    }
    dependencies.appendRunEvent(params.runId, `작업 세션 연결: ${params.workerSessionId}`)
    if (interruptedWorkerRunCount > 0) {
      dependencies.appendRunEvent(params.runId, `이전 작업 세션 잔여 실행 ${interruptedWorkerRunCount}건 정리`)
    }
  }

  return {
    queuedBehindRequestGroupRun,
    interruptedWorkerRunCount,
  }
}
