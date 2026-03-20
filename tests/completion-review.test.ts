import { describe, expect, it } from "vitest"
import { parseCompletionReviewResult } from "../packages/core/src/agent/completion-review.ts"

describe("parseCompletionReviewResult", () => {
  it("parses followup review results", () => {
    const parsed = parseCompletionReviewResult(`{
      "status": "followup",
      "summary": "남은 작업이 있습니다.",
      "reason": "두 번째 요청이 처리되지 않았습니다.",
      "followup_prompt": "남은 두 번째 요청만 처리하세요.",
      "remaining_items": ["두 번째 요청 처리"]
    }`)

    expect(parsed?.status).toBe("followup")
    expect(parsed?.followupPrompt).toBe("남은 두 번째 요청만 처리하세요.")
    expect(parsed?.remainingItems).toEqual(["두 번째 요청 처리"])
  })

  it("parses ask_user review results", () => {
    const parsed = parseCompletionReviewResult(`{
      "status": "ask_user",
      "summary": "추가 정보가 필요합니다.",
      "reason": "대상 파일 경로가 없습니다.",
      "user_message": "어느 파일을 수정해야 하나요?",
      "remaining_items": ["대상 파일 확인"]
    }`)

    expect(parsed?.status).toBe("ask_user")
    expect(parsed?.userMessage).toBe("어느 파일을 수정해야 하나요?")
    expect(parsed?.remainingItems).toEqual(["대상 파일 확인"])
  })
})
