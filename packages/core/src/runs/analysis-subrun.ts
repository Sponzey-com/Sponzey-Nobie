import crypto from "node:crypto"
import { buildFilesystemVerificationPrompt, verifyFilesystemTargets } from "./filesystem-verification.js"
import type { RunContextMode, RunScope, RunStatus, RunStepStatus, TaskProfile } from "./types.js"

export interface AnalysisOnlySubrunResult {
  ok: boolean
  summary: string
  reason?: string
  remainingItems?: string[]
}

export interface AnalysisOnlySubrunDependencies {
  createRun: (params: {
    id: string
    sessionId: string
    requestGroupId: string
    lineageRootRunId?: string
    parentRunId?: string
    runScope?: RunScope
    handoffSummary?: string
    prompt: string
    source: "webui" | "cli" | "telegram" | "slack"
    taskProfile: TaskProfile
    targetLabel?: string
    contextMode: RunContextMode
    maxDelegationTurns: number
  }) => void
  appendRunEvent: (runId: string, label: string) => void
  setRunStepStatus: (runId: string, stepKey: string, status: RunStepStatus, summary: string) => unknown
  updateRunStatus: (runId: string, status: RunStatus, summary: string, canCancel: boolean) => unknown
  verifyFilesystemTargets: typeof verifyFilesystemTargets
  buildFilesystemVerificationPrompt: typeof buildFilesystemVerificationPrompt
  createId: () => string
}

const defaultDependencies: AnalysisOnlySubrunDependencies = {
  createRun: () => {},
  appendRunEvent: () => {},
  setRunStepStatus: () => {},
  updateRunStatus: () => {},
  verifyFilesystemTargets,
  buildFilesystemVerificationPrompt,
  createId: () => crypto.randomUUID(),
}

export function finalizeAnalysisOnlySubrun(
  runId: string,
  params: {
    executionSummary: string
    relaySummary: string
    eventLabel?: string
  },
  dependencies: Pick<
    AnalysisOnlySubrunDependencies,
    "appendRunEvent" | "setRunStepStatus" | "updateRunStatus"
  >,
): void {
  dependencies.setRunStepStatus(runId, "executing", "completed", params.executionSummary)
  dependencies.setRunStepStatus(runId, "reviewing", "completed", params.relaySummary)
  dependencies.setRunStepStatus(runId, "finalizing", "completed", "보조 분석 결과를 상위 태스크에 넘겼습니다.")
  dependencies.updateRunStatus(runId, "interrupted", params.relaySummary, false)
  if (params.eventLabel) dependencies.appendRunEvent(runId, params.eventLabel)
}

export async function runFilesystemVerificationSubtask(params: {
  parentRunId: string
  requestGroupId: string
  sessionId: string
  source: "webui" | "cli" | "telegram" | "slack"
  originalRequest: string
  mutationPaths: string[]
  workDir: string
  dependencies?: Partial<AnalysisOnlySubrunDependencies>
}): Promise<AnalysisOnlySubrunResult> {
  const dependencies = { ...defaultDependencies, ...params.dependencies }
  const runId = dependencies.createId()
  const prompt = dependencies.buildFilesystemVerificationPrompt(params.originalRequest, params.mutationPaths)
  dependencies.createRun({
    id: runId,
    sessionId: params.sessionId,
    requestGroupId: params.requestGroupId,
    lineageRootRunId: params.requestGroupId,
    parentRunId: params.parentRunId,
    runScope: "analysis",
    handoffSummary: "결과 검증 하위 작업",
    prompt,
    source: params.source,
    taskProfile: "review",
    targetLabel: "결과 검증",
    contextMode: "handoff",
    maxDelegationTurns: 0,
  })

  dependencies.appendRunEvent(params.parentRunId, "결과 검증 하위 작업을 생성했습니다.")
  dependencies.setRunStepStatus(runId, "received", "completed", "결과 검증 하위 작업을 생성했습니다.")
  dependencies.setRunStepStatus(runId, "classified", "completed", "파일 생성 결과 검증 요청으로 분류했습니다.")
  dependencies.setRunStepStatus(runId, "target_selected", "completed", "로컬 파일 검증 대상을 선택했습니다.")
  dependencies.setRunStepStatus(runId, "executing", "running", "생성 결과를 확인 중입니다.")
  dependencies.updateRunStatus(runId, "running", "생성 결과를 확인 중입니다.", true)
  dependencies.appendRunEvent(runId, "결과 검증 시작")

  const verification = dependencies.verifyFilesystemTargets({
    originalRequest: params.originalRequest,
    mutationPaths: params.mutationPaths,
    workDir: params.workDir,
  })

  finalizeAnalysisOnlySubrun(
    runId,
    {
      executionSummary: verification.summary,
      relaySummary: "검증 분석 결과를 상위 태스크에 전달했습니다.",
      eventLabel: "검증 분석 종료",
    },
    dependencies,
  )

  dependencies.appendRunEvent(
    params.parentRunId,
    verification.ok
      ? "결과 검증 하위 작업이 성공 분석 결과를 전달했습니다."
      : "결과 검증 하위 작업이 실패 분석 결과를 전달했습니다.",
  )

  if (verification.ok) {
    return { ok: true, summary: verification.summary }
  }

  return {
    ok: false,
    summary: verification.summary,
    ...(verification.reason ? { reason: verification.reason } : {}),
    ...(verification.remainingItems ? { remainingItems: verification.remainingItems } : {}),
  }
}
