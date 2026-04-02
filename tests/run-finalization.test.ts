import { describe, expect, it, vi } from "vitest"
import {
  buildAwaitingUserMessage,
  completeRunWithAssistantMessage,
  markRunCompleted,
  moveRunToAwaitingUser,
  moveRunToCancelledAfterStop,
} from "../packages/core/src/runs/finalization.ts"

function createDeps() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
    onDeliveryError: vi.fn(),
    deliveryDependencies: {
      now: () => 0,
      createId: () => "message-1",
      insertMessage: vi.fn(),
      emitStart: vi.fn(),
      emitStream: vi.fn(),
      emitEnd: vi.fn(),
      writeReplyLog: vi.fn(),
    },
  }
}

describe("run finalization helpers", () => {
  it("builds an awaiting-user message from preview, remaining items, and reason", () => {
    const message = buildAwaitingUserMessage({
      preview: "중간 결과",
      summary: "추가 정보가 필요합니다.",
      reason: "대상 파일 경로가 없습니다.",
      userMessage: "어느 파일을 수정해야 하나요?",
      remainingItems: ["대상 파일 확인"],
    })

    expect(message).toContain("어느 파일을 수정해야 하나요?")
    expect(message).toContain("현재까지 결과:")
    expect(message).toContain("남은 항목:")
    expect(message).toContain("중단 사유:")
  })

  it("moves a run to awaiting_user and emits a standalone message", async () => {
    const deps = createDeps()
    const onChunk = vi.fn().mockResolvedValue(undefined)

    await moveRunToAwaitingUser({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk,
      awaitingUser: {
        preview: "현재까지 결과",
        summary: "추가 입력 필요",
        userMessage: "계속하려면 파일명을 알려 주세요.",
      },
      dependencies: deps,
    })

    expect(onChunk).toHaveBeenCalled()
    expect(deps.setRunStepStatus).toHaveBeenCalledWith("run-1", "awaiting_user", "running", "추가 입력 필요")
    expect(deps.updateRunStatus).toHaveBeenCalledWith("run-1", "awaiting_user", "추가 입력 필요", true)
    expect(deps.appendRunEvent).toHaveBeenCalledWith("run-1", "사용자 추가 입력 대기")
  })

  it("moves a run to cancelled after stop and records failure", async () => {
    const deps = createDeps()
    const onChunk = vi.fn().mockResolvedValue(undefined)

    await moveRunToCancelledAfterStop({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk,
      cancellation: {
        preview: "현재까지 결과",
        summary: "자동 진행 중단",
        reason: "권한 승인이 없습니다.",
        remainingItems: ["승인 필요"],
      },
      dependencies: deps,
    })

    expect(deps.rememberRunFailure).toHaveBeenCalled()
    expect(deps.updateRunStatus).toHaveBeenCalledWith("run-1", "cancelled", "자동 진행 중단", false)
    expect(deps.appendRunEvent).toHaveBeenCalledWith("run-1", "자동 진행 중단 후 요청 취소")
  })

  it("completes a run and records success", async () => {
    const deps = createDeps()
    const onChunk = vi.fn().mockResolvedValue(undefined)

    await completeRunWithAssistantMessage({
      runId: "run-1",
      sessionId: "session-1",
      text: "완료했습니다.",
      source: "telegram",
      onChunk,
      dependencies: deps,
    })

    expect(deps.rememberRunSuccess).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      text: "완료했습니다.",
      summary: "완료했습니다.",
    })
    expect(deps.updateRunStatus).toHaveBeenCalledWith("run-1", "completed", "완료했습니다.", false)
    expect(deps.appendRunEvent).toHaveBeenCalledWith("run-1", "실행 완료")
  })

  it("marks a run completed without emitting assistant delivery", () => {
    const deps = createDeps()

    markRunCompleted({
      runId: "run-2",
      sessionId: "session-2",
      source: "telegram",
      text: "파일 전달 완료",
      summary: "텔레그램 파일 전달 완료",
      reviewingSummary: "텔레그램 파일 전달 완료",
      finalizingSummary: "전달 결과를 저장했습니다.",
      completedSummary: "파일 전달 완료",
      eventLabel: "텔레그램 파일 전달 완료",
      dependencies: deps,
    })

    expect(deps.rememberRunSuccess).toHaveBeenCalledWith({
      runId: "run-2",
      sessionId: "session-2",
      source: "telegram",
      text: "파일 전달 완료",
      summary: "텔레그램 파일 전달 완료",
    })
    expect(deps.updateRunStatus).toHaveBeenCalledWith("run-2", "completed", "파일 전달 완료", false)
    expect(deps.appendRunEvent).toHaveBeenCalledWith("run-2", "텔레그램 파일 전달 완료")
  })
})
