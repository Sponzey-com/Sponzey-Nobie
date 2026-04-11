import { describe, expect, it } from "vitest"
import {
  buildCodexOAuthFallbackPrompt,
  shouldRetryCodexOAuthWithSimplePayload,
} from "../packages/core/src/ai/providers/openai.ts"

describe("buildCodexOAuthFallbackPrompt", () => {
  it("flattens recent structured messages into a plain prompt transcript", () => {
    const prompt = buildCodexOAuthFallbackPrompt([
      { role: "user", content: "첫 질문" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "도구를 써볼게요" },
          { type: "tool_use", id: "call_1", name: "web_search", input: { q: "동천동 날씨" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: "검색 실패" },
          { type: "text", text: "다시 확인해줘" },
        ],
      },
    ])

    expect(prompt).toContain("User: 첫 질문")
    expect(prompt).toContain("Assistant: 도구를 써볼게요")
    expect(prompt).toContain("[tool request] web_search")
    expect(prompt).toContain("[tool result] 검색 실패")
    expect(prompt).toContain("User: [tool result] 검색 실패")
  })
})

describe("shouldRetryCodexOAuthWithSimplePayload", () => {
  it("retries on html/auth failures when the original payload was complex", () => {
    expect(shouldRetryCodexOAuthWithSimplePayload({
      status: 403,
      detail: "<html><body>forbidden</body></html>",
      hasTools: true,
      hasMaxOutputTokens: true,
      messageCount: 3,
      hasStructuredConversation: true,
    })).toBe(true)
  })

  it("does not retry for a simple single-message payload", () => {
    expect(shouldRetryCodexOAuthWithSimplePayload({
      status: 403,
      detail: "<html><body>forbidden</body></html>",
      hasTools: false,
      hasMaxOutputTokens: false,
      messageCount: 1,
      hasStructuredConversation: false,
    })).toBe(false)
  })
})
