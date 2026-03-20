import { describe, expect, it } from "vitest"
import { buildTaskIntakeSystemPrompt } from "../packages/core/src/agent/intake-prompt.ts"

describe("buildTaskIntakeSystemPrompt", () => {
  it("includes the required JSON-only output contract", () => {
    const prompt = buildTaskIntakeSystemPrompt()

    expect(prompt).toContain("Always output valid JSON only.")
    expect(prompt).toContain('"action_items": [')
    expect(prompt).toContain('"scheduling": {')
    expect(prompt).toContain('"execution": {')
    expect(prompt).toContain('"needs_web": false')
  })

  it("requires explicit scheduling receipts and statuses", () => {
    const prompt = buildTaskIntakeSystemPrompt()

    expect(prompt).toContain("Scheduling requests must have explicit intake status")
    expect(prompt).toContain("accepted_receipt")
    expect(prompt).toContain("failed_receipt")
    expect(prompt).toContain("clarification_receipt")
    expect(prompt).toContain('"status": "accepted | failed | needs_clarification | not_applicable"')
  })

  it("includes run_task and delegate_agent action item rules", () => {
    const prompt = buildTaskIntakeSystemPrompt()

    expect(prompt).toContain("### type = run_task")
    expect(prompt).toContain("### type = delegate_agent")
    expect(prompt).toContain("task_profile")
    expect(prompt).toContain("review_required")
  })

  it("uses 5 delegation turns by default", () => {
    const prompt = buildTaskIntakeSystemPrompt()

    expect(prompt).toContain("max_delegation_turns = 5")
    expect(prompt).toContain('"max_delegation_turns": 5')
  })

  it("allows delegation turn override in the generated prompt", () => {
    const prompt = buildTaskIntakeSystemPrompt({ maxDelegationTurns: 6 })

    expect(prompt).toContain("max_delegation_turns = 6")
    expect(prompt).toContain('"max_delegation_turns": 6')
  })

  it("documents that 0 means unlimited delegation turns", () => {
    const prompt = buildTaskIntakeSystemPrompt({ maxDelegationTurns: 0 })

    expect(prompt).toContain("max_delegation_turns = 0")
    expect(prompt).toContain("If max_delegation_turns is 0, treat it as unlimited")
  })

  it("makes web usage conditional rather than default", () => {
    const prompt = buildTaskIntakeSystemPrompt()

    expect(prompt).toContain("Set needs_web = true only if")
    expect(prompt).toContain("Do not force web access for ordinary task extraction.")
  })
})
