import { describe, expect, it } from "vitest"
import { analyzeRequestEntrySemantics } from "../packages/core/src/runs/entry-semantics.ts"

describe("request entry semantics", () => {
  it("does not treat a short standalone request as conversation reuse by default", () => {
    expect(analyzeRequestEntrySemantics("메인 화면 캡쳐해줘").reuse_conversation_context).toBe(false)
    expect(analyzeRequestEntrySemantics("지금 모니터 몇개야?").reuse_conversation_context).toBe(false)
  })

  it("still detects explicit continuation phrases as conversation reuse", () => {
    expect(analyzeRequestEntrySemantics("그 화면 다시 보여줘").reuse_conversation_context).toBe(true)
    expect(analyzeRequestEntrySemantics("continue the previous calendar work").reuse_conversation_context).toBe(true)
  })
})
