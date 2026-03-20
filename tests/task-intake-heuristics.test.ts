import { describe, expect, it } from "vitest"
import { detectRelativeScheduleRequest } from "../packages/core/src/agent/intake.ts"

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
