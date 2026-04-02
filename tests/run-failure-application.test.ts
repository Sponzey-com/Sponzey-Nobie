import { describe, expect, it, vi } from "vitest"
import { applyFatalFailure } from "../packages/core/src/runs/failure-application.ts"

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunFailure: vi.fn(),
    markAbortedRunCancelledIfActive: vi.fn(),
  }
}

describe("run failure application", () => {
  it("records failed status and failure journal when execution fails", () => {
    const dependencies = createDependencies()

    const result = applyFatalFailure({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      message: "command failed",
      aborted: false,
      summary: "실행 중 오류로 요청이 중단되었습니다.",
      title: "run_error",
      extraEvents: ["worker-session 실행 실패"],
    }, dependencies)

    expect(result).toBe("failed")
    expect(dependencies.appendRunEvent).toHaveBeenNthCalledWith(1, "run-1", "command failed")
    expect(dependencies.appendRunEvent).toHaveBeenNthCalledWith(2, "run-1", "worker-session 실행 실패")
    expect(dependencies.setRunStepStatus).toHaveBeenCalledWith("run-1", "executing", "failed", "command failed")
    expect(dependencies.updateRunStatus).toHaveBeenCalledWith("run-1", "failed", "command failed", false)
    expect(dependencies.rememberRunFailure).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      summary: "실행 중 오류로 요청이 중단되었습니다.",
      detail: "command failed",
      title: "run_error",
    })
    expect(dependencies.markAbortedRunCancelledIfActive).not.toHaveBeenCalled()
  })

  it("marks aborted runs as cancelled without failure state by default", () => {
    const dependencies = createDependencies()

    const result = applyFatalFailure({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      message: "unexpected error",
      aborted: true,
      summary: "예상하지 못한 실행 오류가 발생했습니다.",
      title: "unexpected_error",
    }, dependencies)

    expect(result).toBe("cancelled")
    expect(dependencies.markAbortedRunCancelledIfActive).toHaveBeenCalledWith("run-2")
    expect(dependencies.appendRunEvent).not.toHaveBeenCalled()
    expect(dependencies.setRunStepStatus).not.toHaveBeenCalled()
    expect(dependencies.updateRunStatus).not.toHaveBeenCalled()
    expect(dependencies.rememberRunFailure).not.toHaveBeenCalled()
  })

  it("can retain abort-time events for execution chunk failures", () => {
    const dependencies = createDependencies()

    const result = applyFatalFailure({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      message: "runtime aborted",
      aborted: true,
      summary: "실행 중 오류로 요청이 중단되었습니다.",
      title: "run_error",
      extraEvents: ["worker-123 실행 실패"],
      appendMessageEventOnAbort: true,
      appendExtraEventsOnAbort: true,
    }, dependencies)

    expect(result).toBe("cancelled")
    expect(dependencies.appendRunEvent).toHaveBeenNthCalledWith(1, "run-3", "runtime aborted")
    expect(dependencies.appendRunEvent).toHaveBeenNthCalledWith(2, "run-3", "worker-123 실행 실패")
    expect(dependencies.markAbortedRunCancelledIfActive).toHaveBeenCalledWith("run-3")
    expect(dependencies.setRunStepStatus).not.toHaveBeenCalled()
    expect(dependencies.updateRunStatus).not.toHaveBeenCalled()
    expect(dependencies.rememberRunFailure).not.toHaveBeenCalled()
  })
})
