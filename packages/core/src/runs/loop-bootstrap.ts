import type { LoopDirective } from "./loop-directive.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

interface LoopBootstrapDependencies {
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
  logInfo: (message: string, payload: Record<string, unknown>) => void
}

export function buildReconnectClarificationDirective(params: {
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

export function bootstrapLoopState(
  params: {
    runId: string
    sessionId: string
    skipIntake?: boolean | undefined
    immediateCompletionText?: string | undefined
    reconnectNeedsClarification: boolean
    reconnectTarget?: { title: string } | undefined
    reconnectSelection?: { candidates?: Array<{ title: string }> } | undefined
    queuedBehindRequestGroupRun: boolean
    aborted: boolean
    activeWorkerRuntime?: WorkerRuntimeTarget | undefined
    requiresFilesystemMutation: boolean
    requiresPrivilegedToolExecution: boolean
  },
  dependencies: LoopBootstrapDependencies,
): {
  intakeProcessed: boolean
  pendingLoopDirective: LoopDirective | null
  activeWorkerRuntime?: WorkerRuntimeTarget | undefined
} {
  const intakeProcessed = params.skipIntake || params.reconnectNeedsClarification
  const pendingLoopDirective: LoopDirective | null = params.immediateCompletionText?.trim()
    ? {
        kind: "complete",
        text: params.immediateCompletionText.trim(),
        eventLabel: "예약 직접 전달 실행",
      }
    : params.reconnectNeedsClarification
      ? buildReconnectClarificationDirective({
          ...(params.reconnectTarget ? { reconnectTarget: { title: params.reconnectTarget.title } } : {}),
          ...(params.reconnectSelection ? { reconnectSelection: params.reconnectSelection } : {}),
        })
      : null

  if (params.queuedBehindRequestGroupRun && !params.aborted) {
    dependencies.setRunStepStatus(params.runId, "executing", "running", "응답을 생성 중입니다.")
    dependencies.updateRunStatus(params.runId, "running", "응답을 생성 중입니다.", true)
    dependencies.appendRunEvent(params.runId, "대기 종료 후 실행 시작")
  }

  let activeWorkerRuntime = params.activeWorkerRuntime
  if (activeWorkerRuntime && (params.requiresFilesystemMutation || params.requiresPrivilegedToolExecution)) {
    dependencies.appendRunEvent(params.runId, `${activeWorkerRuntime.label} 대신 실제 도구 실행 경로로 전환합니다.`)
    dependencies.updateRunSummary(
      params.runId,
      params.requiresFilesystemMutation
        ? "실제 파일/폴더 작업을 위해 로컬 도구 실행으로 전환합니다."
        : "시스템 권한 또는 장치 제어 작업을 위해 실제 도구 실행으로 전환합니다.",
    )
    dependencies.logInfo("worker runtime bypassed for filesystem mutation request", {
      runId: params.runId,
      sessionId: params.sessionId,
      workerRuntime: activeWorkerRuntime.kind,
    })
    activeWorkerRuntime = undefined
  }

  return {
    intakeProcessed,
    pendingLoopDirective,
    activeWorkerRuntime,
  }
}
