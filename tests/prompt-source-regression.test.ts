import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"
import { runPromptSourceRegression } from "../packages/core/src/memory/prompt-regression.ts"

const tempDirs: string[] = []

function createSeededPromptRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "nobie-prompt-regression-"))
  tempDirs.push(root)
  ensurePromptSourceFiles(root)
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("prompt source regression suite", () => {
  it("passes the repository prompt sources for responsibility split and impact markers", () => {
    const result = runPromptSourceRegression(process.cwd())

    expect(result.ok, JSON.stringify(result.issues, null, 2)).toBe(true)
    expect(result.registry.sourceCount).toBeGreaterThanOrEqual(13)
    expect(result.responsibility.every((rule) => rule.ok)).toBe(true)
    expect(result.impact.every((scenario) => scenario.ok)).toBe(true)
  })

  it("detects duplicated identity definitions outside identity", () => {
    const root = createSeededPromptRoot()
    const soulPath = join(root, "prompts", "soul.md")
    writeFileSync(soulPath, `${readFileSync(soulPath, "utf-8")}\n- Default name: Bad Duplicate\n`, "utf-8")

    const result = runPromptSourceRegression(root, { locales: ["en"] })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "name_definition_outside_identity", sourceId: "soul", locale: "en" }),
    ]))
  })

  it("detects missing impact markers before prompt changes can ship", () => {
    const root = createSeededPromptRoot()
    const completionPath = join(root, "prompts", "completion_policy.md")
    const content = readFileSync(completionPath, "utf-8").replace(/- Text-only answers?.*\n/iu, "")
    writeFileSync(completionPath, content, "utf-8")

    const result = runPromptSourceRegression(root, { locales: ["en"] })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "impact_marker_missing", evidence: "text_answer_does_not_trigger_artifact_recovery", locale: "en" }),
    ]))
  })
})
