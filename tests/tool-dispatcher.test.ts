import { describe, expect, it } from "vitest"
import { eventBus } from "../packages/core/src/events/index.js"
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

  it("emits request group metadata on tool lifecycle events", async () => {
    const dispatcher = new ToolDispatcher()
    dispatcher.register({
      name: "echo_tool",
      description: "returns ok",
      parameters: { type: "object", properties: {} },
      riskLevel: "safe",
      requiresApproval: false,
      async execute() {
        return { success: true, output: "ok" }
      },
    })

    const seenBefore: Array<{ requestGroupId?: string; toolName: string }> = []
    const seenAfter: Array<{ requestGroupId?: string; toolName: string }> = []
    const detachBefore = eventBus.on("tool.before", (payload) => {
      seenBefore.push({ requestGroupId: payload.requestGroupId, toolName: payload.toolName })
    })
    const detachAfter = eventBus.on("tool.after", (payload) => {
      seenAfter.push({ requestGroupId: payload.requestGroupId, toolName: payload.toolName })
    })

    try {
      const result = await dispatcher.dispatch(
        "echo_tool",
        {},
        {
          sessionId: "session-1",
          runId: "run-1",
          requestGroupId: "group-1",
          workDir: process.cwd(),
          userMessage: "run it",
          source: "webui",
          allowWebAccess: false,
          onProgress: () => undefined,
          signal: new AbortController().signal,
        },
      )

      expect(result.success).toBe(true)
      expect(seenBefore).toContainEqual({ requestGroupId: "group-1", toolName: "echo_tool" })
      expect(seenAfter).toContainEqual({ requestGroupId: "group-1", toolName: "echo_tool" })
    } finally {
      detachBefore()
      detachAfter()
    }
  })
})
