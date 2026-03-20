import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { loadMergedInstructions } from "../packages/core/src/instructions/merge.ts"

const tempDirs: string[] = []
let previousStateDir = process.env["NOBIE_STATE_DIR"]

afterEach(() => {
  process.env["NOBIE_STATE_DIR"] = previousStateDir
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("loadMergedInstructions", () => {
  it("merges global and project instructions while preserving order", () => {
    const root = mkdtempSync(join(tmpdir(), "nobie-instruction-merge-"))
    tempDirs.push(root)

    const stateDir = join(root, "state")
    const repoDir = join(root, "repo")
    const nestedDir = join(repoDir, "apps", "web")

    mkdirSync(stateDir, { recursive: true })
    mkdirSync(join(repoDir, ".git"), { recursive: true })
    mkdirSync(nestedDir, { recursive: true })

    writeFileSync(join(stateDir, "AGENTS.md"), "global rule", "utf-8")
    writeFileSync(join(repoDir, "AGENTS.md"), "repo rule", "utf-8")
    writeFileSync(join(nestedDir, "AGENTS.override.md"), "nested override", "utf-8")

    process.env["NOBIE_STATE_DIR"] = stateDir
    const bundle = loadMergedInstructions(nestedDir)

    expect(bundle.mergedText).toContain("global rule")
    expect(bundle.mergedText).toContain("repo rule")
    expect(bundle.mergedText).toContain("nested override")

    const globalIndex = bundle.mergedText.indexOf("global rule")
    const repoIndex = bundle.mergedText.indexOf("repo rule")
    const nestedIndex = bundle.mergedText.indexOf("nested override")

    expect(globalIndex).toBeLessThan(repoIndex)
    expect(repoIndex).toBeLessThan(nestedIndex)
  })

  it("invalidates cached instructions immediately when source content changes", () => {
    const root = mkdtempSync(join(tmpdir(), "nobie-instruction-cache-"))
    tempDirs.push(root)

    const stateDir = join(root, "state")
    const repoDir = join(root, "repo")

    mkdirSync(stateDir, { recursive: true })
    mkdirSync(join(repoDir, ".git"), { recursive: true })

    const globalPath = join(stateDir, "AGENTS.md")
    writeFileSync(globalPath, "global v1", "utf-8")

    process.env["NOBIE_STATE_DIR"] = stateDir
    const first = loadMergedInstructions(repoDir)
    expect(first.mergedText).toContain("global v1")

    writeFileSync(globalPath, "global v2", "utf-8")
    const second = loadMergedInstructions(repoDir)

    expect(second.mergedText).toContain("global v2")
    expect(second.mergedText).not.toContain("global v1")
  })
})
