import { describe, expect, it } from "vitest"
import { detectRelativeScheduleRequest, promotePromissoryDirectAnswer } from "../packages/core/src/agent/intake.ts"

describe("detectRelativeScheduleRequest", () => {
  it("turns relative delay requests into one-time scheduling action items", () => {
    const base = Date.parse("2026-03-16T09:00:00.000Z")
    const result = detectRelativeScheduleRequest("5초뒤 안녕이라고 말해봐", base)

    expect(result).not.toBeNull()
    expect(result?.intent.category).toBe("schedule_request")
    expect(result?.scheduling.kind).toBe("one_time")
    expect(result?.scheduling.status).toBe("accepted")
    expect(result?.action_items[0]?.type).toBe("create_schedule")
    expect(result?.action_items[0]?.payload.run_at).toBe("2026-03-16T09:00:05.000Z")
    expect(result?.action_items[0]?.payload.task).toBe("안녕이라고 말해봐")
  })

  it("asks for clarification when the delayed task body is missing", () => {
    const result = detectRelativeScheduleRequest("5초 뒤", Date.parse("2026-03-16T09:00:00.000Z"))

    expect(result).not.toBeNull()
    expect(result?.intent.category).toBe("clarification")
    expect(result?.user_message.mode).toBe("clarification_receipt")
    expect(result?.scheduling.status).toBe("needs_clarification")
    expect(result?.action_items[0]?.type).toBe("ask_user")
  })

  it("extracts multiple delayed action items from one sentence", () => {
    const base = Date.parse("2026-03-16T09:00:00.000Z")
    const result = detectRelativeScheduleRequest("5초뒤에 안녕 해주고, 10초 뒤에 잘가 해줘", base)

    expect(result).not.toBeNull()
    expect(result?.intent.category).toBe("schedule_request")
    expect(result?.action_items).toHaveLength(2)
    expect(result?.action_items[0]?.type).toBe("create_schedule")
    expect(result?.action_items[1]?.type).toBe("create_schedule")
    expect(result?.action_items[0]?.payload.run_at).toBe("2026-03-16T09:00:05.000Z")
    expect(result?.action_items[1]?.payload.run_at).toBe("2026-03-16T09:00:10.000Z")
    expect(result?.action_items[0]?.payload.task).toContain("안녕")
    expect(result?.action_items[1]?.payload.task).toContain("잘가")
  })
})

describe("promotePromissoryDirectAnswer", () => {
  it("promotes fake direct answers that promise a live weather lookup into task intake", () => {
    const result = promotePromissoryDirectAnswer({
      intent: {
        category: "direct_answer",
        summary: "실시간 날씨 확인",
        confidence: 0.9,
      },
      user_message: {
        mode: "direct_answer",
        text: "현재 동천동 날씨를 확인하려면 실시간 조회가 필요해요. 지금 바로 확인해드릴게요.",
      },
      action_items: [{
        id: "reply-1",
        type: "reply",
        title: "reply",
        priority: "normal",
        reason: "direct reply",
        payload: { content: "현재 동천동 날씨를 확인하려면 실시간 조회가 필요해요. 지금 바로 확인해드릴게요." },
      }],
      structured_request: {
        source_language: "ko",
        normalized_english: "Check the current weather in Dongcheon-dong.",
        target: "current weather in Dongcheon-dong",
        to: "telegram chat 1, main thread",
        context: ["User asked for current weather in Dongcheon-dong."],
        complete_condition: ["Return the current weather for Dongcheon-dong."],
      },
      intent_envelope: {
        intent_type: "direct_answer",
        source_language: "ko",
        normalized_english: "Check the current weather in Dongcheon-dong.",
        target: "current weather in Dongcheon-dong",
        destination: "telegram chat 1, main thread",
        context: ["User asked for current weather in Dongcheon-dong."],
        complete_condition: ["Return the current weather for Dongcheon-dong."],
        schedule_spec: {
          detected: false,
          kind: "none",
          status: "not_applicable",
          schedule_text: "",
        },
        execution_semantics: {
          filesystemEffect: "none",
          privilegedOperation: "none",
          artifactDelivery: "none",
          approvalRequired: false,
          approvalTool: "external_action",
        },
        delivery_mode: "none",
        requires_approval: false,
        approval_tool: "external_action",
        preferred_target: "auto",
        needs_tools: false,
        needs_web: false,
      },
      scheduling: {
        detected: false,
        kind: "none",
        status: "not_applicable",
        schedule_text: "",
      },
      execution: {
        requires_run: false,
        requires_delegation: false,
        suggested_target: "auto",
        max_delegation_turns: 5,
        needs_tools: false,
        needs_web: false,
        execution_semantics: {
          filesystemEffect: "none",
          privilegedOperation: "none",
          artifactDelivery: "none",
          approvalRequired: false,
          approvalTool: "external_action",
        },
      },
      notes: [],
    }, "오늘 동천동 지금 날씨 어때?")

    expect(result.intent.category).toBe("task_intake")
    expect(result.user_message.mode).toBe("accepted_receipt")
    expect(result.execution.requires_run).toBe(true)
    expect(result.execution.needs_web).toBe(true)
    expect(result.action_items[0]?.type).toBe("run_task")
  })
})
