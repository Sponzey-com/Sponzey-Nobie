import { describe, expect, it, vi } from "vitest"
import {
  finalizeAnalysisOnlySubrun,
  runFilesystemVerificationSubtask,
} from "../packages/core/src/runs/analysis-subrun.ts"

describe("analysis-only subrun helpers", () => {
  it("finalizes an analysis-only subrun as interrupted after relaying result", () => {
    const appendRunEvent = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()

    finalizeAnalysisOnlySubrun(
      "run-1",
      {
        executionSummary: "검증 요약",
        relaySummary: "상위 태스크 전달 완료",
        eventLabel: "검증 분석 종료",
      },
      {
        appendRunEvent,
        setRunStepStatus,
        updateRunStatus,
      },
    )

    expect(setRunStepStatus).toHaveBeenCalledWith("run-1", "executing", "completed", "검증 요약")
    expect(setRunStepStatus).toHaveBeenCalledWith("run-1", "reviewing", "completed", "상위 태스크 전달 완료")
    expect(updateRunStatus).toHaveBeenCalledWith("run-1", "interrupted", "상위 태스크 전달 완료", false)
    expect(appendRunEvent).toHaveBeenCalledWith("run-1", "검증 분석 종료")
  })

  it("creates and relays a successful filesystem verification subrun", async () => {
    const createRun = vi.fn()
    const appendRunEvent = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()

    const result = await runFilesystemVerificationSubtask({
      parentRunId: "parent-1",
      requestGroupId: "group-1",
      sessionId: "session-1",
      source: "telegram",
      originalRequest: "파일 생성",
      mutationPaths: ["/tmp/a.txt"],
      workDir: "/tmp",
      dependencies: {
        createRun,
        appendRunEvent,
        setRunStepStatus,
        updateRunStatus,
        createId: () => "subrun-1",
        buildFilesystemVerificationPrompt: () => "verify prompt",
        verifyFilesystemTargets: () => ({ ok: true, summary: "검증 성공" }),
      },
    })

    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      id: "subrun-1",
      taskProfile: "review",
      targetLabel: "결과 검증",
    }))
    expect(result).toEqual({ ok: true, summary: "검증 성공" })
    expect(appendRunEvent).toHaveBeenCalledWith("parent-1", "결과 검증 하위 작업을 생성했습니다.")
    expect(appendRunEvent).toHaveBeenCalledWith("parent-1", "결과 검증 하위 작업이 성공 분석 결과를 전달했습니다.")
  })

  it("returns failure detail from filesystem verification subrun", async () => {
    const result = await runFilesystemVerificationSubtask({
      parentRunId: "parent-1",
      requestGroupId: "group-1",
      sessionId: "session-1",
      source: "webui",
      originalRequest: "파일 생성",
      mutationPaths: ["/tmp/a.txt"],
      workDir: "/tmp",
      dependencies: {
        createRun: vi.fn(),
        appendRunEvent: vi.fn(),
        setRunStepStatus: vi.fn(),
        updateRunStatus: vi.fn(),
        createId: () => "subrun-2",
        buildFilesystemVerificationPrompt: () => "verify prompt",
        verifyFilesystemTargets: () => ({
          ok: false,
          summary: "검증 실패",
          reason: "대상 파일이 없습니다.",
          remainingItems: ["경로 확인"],
        }),
      },
    })

    expect(result).toEqual({
      ok: false,
      summary: "검증 실패",
      reason: "대상 파일이 없습니다.",
      remainingItems: ["경로 확인"],
    })
  })
})
