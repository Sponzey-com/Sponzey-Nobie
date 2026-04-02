import { describe, expect, it, vi } from "vitest"
import { createExecutionChunkStream } from "../packages/core/src/runs/execution-runtime.ts"

describe("execution runtime helper", () => {
  it("routes worker runtime execution through runWorkerRuntime", async () => {
    const runWorkerRuntime = vi.fn(async function* () {
      yield { type: "text", delta: "worker" } as const
    })
    const runAgent = vi.fn(async function* () {
      yield { type: "text", delta: "agent" } as const
    })

    const stream = createExecutionChunkStream({
      workerRuntime: {
        kind: "claude_code",
        targetId: "worker:claude_code",
        label: "코드 작업 세션",
        command: "claude",
      },
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
      runWorkerRuntime,
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(runWorkerRuntime).toHaveBeenCalledOnce()
    expect(runAgent).not.toHaveBeenCalled()
    expect(runWorkerRuntime.mock.calls[0]?.[0].prompt).toContain("do work")
    expect(chunks).toEqual([{ type: "text", delta: "worker" }])
  })

  it("routes normal execution through runAgent and preserves request group for followups", async () => {
    const runWorkerRuntime = vi.fn(async function* () {
      yield { type: "text", delta: "worker" } as const
    })
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
      runWorkerRuntime,
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(runAgent).toHaveBeenCalledOnce()
    expect(runWorkerRuntime).not.toHaveBeenCalled()
    expect(runAgent.mock.calls[0]?.[0].requestGroupId).toBe("group-2")
    expect(runAgent.mock.calls[0]?.[0].memorySearchQuery).toBe("original request")
    expect(chunks).toEqual([{ type: "text", delta: "agent" }])
  })
})
