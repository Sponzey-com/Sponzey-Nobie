import { describe, expect, it } from "vitest"
import { analyzeRequestEntrySemantics } from "../packages/core/src/runs/entry-semantics.ts"

describe("request entry semantics", () => {
  it("delegates reuse comparison to isolated AI and keeps local reuse false", () => {
    expect(analyzeRequestEntrySemantics("메인 화면 캡쳐해줘").reuse_conversation_context).toBe(false)
    expect(analyzeRequestEntrySemantics("지금 모니터 몇개야?").reuse_conversation_context).toBe(false)
    expect(analyzeRequestEntrySemantics("외부모니터 화면 캡쳐해서 보여줘").reuse_conversation_context).toBe(false)
    expect(analyzeRequestEntrySemantics("모니터 총 갯수와, 이름, 크기를 알려줘").reuse_conversation_context).toBe(false)
    expect(analyzeRequestEntrySemantics("그 화면 다시 보여줘").reuse_conversation_context).toBe(false)
    expect(analyzeRequestEntrySemantics("continue the previous calendar work").reuse_conversation_context).toBe(false)
  })

  it("does not treat multilingual schedule cancellation wording as active queue cancellation", () => {
    expect(analyzeRequestEntrySemantics("Cancel the 9 AM reminder").active_queue_cancellation_mode).toBeNull()
    expect(analyzeRequestEntrySemantics("예약 알림 취소해줘").active_queue_cancellation_mode).toBeNull()
    expect(analyzeRequestEntrySemantics("予約をキャンセルして").active_queue_cancellation_mode).toBeNull()
    expect(analyzeRequestEntrySemantics("取消预约").active_queue_cancellation_mode).toBeNull()
  })

  it("does not finalize active queue cancellation from direct keywords", () => {
    expect(analyzeRequestEntrySemantics("지금 작업 취소해줘").active_queue_cancellation_mode).toBeNull()
    expect(analyzeRequestEntrySemantics("stop it").active_queue_cancellation_mode).toBeNull()
    expect(analyzeRequestEntrySemantics("cancel the current task").active_queue_cancellation_mode).toBeNull()
  })
})
