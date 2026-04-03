import { describe, expect, it, vi } from "vitest"
import { createExecutionChunkStream } from "../packages/core/src/runs/execution-runtime.ts"

describe("execution runtime helper", () => {
  it("always routes execution through the configured AI agent runtime", async () => {
    const runAgent = vi.fn(async function* () {
      yield { type: "text", delta: "agent" } as const
    })

    const stream = createExecutionChunkStream({
      userMessage: "do work",
      memorySearchQuery: "original request",
      sessionId: "session-1",
      runId: "run-1",
      workDir: process.cwd(),
      source: "cli",
      signal: new AbortController().signal,
      isRootRequest: true,
      requestGroupId: "group-1",
      contextMode: "full",
    }, {
      runAgent,
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(runAgent).toHaveBeenCalledOnce()
    expect(runAgent.mock.calls[0]?.[0].userMessage).toBe("do work")
    expect(chunks).toEqual([{ type: "text", delta: "agent" }])
  })

  it("routes normal execution through runAgent and preserves request group for followups", async () => {
    const runAgent = vi.fn(async function* () {
      yield { type: "text", delta: "agent" } as const
    })

    const stream = createExecutionChunkStream({
      userMessage: "follow up",
      memorySearchQuery: "original request",
      sessionId: "session-2",
      runId: "run-2",
      workDir: process.cwd(),
      source: "webui",
      signal: new AbortController().signal,
      toolsEnabled: true,
      isRootRequest: false,
      requestGroupId: "group-2",
      contextMode: "summary",
    }, {
      runAgent,
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(runAgent).toHaveBeenCalledOnce()
    expect(runAgent.mock.calls[0]?.[0].requestGroupId).toBe("group-2")
    expect(runAgent.mock.calls[0]?.[0].memorySearchQuery).toBe("original request")
    expect(chunks).toEqual([{ type: "text", delta: "agent" }])
  })
})
