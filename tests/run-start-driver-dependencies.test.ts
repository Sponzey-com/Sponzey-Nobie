import { describe, expect, it, vi } from "vitest"
import { buildStartRootRunDriverDependencies } from "../packages/core/src/runs/start-driver-dependencies.js"

describe("start driver dependencies", () => {
  it("tracks synthetic approval scopes and builds delegation state accessors", () => {
    const scopes = new Set<string>()
    const { driverDependencies, finalizationDependencies } = buildStartRootRunDriverDependencies({
      runId: "run-1",
      sessionId: "session-1",
      requestGroupId: "group-1",
      source: "webui",
      onChunk: undefined,
      message: "hello",
      model: "gpt-test",
      workDir: "/tmp",
      reuseConversationContext: false,
      activeQueueCancellationMode: null,
      startNestedRootRun: vi.fn(() => ({ finished: Promise.resolve(undefined) })),
      syntheticApprovalScopes: scopes,
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    })

    expect(driverDependencies.getSyntheticApprovalAlreadyApproved()).toBe(false)
    driverDependencies.rememberRunApprovalScope("run-1")
    expect(scopes.has("run-1")).toBe(true)
    expect(driverDependencies.getSyntheticApprovalAlreadyApproved()).toBe(true)
    expect(typeof driverDependencies.getDelegationTurnState().maxTurns).toBe("number")
    expect(finalizationDependencies.appendRunEvent).toBeTypeOf("function")
  })
})
