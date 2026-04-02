import { describe, expect, it, vi } from "vitest"
import { applyStartInitialization } from "../packages/core/src/runs/start-initialization.ts"

function createDependencies(interruptedWorkerRunCount = 0) {
  return {
    rememberRunInstruction: vi.fn(),
    bindActiveRunController: vi.fn(),
    interruptOrphanWorkerSessionRuns: vi.fn(() => Array.from({ length: interruptedWorkerRunCount }, () => ({}))),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
  }
}

describe("apply start initialization", () => {
  it("sets queued status when request group queue is active", () => {
    const dependencies = createDependencies()
    const controller = new AbortController()

    const result = applyStartInitialization({
      runId: "run-1",
      sessionId: "session-1",
      requestGroupId: "group-1",
      source: "telegram",
      message: "hello",
      controller,
      requestGroupQueueActive: true,
      model: "gpt-5.4",
      shouldReconnectGroup: false,
      reconnectCandidateCount: 0,
      requestedClosedRequestGroup: false,
    }, dependencies)

    expect(result.queuedBehindRequestGroupRun).toBe(true)
    expect(dependencies.rememberRunInstruction).toHaveBeenCalled()
    expect(dependencies.bindActiveRunController).toHaveBeenCalledWith("run-1", controller)
    expect(dependencies.setRunStepStatus).toHaveBeenCalledWith("run-1", "executing", "pending", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.")
    expect(dependencies.updateRunStatus).toHaveBeenCalledWith("run-1", "queued", "같은 요청의 이전 작업이 끝나길 기다리는 중입니다.", true)
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "같은 요청 그룹의 이전 작업 대기")
  })

  it("records reconnect and closed-group events", () => {
    const dependencies = createDependencies()

    applyStartInitialization({
      runId: "run-2",
      sessionId: "session-2",
      requestGroupId: "group-prev",
      source: "webui",
      message: "continue",
      controller: new AbortController(),
      requestGroupQueueActive: false,
      targetLabel: "OpenAI",
      reconnectTargetTitle: "기존 달력 작업",
      shouldReconnectGroup: true,
      reconnectCandidateCount: 0,
      requestedClosedRequestGroup: true,
    }, dependencies)

    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-2", "기존 요청 그룹 재연결: 기존 달력 작업")
    expect(dependencies.updateRunSummary).toHaveBeenCalledWith("run-2", '기존 요청 "기존 달력 작업" 작업 흐름에 이어서 연결합니다.')
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-2", "재사용 가능한 기존 태스크 후보가 없어 새 태스크로 시작합니다.")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-2", "완료/실패/취소된 기존 태스크는 재사용하지 않고 새 태스크로 시작합니다.")
  })

  it("records worker session reuse and orphan cleanup events", () => {
    const dependencies = createDependencies(2)

    const result = applyStartInitialization({
      runId: "run-3",
      sessionId: "session-3",
      requestGroupId: "group-3",
      source: "cli",
      message: "work",
      controller: new AbortController(),
      requestGroupQueueActive: false,
      shouldReconnectGroup: false,
      reconnectCandidateCount: 0,
      requestedClosedRequestGroup: false,
      workerSessionId: "worker-session-1",
      reusableWorkerSessionRun: true,
    }, dependencies)

    expect(result.interruptedWorkerRunCount).toBe(2)
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-3", "기존 작업 세션 재사용: worker-session-1")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-3", "작업 세션 연결: worker-session-1")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-3", "이전 작업 세션 잔여 실행 2건 정리")
  })
})
