import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const guardedFiles = [
  "packages/core/src/runs/execution-policy.ts",
  "packages/core/src/runs/terminal-failure-guard.ts",
  "packages/core/src/runs/recovery-controller.ts",
  "packages/core/src/topology/graph-execution-plan.ts",
  "packages/core/src/topology/graph-execution-runner.ts",
  "packages/core/src/topology/graph-execution-store.ts",
]

const forbiddenTerminalSnippets = [
  "terminalReason: \"retry_exhausted\"",
  "terminalReason: \"max_attempts_reached\"",
  "terminalReason: \"retry_budget_exhausted\"",
  "terminalReason: \"delegation_turns_exhausted\"",
  "terminalReason: \"too_many_failures\"",
  "status: \"failed\", terminalReason: \"retry_exhausted\"",
  "status: \"failed\", terminalReason: \"max_attempts_reached\"",
]

describe("phase021 count-limit static gate", () => {
  it("prevents count-based reasons from being introduced as terminal failure outputs", () => {
    for (const file of guardedFiles) {
      const source = readFileSync(file, "utf8")
      for (const snippet of forbiddenTerminalSnippets) {
        expect(source, `${file} must not contain ${snippet}`).not.toContain(snippet)
      }
    }
  })
})
