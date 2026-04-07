import { describe, expect, it } from "vitest"
import { buildWorkerSessionId } from "../packages/core/src/runs/start-support.ts"

describe("run start support", () => {
  it("creates separate worker sessions per run instead of per request group", () => {
    const first = buildWorkerSessionId({
      runId: "run-alpha-12345678",
      isRootRequest: false,
      requestGroupId: "group-shared",
      taskProfile: "operations",
      targetId: "provider:ollama",
    })

    const second = buildWorkerSessionId({
      runId: "run-beta-87654321",
      isRootRequest: false,
      requestGroupId: "group-shared",
      taskProfile: "operations",
      targetId: "provider:ollama",
    })

    expect(first).toBe("B-run-alph-local-ops-ollama")
    expect(second).toBe("B-run-beta-local-ops-ollama")
    expect(first).not.toBe(second)
  })
})
