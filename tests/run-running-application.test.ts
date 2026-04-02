import { describe, expect, it, vi } from "vitest"
import { applyRunningContinuationState } from "../packages/core/src/runs/running-application.ts"

describe("run running application", () => {
  it("applies review/executing transitions and run summary", () => {
    const events: string[] = []
    const summaries: string[] = []
    const steps: Array<{ stepKey: string; status: string; summary: string }> = []
    const statuses: Array<{ status: string; summary: string; canCancel: boolean }> = []

    const result = applyRunningContinuationState({
      runId: "run-1",
      state: {
        eventLabels: ["복구 재시도 1/3", "대안 후보: 다른 도구"],
        reviewStepStatus: "running",
        reviewSummary: "다른 방법으로 다시 시도합니다.",
        executingSummary: "복구 실행 중입니다.",
        updateRunStatusSummary: "복구 실행 중입니다.",
        updateRunSummary: "다른 방법으로 다시 시도합니다.",
        nextMessage: "retry prompt",
        clearWorkerRuntime: true,
      },
    }, {
      appendRunEvent: (_runId, label) => {
        events.push(label)
      },
      updateRunSummary: (_runId, summary) => {
        summaries.push(summary)
      },
      setRunStepStatus: (_runId, stepKey, status, summary) => {
        steps.push({ stepKey, status, summary })
      },
      updateRunStatus: (_runId, status, summary, canCancel) => {
        statuses.push({ status, summary, canCancel })
      },
    })

    expect(events).toEqual(["복구 재시도 1/3", "대안 후보: 다른 도구"])
    expect(summaries).toEqual(["다른 방법으로 다시 시도합니다."])
    expect(steps).toEqual([
      { stepKey: "reviewing", status: "running", summary: "다른 방법으로 다시 시도합니다." },
      { stepKey: "executing", status: "running", summary: "복구 실행 중입니다." },
    ])
    expect(statuses).toEqual([
      { status: "running", summary: "복구 실행 중입니다.", canCancel: true },
    ])
    expect(result).toEqual({
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      clearProvider: false,
    })
  })

  it("skips blank event labels and optional run status updates", () => {
    const appendRunEvent = vi.fn()
    const updateRunSummary = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()

    const result = applyRunningContinuationState({
      runId: "run-2",
      state: {
        eventLabels: ["", "승인 후 계속 진행"],
        reviewStepStatus: "completed",
        reviewSummary: "승인 완료",
        executingSummary: "승인된 작업을 계속 진행합니다.",
        nextMessage: "continuation prompt",
        clearProvider: true,
      },
    }, {
      appendRunEvent,
      updateRunSummary,
      setRunStepStatus,
      updateRunStatus,
    })

    expect(appendRunEvent).toHaveBeenCalledTimes(1)
    expect(appendRunEvent).toHaveBeenCalledWith("run-2", "승인 후 계속 진행")
    expect(updateRunSummary).not.toHaveBeenCalled()
    expect(updateRunStatus).not.toHaveBeenCalled()
    expect(result).toEqual({
      nextMessage: "continuation prompt",
      clearWorkerRuntime: false,
      clearProvider: true,
    })
  })
})
