import { describe, expect, it, vi } from "vitest"
import {
  buildRunFailureJournalRecord,
  buildRunInstructionJournalRecord,
  buildRunSuccessJournalRecord,
  safeInsertRunJournalRecord,
} from "../packages/core/src/runs/journaling.ts"

describe("run journaling helpers", () => {
  it("builds an instruction journal record with condensed summary", () => {
    const record = buildRunInstructionJournalRecord({
      runId: "run-1",
      sessionId: "session-1",
      requestGroupId: "group-1",
      source: "telegram",
      message: "사용자 요청 본문",
    })

    expect(record.kind).toBe("instruction")
    expect(record.summary).toContain("사용자 요청")
    expect(record.requestGroupId).toBe("group-1")
    expect(record.tags).toEqual(["instruction"])
  })

  it("builds a success journal record with optional request group", () => {
    const record = buildRunSuccessJournalRecord({
      runId: "run-1",
      sessionId: "session-1",
      source: "webui",
      text: "완료 텍스트",
      summary: "요약 텍스트",
    })

    expect(record.kind).toBe("success")
    expect(record.summary).toContain("요약 텍스트")
    expect(record.requestGroupId).toBeUndefined()
  })

  it("builds a failure journal record with focused error summary", () => {
    const record = buildRunFailureJournalRecord({
      runId: "run-1",
      sessionId: "session-1",
      source: "cli",
      summary: "실행 실패",
      detail: "info line\npermission denied while opening file\nother line",
      title: "custom_failure",
    })

    expect(record.kind).toBe("failure")
    expect(record.title).toBe("custom_failure")
    expect(record.summary.toLowerCase()).toContain("permission denied")
  })

  it("swallows insert errors and reports them through dependency hook", () => {
    const onError = vi.fn()

    safeInsertRunJournalRecord(
      {
        kind: "failure",
        title: "failure",
        content: "내용",
        summary: "요약",
      },
      {
        insertRecord: () => {
          throw new Error("db locked")
        },
        onError,
      },
    )

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("db locked"))
  })
})
