import { describe, expect, it, vi } from "vitest"
import { bootstrapLoopState } from "../packages/core/src/runs/loop-bootstrap.ts"

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    logInfo: vi.fn(),
  }
}

describe("bootstrap loop state", () => {
  it("creates immediate completion directive from scheduled text", () => {
    const dependencies = createDependencies()
    const result = bootstrapLoopState({
      runId: "run-1",
      sessionId: "session-1",
      immediateCompletionText: "안녕",
      reconnectNeedsClarification: false,
      queuedBehindRequestGroupRun: false,
      aborted: false,
      requiresFilesystemMutation: false,
      requiresPrivilegedToolExecution: false,
    }, dependencies)

    expect(result.intakeProcessed).toBe(false)
    expect(result.pendingLoopDirective).toEqual({
      kind: "complete",
      text: "안녕",
      eventLabel: "예약 직접 전달 실행",
    })
  })

  it("creates reconnect clarification directive when clarification is needed", () => {
    const dependencies = createDependencies()
    const result = bootstrapLoopState({
      runId: "run-2",
      sessionId: "session-2",
      reconnectNeedsClarification: true,
      reconnectTarget: { title: "달력 작업" },
      reconnectSelection: {
        candidates: [{ title: "달력 작업" }, { title: "계산기 작업" }],
      },
      queuedBehindRequestGroupRun: false,
      aborted: false,
      requiresFilesystemMutation: false,
      requiresPrivilegedToolExecution: false,
    }, dependencies)

    expect(result.intakeProcessed).toBe(true)
    expect(result.pendingLoopDirective).toMatchObject({
      kind: "awaiting_user",
      summary: "수정할 기존 작업 후보가 여러 개라서 확인이 필요합니다.",
      eventLabel: "기존 작업 수정 대상 확인 필요",
    })
  })

  it("marks dequeued runs running and bypasses worker runtime when filesystem work is required", () => {
    const dependencies = createDependencies()
    const result = bootstrapLoopState({
      runId: "run-3",
      sessionId: "session-3",
      reconnectNeedsClarification: false,
      queuedBehindRequestGroupRun: true,
      aborted: false,
      activeWorkerRuntime: {
        kind: "codex_cli",
        targetId: "worker:codex_cli",
        label: "코드 작업 보조 세션",
        command: "codex",
      },
      requiresFilesystemMutation: true,
      requiresPrivilegedToolExecution: false,
    }, dependencies)

    expect(dependencies.setRunStepStatus).toHaveBeenCalledWith("run-3", "executing", "running", "응답을 생성 중입니다.")
    expect(dependencies.updateRunStatus).toHaveBeenCalledWith("run-3", "running", "응답을 생성 중입니다.", true)
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-3", "대기 종료 후 실행 시작")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-3", "코드 작업 보조 세션 대신 실제 도구 실행 경로로 전환합니다.")
    expect(dependencies.updateRunSummary).toHaveBeenCalledWith("run-3", "실제 파일/폴더 작업을 위해 로컬 도구 실행으로 전환합니다.")
    expect(result.activeWorkerRuntime).toBeUndefined()
  })
})
