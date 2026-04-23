import { describe, expect, it } from "vitest"
import type { ToolContext } from "../packages/core/src/tools/types.ts"
import {
  buildYeonjangRequestMetadata,
  withYeonjangRequestMetadata,
} from "../packages/core/src/tools/builtin/yeonjang-request-metadata.ts"

function createContext(): ToolContext {
  return {
    sessionId: "session-1",
    runId: "run-1",
    requestGroupId: "request-group-1",
    workDir: process.cwd(),
    userMessage: "연장 요청 메타 확인",
    source: "telegram",
    allowWebAccess: false,
    onProgress: () => undefined,
    signal: new AbortController().signal,
    agentId: "agent-reviewer",
    auditId: "audit-1",
    capabilityDelegationId: "delegation-1",
  }
}

describe("yeonjang request metadata helper", () => {
  it("builds request lineage metadata from tool context", () => {
    expect(buildYeonjangRequestMetadata(createContext())).toEqual({
      runId: "run-1",
      requestGroupId: "request-group-1",
      sessionId: "session-1",
      source: "telegram",
      agentId: "agent-reviewer",
      auditId: "audit-1",
      capabilityDelegationId: "delegation-1",
    })
  })

  it("merges request lineage metadata into yeonjang client options", () => {
    expect(withYeonjangRequestMetadata(createContext(), {
      extensionId: "yeonjang-main",
      timeoutMs: 15_000,
    })).toEqual({
      extensionId: "yeonjang-main",
      timeoutMs: 15_000,
      metadata: {
        runId: "run-1",
        requestGroupId: "request-group-1",
        sessionId: "session-1",
        source: "telegram",
        agentId: "agent-reviewer",
        auditId: "audit-1",
        capabilityDelegationId: "delegation-1",
      },
    })
  })
})
