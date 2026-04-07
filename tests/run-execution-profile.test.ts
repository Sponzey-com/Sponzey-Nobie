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

  it("repairs capture requests into direct artifact delivery semantics", () => {
    const result = buildResolvedExecutionProfile({
      message: "메인 전체 화면 캡처",
      originalRequest: "메인 전체 화면 캡처",
      executionSemantics: {
        filesystemEffect: "none",
        privilegedOperation: "required",
        artifactDelivery: "none",
        approvalRequired: true,
        approvalTool: "screen_capture",
      },
      structuredRequest: {
        source_language: "ko",
        normalized_english: "capture the main full screen",
        target: "메인 전체 화면 캡처",
        to: "telegram chat 1, main thread",
        context: ["Original user request: 메인 전체 화면 캡처"],
        complete_condition: ["캡처 결과가 텔레그램으로 전달된다."],
      },
      intentEnvelope: {
        intent_type: "task_intake",
        source_language: "ko",
        normalized_english: "capture the main full screen",
        target: "메인 전체 화면 캡처",
        destination: "telegram chat 1, main thread",
        context: ["Original user request: 메인 전체 화면 캡처"],
        complete_condition: ["캡처 결과가 텔레그램으로 전달된다."],
        schedule_spec: {
          detected: false,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution_semantics: {
          filesystemEffect: "none",
          privilegedOperation: "required",
          artifactDelivery: "none",
          approvalRequired: true,
          approvalTool: "screen_capture",
        },
        delivery_mode: "none",
        requires_approval: true,
        approval_tool: "screen_capture",
        preferred_target: "auto",
        needs_tools: true,
        needs_web: false,
      },
    })

    expect(result.executionSemantics.artifactDelivery).toBe("direct")
    expect(result.wantsDirectArtifactDelivery).toBe(true)
    expect(result.intentEnvelope.execution_semantics.artifactDelivery).toBe("direct")
    expect(result.intentEnvelope.delivery_mode).toBe("direct")
  })

  it("downgrades mistaken direct artifact delivery for plain monitor-count questions", () => {
    const result = buildResolvedExecutionProfile({
      message: "모니터 몇개있지?",
      originalRequest: "모니터 몇개있지?",
      executionSemantics: {
        filesystemEffect: "none",
        privilegedOperation: "required",
        artifactDelivery: "direct",
        approvalRequired: true,
        approvalTool: "external_action",
      },
      structuredRequest: {
        source_language: "ko",
        normalized_english: "How many monitors are connected?",
        target: "Total count of connected monitors",
        to: "webui session unknown",
        context: ["Original user request: 모니터 몇개있지?"],
        complete_condition: ["Successfully identified and reported the number of monitors."],
      },
      intentEnvelope: {
        intent_type: "task_intake",
        source_language: "ko",
        normalized_english: "How many monitors are connected?",
        target: "Total count of connected monitors",
        destination: "webui session unknown",
        context: ["Original user request: 모니터 몇개있지?"],
        complete_condition: ["Successfully identified and reported the number of monitors."],
        schedule_spec: {
          detected: false,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution_semantics: {
          filesystemEffect: "none",
          privilegedOperation: "required",
          artifactDelivery: "direct",
          approvalRequired: true,
          approvalTool: "external_action",
        },
        delivery_mode: "direct",
        requires_approval: true,
        approval_tool: "external_action",
        preferred_target: "auto",
        needs_tools: true,
        needs_web: false,
      },
    })

    expect(result.executionSemantics.artifactDelivery).toBe("none")
    expect(result.wantsDirectArtifactDelivery).toBe(false)
    expect(result.intentEnvelope.execution_semantics.artifactDelivery).toBe("none")
    expect(result.intentEnvelope.delivery_mode).toBe("none")
  })
})
