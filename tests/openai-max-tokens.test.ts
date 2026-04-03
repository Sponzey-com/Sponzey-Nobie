import { describe, expect, it } from "vitest"
import { resolveOpenAIChatMaxTokens } from "../packages/core/src/ai/providers/openai.ts"

describe("resolveOpenAIChatMaxTokens", () => {
  it("uses a safer default max token budget for older low-context models", () => {
    const maxTokens = resolveOpenAIChatMaxTokens({
      contextLimit: 8_192,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "x".repeat(6_000) },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search",
            description: "search",
            parameters: {
              type: "object",
              properties: {
                q: { type: "string", description: "x".repeat(3_000) },
              },
            },
          },
        },
      ],
    })

    expect(maxTokens).toBe(2_048)
    expect(maxTokens).toBeGreaterThan(0)
  })

  it("respects smaller explicit maxTokens when enough context remains", () => {
    const maxTokens = resolveOpenAIChatMaxTokens({
      contextLimit: 128_000,
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 512,
    })

    expect(maxTokens).toBe(512)
  })

  it("clamps explicit maxTokens to the remaining context budget", () => {
    const maxTokens = resolveOpenAIChatMaxTokens({
      contextLimit: 4_096,
      messages: [{ role: "user", content: "x".repeat(10_000) }],
      maxTokens: 4_096,
    })

    expect(maxTokens).toBeLessThan(4_096)
    expect(maxTokens).toBeGreaterThan(0)
  })
})
