import { describe, expect, it } from "vitest"
import {
  buildOrchestrationEntityId,
  generateOrchestrationEntityId,
  isLegacyOrchestrationId,
  isOrchestrationEntityId,
  slugifyOrchestrationSegment,
} from "../packages/webui/src/lib/orchestration-id.ts"

function suffixSequence(values: string[]): () => string {
  let index = 0
  return () => {
    const next = values[index]
    index += 1
    return next ?? ""
  }
}

describe("task001 orchestration id generation", () => {
  it("slugifies display names and keeps the generated id within the new prefix policy", () => {
    const generated = generateOrchestrationEntityId({
      kind: "agent",
      displayName: "Weather Review Agent!!!",
      randomSuffix: () => "k4m2",
    })

    expect(generated).toBe("agent-weather-review-agent-k4m2")
    expect(isOrchestrationEntityId(generated, "agent")).toBe(true)
    expect(generated.length).toBeLessThanOrEqual(64)
  })

  it("retries suffix generation when registry and draft ids already contain the candidate", () => {
    const generated = generateOrchestrationEntityId({
      kind: "team",
      displayName: "Research Core",
      existingIds: ["team-research-core-0001", "team-research-core-0002"],
      draftIds: ["team-research-core-0003"],
      randomSuffix: suffixSequence(["0001", "0002", "0003", "7d1p"]),
    })

    expect(generated).toBe("team-research-core-7d1p")
  })

  it("keeps legacy colon ids readable while validating only the new hyphen format", () => {
    expect(isLegacyOrchestrationId("agent:researcher")).toBe(true)
    expect(isLegacyOrchestrationId("team:research-core")).toBe(true)
    expect(isOrchestrationEntityId("agent:researcher", "agent")).toBe(false)
    expect(isOrchestrationEntityId("agent-researcher-k4m2", "agent")).toBe(true)
    expect(buildOrchestrationEntityId("team", slugifyOrchestrationSegment("Ops Night", "team"), "4hqs")).toBe("team-ops-night-4hqs")
  })
})
