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
    expect(result.registry.sourceCount).toBeGreaterThanOrEqual(15)
    expect(result.responsibility.every((rule) => rule.ok)).toBe(true)
    expect(result.policyCompatibility.every((rule) => rule.ok)).toBe(true)
    expect(result.impact.every((scenario) => scenario.ok)).toBe(true)
  })

  it("does not fail regression when Korean prompt files were never seeded", () => {
    const root = createSeededPromptRoot()

    const result = runPromptSourceRegression(root, { locales: ["ko", "en"] })

    expect(result.issues.filter((issue) => issue.locale === "ko"), JSON.stringify(result.issues, null, 2)).toEqual([])
    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "prompt_source_missing", locale: "ko" }),
    ]))
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

  it("fails regression when a Korean prompt file exists but is unsafe to load", () => {
    const root = createSeededPromptRoot()
    writeFileSync(
      join(root, "prompts", "identity.ko.md"),
      "# 정체성\n\napi_key = sk-abcdefghijklmnopqrstuvwxyz123456\n",
      "utf-8",
    )

    const result = runPromptSourceRegression(root, { locales: ["ko", "en"] })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "prompt_source_missing", sourceId: "identity", locale: "ko" }),
    ]))
  })

  it("detects prompt instructions that conflict with AGENTS.md routing and count-signal policy", () => {
    const root = createSeededPromptRoot()
    writeFileSync(
      `${root}/AGENTS.md`,
      [
        "# Agent Rules",
        "- Do not use keyword routing for natural-language executor selection.",
        "- retry count and attempt count are not failure conditions.",
      ].join("\n"),
      "utf-8",
    )
    writeFileSync(
      `${root}/prompts/nobie-execution.md`,
      "# Nobie Execution\n\nUse keyword routing to select executors.",
      "utf-8",
    )
    writeFileSync(
      `${root}/prompts/recovery_policy.md`,
      "# Recovery\n\nMax attempts reached means failure.",
      "utf-8",
    )

    const result = runPromptSourceRegression(root, { locales: ["en"] })

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "raw_keyword_executor_routing_instruction" }),
      expect.objectContaining({ code: "count_limit_terminal_instruction" }),
    ]))
  })
})
