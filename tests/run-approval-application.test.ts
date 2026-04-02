import { describe, expect, it, vi } from "vitest"
import {
  applySyntheticApprovalContinuation,
  decideSyntheticApprovalContinuation,
} from "../packages/core/src/runs/approval-application.ts"

const request = {
  toolName: "screen_capture",
  summary: "화면 캡처 진행 전 승인이 필요합니다.",
  continuationPrompt: "[Approval Granted Continuation]",
}

describe("run approval application", () => {
  it("continues immediately when scope approval already exists", () => {
    const result = decideSyntheticApprovalContinuation({
      request,
      alreadyApproved: true,
    })

    expect(result.kind).toBe("continue")
    if (result.kind === "continue") {
      expect(result.grantMode).toBe("reuse_scope")
      expect(result.eventLabel).toContain("전체 승인 상태")
    }
  })

  it("maps allow_run to scoped continuation", () => {
    const result = decideSyntheticApprovalContinuation({
      request,
      decision: "allow_run",
      alreadyApproved: false,
    })

    expect(result.kind).toBe("continue")
    if (result.kind === "continue") {
      expect(result.grantMode).toBe("run")
      expect(result.eventLabel).toContain("전체 승인")
    }
  })

  it("stops on deny", () => {
    const result = decideSyntheticApprovalContinuation({
      request,
      decision: "deny",
      alreadyApproved: false,
    })

    expect(result.kind).toBe("stop")
  })

  it("applies run-scoped approval and returns continuation state", () => {
    const continuation = decideSyntheticApprovalContinuation({
      request,
      decision: "allow_run",
      alreadyApproved: false,
    })

    const appendRunEvent = vi.fn()
    const updateRunSummary = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()
    const rememberRunApprovalScope = vi.fn()
    const grantRunApprovalScope = vi.fn()
    const grantRunSingleApproval = vi.fn()

    const result = applySyntheticApprovalContinuation({
      runId: "run-1",
      continuation,
      aborted: false,
    }, {
      rememberRunApprovalScope,
      grantRunApprovalScope,
      grantRunSingleApproval,
      appendRunEvent,
      updateRunSummary,
      setRunStepStatus,
      updateRunStatus,
    })

    expect(result.kind).toBe("continue")
    expect(rememberRunApprovalScope).toHaveBeenCalledWith("run-1")
    expect(grantRunApprovalScope).toHaveBeenCalledWith("run-1")
    expect(grantRunSingleApproval).not.toHaveBeenCalled()
  })
})
