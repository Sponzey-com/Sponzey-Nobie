import { describe, expect, it, vi } from "vitest"
import { applyRootRunDriverFailure } from "../packages/core/src/runs/root-run-driver-failure.ts"

describe("apply root run driver failure", () => {
  it("applies fatal failure and delivers an error chunk", async () => {
    const moduleDependencies = {
      applyFatalFailure: vi.fn(),
      deliverChunk: vi.fn(async () => undefined),
    }

    await applyRootRunDriverFailure({
      runId: "run-1",
      sessionId: "session-1",
      source: "cli",
      onChunk: undefined,
      aborted: false,
      message: "boom",
    }, {
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunFailure: vi.fn(),
      markAbortedRunCancelledIfActive: vi.fn(),
      onDeliveryError: vi.fn(),
    }, moduleDependencies as any)

    expect(moduleDependencies.applyFatalFailure).toHaveBeenCalledTimes(1)
    expect(moduleDependencies.deliverChunk).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      chunk: { type: "error", message: "boom" },
    }))
  })
})
