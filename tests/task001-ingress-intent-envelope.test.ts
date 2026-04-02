import { describe, expect, it } from "vitest"
import { buildIngressReceipt, resolveIngressStartParams } from "../packages/core/src/runs/ingress.ts"
import { detectRelativeScheduleRequest } from "../packages/core/src/agent/intake.ts"

describe("task001 ingress and intent envelope", () => {
  it("builds an immediate ingress receipt without interpreting the task", () => {
    expect(buildIngressReceipt("화면 캡처해서 보여줘")).toEqual({
      language: "ko",
      text: "요청을 접수했습니다. 분석을 시작합니다.",
    })

    expect(buildIngressReceipt("capture the main display")).toEqual({
      language: "en",
      text: "Request received. Starting analysis.",
    })
  })

  it("resolves request identity in ingress before the run loop starts", () => {
    const resolved = resolveIngressStartParams({
      message: "hello",
      sessionId: undefined,
      source: "cli",
      model: undefined,
    })

    expect(resolved.runId).toBeTypeOf("string")
    expect(resolved.sessionId).toBeTypeOf("string")
    expect(resolved.message).toBe("hello")
    expect(resolved.source).toBe("cli")
  })

  it("preserves explicit identifiers when ingress params already include them", () => {
    const resolved = resolveIngressStartParams({
      runId: "run-123",
      message: "hello",
      sessionId: "session-123",
      source: "telegram",
      model: undefined,
    })

    expect(resolved.runId).toBe("run-123")
    expect(resolved.sessionId).toBe("session-123")
  })

  it("produces a validated intent envelope for relative scheduling", () => {
    const result = detectRelativeScheduleRequest(
      "5초뒤 안녕이라고 해줘",
      Date.parse("2026-03-16T09:00:00.000Z"),
      5,
      {
        destination: "telegram chat 42120565, main thread",
        contextLines: ["Execution channel: telegram chat 42120565, main thread"],
      },
    )

    expect(result).not.toBeNull()
    expect(result?.intent_envelope.intent_type).toBe("schedule_request")
    expect(result?.intent_envelope.destination).toBe("telegram chat 42120565, main thread at the scheduled time")
    expect(result?.intent_envelope.target).toContain("안녕")
    expect(result?.intent_envelope.complete_condition.length).toBeGreaterThan(0)
    expect(result?.notes).toContain("intent-envelope-validated")
  })
})
