import { describe, expect, it } from "vitest"
import { ToolDispatcher } from "../packages/core/src/tools/dispatcher.ts"

describe("tool dispatcher source filtering", () => {
  it("rejects channel-specific tools on unsupported sources", async () => {
    const dispatcher = new ToolDispatcher()
    dispatcher.register({
      name: "telegram_send_file",
      description: "telegram only",
      parameters: { type: "object", properties: {} },
      riskLevel: "safe",
      requiresApproval: false,
      availableSources: ["telegram"],
      async execute() {
        return { success: true, output: "ok" }
      },
    })

    const result = await dispatcher.dispatch(
      "telegram_send_file",
      {},
      {
        sessionId: "session-1",
        runId: "run-1",
        workDir: process.cwd(),
        userMessage: "send it to slack",
        source: "slack",
        allowWebAccess: false,
        onProgress: () => undefined,
        signal: new AbortController().signal,
      },
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe("TOOL_SOURCE_NOT_SUPPORTED")
  })
})
