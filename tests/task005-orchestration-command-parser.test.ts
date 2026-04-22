import { describe, expect, it } from "vitest"
import { parseOrchestrationCreateCommand } from "../packages/webui/src/lib/orchestration-command-parser.ts"

describe("task005 orchestration command parser", () => {
  it("parses deterministic team starters with explicit counts", () => {
    expect(parseOrchestrationCreateCommand("research team 3")).toEqual({
      status: "success",
      normalizedInput: "research team 3",
      starterKitId: "research_team",
      count: 3,
      pattern: "team",
    })
  })

  it("maps workspace operator pair to the workspace starter kit", () => {
    expect(parseOrchestrationCreateCommand("workspace operator pair")).toEqual({
      status: "success",
      normalizedInput: "workspace operator pair",
      starterKitId: "workspace_operator_pair",
      count: 2,
      pattern: "pair",
    })
  })

  it("keeps role-only and group-only commands in an ambiguity state instead of guessing silently", () => {
    expect(parseOrchestrationCreateCommand("review")).toEqual({
      status: "ambiguous",
      normalizedInput: "review",
      reason: "role_without_group",
      suggestedStarterKitId: "review_squad",
      suggestedCount: 3,
    })
    expect(parseOrchestrationCreateCommand("team 2")).toEqual({
      status: "ambiguous",
      normalizedInput: "team 2",
      reason: "group_without_role",
      suggestedStarterKitId: "research_team",
      suggestedCount: 2,
    })
  })

  it("separates empty, invalid-count, and unsupported input", () => {
    expect(parseOrchestrationCreateCommand("")).toEqual({
      status: "error",
      normalizedInput: "",
      reason: "empty",
    })
    expect(parseOrchestrationCreateCommand("research team 0")).toEqual({
      status: "error",
      normalizedInput: "research team 0",
      reason: "invalid_count",
    })
    expect(parseOrchestrationCreateCommand("banana lab")).toEqual({
      status: "error",
      normalizedInput: "banana lab",
      reason: "unsupported",
    })
  })
})
