import { describe, expect, it, vi } from "vitest"
import { applyTerminalApplication } from "../packages/core/src/runs/terminal-application.ts"

function createFinalizationDependencies() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
  }
}

describe("run terminal application", () => {
  it("delegates awaiting_user application to finalization helper", async () => {
    const moveRunToAwaitingUser = vi.fn(async () => {})
    const moveRunToCancelledAfterStop = vi.fn(async () => {})

    const result = await applyTerminalApplication({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      application: {
        kind: "awaiting_user",
        preview: "현재까지 결과",
        summary: "추가 입력이 필요합니다.",
        reason: "대상이 모호합니다.",
        userMessage: "어느 파일을 바꿀지 알려 주세요.",
        remainingItems: ["파일명 지정"],
      },
      dependencies: createFinalizationDependencies(),
    }, {
      moveRunToAwaitingUser,
      moveRunToCancelledAfterStop,
    })

    expect(result).toBe("awaiting_user")
    expect(moveRunToAwaitingUser).toHaveBeenCalledTimes(1)
    expect(moveRunToAwaitingUser).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      awaitingUser: {
        preview: "현재까지 결과",
        summary: "추가 입력이 필요합니다.",
        reason: "대상이 모호합니다.",
        userMessage: "어느 파일을 바꿀지 알려 주세요.",
        remainingItems: ["파일명 지정"],
      },
      dependencies: expect.any(Object),
    })
    expect(moveRunToCancelledAfterStop).not.toHaveBeenCalled()
  })

  it("delegates stop application to finalization helper", async () => {
    const moveRunToAwaitingUser = vi.fn(async () => {})
    const moveRunToCancelledAfterStop = vi.fn(async () => {})

    const result = await applyTerminalApplication({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      application: {
        kind: "stop",
        preview: "중간 결과",
        summary: "자동 진행을 중단합니다.",
        reason: "복구 예산 소진",
        rawMessage: "claude exited with code 1",
        remainingItems: ["다른 대안 검토"],
      },
      dependencies: createFinalizationDependencies(),
    }, {
      moveRunToAwaitingUser,
      moveRunToCancelledAfterStop,
    })

    expect(result).toBe("cancelled")
    expect(moveRunToCancelledAfterStop).toHaveBeenCalledTimes(1)
    expect(moveRunToCancelledAfterStop).toHaveBeenCalledWith({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      cancellation: {
        preview: "중간 결과",
        summary: "자동 진행을 중단합니다.",
        reason: "복구 예산 소진",
        rawMessage: "claude exited with code 1",
        remainingItems: ["다른 대안 검토"],
      },
      dependencies: expect.any(Object),
    })
    expect(moveRunToAwaitingUser).not.toHaveBeenCalled()
  })
})
