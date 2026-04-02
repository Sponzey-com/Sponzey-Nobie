import { describe, expect, it, vi } from "vitest"
import { runSyntheticApprovalPass } from "../packages/core/src/runs/approval-pass.ts"
import type { SyntheticApprovalRuntimeDependencies } from "../packages/core/src/runs/approval.ts"

const request = {
  toolName: "screen_capture",
  summary: "화면 캡처 진행 전 승인이 필요합니다.",
  continuationPrompt: "[Approval Granted Continuation]",
}

function createRuntimeDependencies(
  overrides: Partial<SyntheticApprovalRuntimeDependencies> = {},
): SyntheticApprovalRuntimeDependencies {
  return {
    timeoutSec: 30,
    fallback: "deny",
    appendRunEvent: () => undefined,
    setRunStepStatus: () => undefined,
    updateRunStatus: () => undefined,
    cancelRun: () => undefined,
    emitApprovalResolved: () => undefined,
    emitApprovalRequest: () => undefined,
    ...overrides,
  }
}

describe("run approval pass", () => {
  it("continues immediately when run approval scope already exists", async () => {
    const emitApprovalRequest = vi.fn()

    const result = await runSyntheticApprovalPass({
      request,
      runId: "run-approved",
      sessionId: "session-approved",
      signal: new AbortController().signal,
      alreadyApproved: true,
      sourceLabel: "agent_reply",
      originalRequest: "메인 화면을 캡처해서 보여줘",
      latestAssistantMessage: "화면 캡처 진행 전 승인이 필요합니다.",
      runtimeDependencies: createRuntimeDependencies({
        emitApprovalRequest,
      }),
    })

    expect(result.kind).toBe("continue")
    if (result.kind === "continue") {
      expect(result.grantMode).toBe("reuse_scope")
      expect(result.eventLabel).toContain("전체 승인 상태")
    }
    expect(emitApprovalRequest).not.toHaveBeenCalled()
  })

  it("requests approval and maps allow_run to run-scoped continuation", async () => {
    const result = await runSyntheticApprovalPass({
      request,
      runId: "run-requested",
      sessionId: "session-requested",
      signal: new AbortController().signal,
      alreadyApproved: false,
      sourceLabel: "worker_runtime",
      originalRequest: "메인 화면을 캡처해서 보여줘",
      latestAssistantMessage: "화면 캡처 진행 전 승인이 필요합니다.",
      runtimeDependencies: createRuntimeDependencies({
        emitApprovalRequest: (payload) => {
          payload.resolve("allow_run", "user")
        },
      }),
    })

    expect(result.kind).toBe("continue")
    if (result.kind === "continue") {
      expect(result.grantMode).toBe("run")
      expect(result.continuationPrompt).toContain("Approval Granted Continuation")
    }
  })

  it("stops when the approval request is denied", async () => {
    const result = await runSyntheticApprovalPass({
      request,
      runId: "run-denied",
      sessionId: "session-denied",
      signal: new AbortController().signal,
      alreadyApproved: false,
      sourceLabel: "agent_reply",
      originalRequest: "파일을 써줘",
      latestAssistantMessage: "파일 작업 승인이 필요합니다.",
      runtimeDependencies: createRuntimeDependencies({
        emitApprovalRequest: (payload) => {
          payload.resolve("deny", "user")
        },
      }),
    })

    expect(result).toEqual({ kind: "stop" })
  })
})
