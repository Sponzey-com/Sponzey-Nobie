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
})
