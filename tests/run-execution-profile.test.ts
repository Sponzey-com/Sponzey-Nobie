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

  it("downgrades mistaken direct artifact delivery for plain weather text answers", () => {
    const executionSemantics = {
      filesystemEffect: "none" as const,
      privilegedOperation: "none" as const,
      artifactDelivery: "direct" as const,
      approvalRequired: false,
      approvalTool: "external_action" as const,
    }
    const structuredRequest = {
      source_language: "ko" as const,
      normalized_english: "Tell me the current weather in Dongcheon-dong.",
      target: "Current weather conditions for Dongcheon-dong",
      to: "telegram chat 1, main thread",
      context: ["User asked for current weather in 동천동"],
      complete_condition: ["Provide a concise current weather summary for Dongcheon-dong."],
    }

    const result = buildResolvedExecutionProfile({
      message: [
        "[Task Execution Brief]",
        "원래 사용자 요청: 지금 동천동 날씨 어때?",
        "- [ ] 결과물 자체를 telegram chat 1, main thread에 직접 전달한다.",
      ].join("\n\n"),
      originalRequest: "지금 동천동 날씨 어때?",
      executionSemantics,
      structuredRequest,
      intentEnvelope: {
        intent_type: "task_intake",
        source_language: "ko",
        normalized_english: structuredRequest.normalized_english,
        target: structuredRequest.target,
        destination: structuredRequest.to,
        context: structuredRequest.context,
        complete_condition: structuredRequest.complete_condition,
        schedule_spec: {
          detected: false,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution_semantics: executionSemantics,
        delivery_mode: "direct",
        requires_approval: false,
        approval_tool: "external_action",
        preferred_target: "auto",
        needs_tools: false,
        needs_web: true,
      },
    })

    expect(result.executionSemantics.artifactDelivery).toBe("none")
    expect(result.wantsDirectArtifactDelivery).toBe(false)
    expect(result.intentEnvelope.execution_semantics.artifactDelivery).toBe("none")
    expect(result.intentEnvelope.delivery_mode).toBe("none")
  })

  it("downgrades mistaken direct artifact delivery for plain market index text answers", () => {
    const executionSemantics = {
      filesystemEffect: "none" as const,
      privilegedOperation: "none" as const,
      artifactDelivery: "direct" as const,
      approvalRequired: false,
      approvalTool: "external_action" as const,
    }
    const structuredRequest = {
      source_language: "ko" as const,
      normalized_english: "Tell me the current NASDAQ Composite index value.",
      target: "The latest available NASDAQ index value",
      to: "telegram chat 1, main thread",
      context: ["User asked for the current NASDAQ index"],
      complete_condition: ["Provide a concise current NASDAQ index value summary."],
    }

    const result = buildResolvedExecutionProfile({
      message: [
        "[Task Execution Brief]",
        "원래 사용자 요청: 지금 나스닥 지수는 얼마지?",
        "- [ ] 결과물 자체를 telegram chat 1, main thread에 직접 전달한다.",
      ].join("\n\n"),
      originalRequest: "지금 나스닥 지수는 얼마지?",
      executionSemantics,
      structuredRequest,
      intentEnvelope: {
        intent_type: "task_intake",
        source_language: "ko",
        normalized_english: structuredRequest.normalized_english,
        target: structuredRequest.target,
        destination: structuredRequest.to,
        context: structuredRequest.context,
        complete_condition: structuredRequest.complete_condition,
        schedule_spec: {
          detected: false,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution_semantics: executionSemantics,
        delivery_mode: "direct",
        requires_approval: false,
        approval_tool: "external_action",
        preferred_target: "auto",
        needs_tools: false,
        needs_web: true,
      },
    })

    expect(result.executionSemantics.artifactDelivery).toBe("none")
    expect(result.wantsDirectArtifactDelivery).toBe(false)
    expect(result.intentEnvelope.execution_semantics.artifactDelivery).toBe("none")
    expect(result.intentEnvelope.delivery_mode).toBe("none")
  })
})
