import { describe, expect, it } from "vitest"
import { buildResolvedExecutionProfile, createExecutionLoopRuntimeState } from "../packages/core/src/runs/execution-profile.ts"

describe("execution profile", () => {
  it("builds fallback structured request and intent envelope from a plain message", () => {
    const result = buildResolvedExecutionProfile({
      message: "안녕하세요 달력 작업 이어서 수정해줘",
    })

    expect(result.originalRequest).toBe("안녕하세요 달력 작업 이어서 수정해줘")
    expect(result.structuredRequest.source_language).toBe("ko")
    expect(result.structuredRequest.target).toBe("안녕하세요 달력 작업 이어서 수정해줘")
    expect(result.intentEnvelope.destination).toBe("the current channel")
    expect(result.intentEnvelope.execution_semantics).toEqual(result.executionSemantics)
  })

  it("initializes loop runtime state from the resolved execution profile", () => {
    const runtime = createExecutionLoopRuntimeState({
      message: "Deliver report.pdf",
      originalRequest: "Deliver report.pdf",
      executionSemantics: {
        filesystemEffect: "mutate",
        privilegedOperation: "required",
        artifactDelivery: "direct",
        approvalRequired: true,
        approvalTool: "file_write",
      },
    })

    expect(runtime.executionProfile.wantsDirectArtifactDelivery).toBe(true)
    expect(runtime.requiresFilesystemMutation).toBe(true)
    expect(runtime.requiresPrivilegedToolExecution).toBe(true)
    expect(runtime.recoveryBudgetUsage.interpretation).toBe(0)
    expect(runtime.pendingToolParams.size).toBe(0)
    expect(runtime.filesystemMutationPaths.size).toBe(0)
    expect(runtime.priorAssistantMessages).toEqual([])
  })
})
