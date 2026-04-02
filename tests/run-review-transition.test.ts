import { describe, expect, it, vi } from "vitest"
import { prepareRunForReview } from "../packages/core/src/runs/review-transition.ts"

function createDeps() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    insertMessage: vi.fn(),
    writeReplyLog: vi.fn(),
    createId: () => "message-1",
    now: () => 123,
  }
}

describe("run review transition", () => {
  it("records worker shutdown, persists runtime preview, and enters review", () => {
    const deps = createDeps()

    prepareRunForReview({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      preview: "중간 실행 결과",
      workerSessionId: "worker-1",
      persistRuntimePreview: true,
      dependencies: deps,
    })

    expect(deps.appendRunEvent).toHaveBeenCalledWith("run-1", "worker-1 실행 종료")
    expect(deps.insertMessage).toHaveBeenCalledWith({
      id: "message-1",
      session_id: "session-1",
      root_run_id: "run-1",
      role: "assistant",
      content: "중간 실행 결과",
      tool_calls: null,
      tool_call_id: null,
      created_at: 123,
    })
    expect(deps.writeReplyLog).toHaveBeenCalledWith("telegram", "중간 실행 결과")
    expect(deps.setRunStepStatus).toHaveBeenNthCalledWith(
      1,
      "run-1",
      "executing",
      "completed",
      "중간 실행 결과",
    )
    expect(deps.setRunStepStatus).toHaveBeenNthCalledWith(
      2,
      "run-1",
      "reviewing",
      "running",
      "남은 작업이 있는지 검토 중입니다.",
    )
  })

  it("skips preview persistence for empty preview and uses fallback executing summary", () => {
    const deps = createDeps()

    prepareRunForReview({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      preview: "",
      persistRuntimePreview: true,
      dependencies: deps,
    })

    expect(deps.appendRunEvent).not.toHaveBeenCalled()
    expect(deps.insertMessage).not.toHaveBeenCalled()
    expect(deps.writeReplyLog).toHaveBeenCalledWith("webui", "")
    expect(deps.setRunStepStatus).toHaveBeenNthCalledWith(
      1,
      "run-2",
      "executing",
      "completed",
      "응답 생성을 마쳤습니다.",
    )
    expect(deps.setRunStepStatus).toHaveBeenNthCalledWith(
      2,
      "run-2",
      "reviewing",
      "running",
      "남은 작업이 있는지 검토 중입니다.",
    )
  })
})
