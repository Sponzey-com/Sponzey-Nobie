import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { discoverInstructionChain } from "../packages/core/src/instructions/discovery.ts"

const tempDirs: string[] = []
let previousStateDir = process.env["NOBIE_STATE_DIR"]

afterEach(() => {
  process.env["NOBIE_STATE_DIR"] = previousStateDir
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("discoverInstructionChain", () => {
  it("discovers global and project instructions in hierarchical order", () => {
    const root = mkdtempSync(join(tmpdir(), "nobie-instructions-"))
    tempDirs.push(root)

    const stateDir = join(root, "state")
    const repoDir = join(root, "repo")
    const serviceDir = join(repoDir, "packages", "service")

    mkdirSync(stateDir, { recursive: true })
    mkdirSync(join(repoDir, ".git"), { recursive: true })
    mkdirSync(serviceDir, { recursive: true })

    writeFileSync(join(stateDir, "AGENTS.md"), "global instructions", "utf-8")
    writeFileSync(join(repoDir, "AGENTS.md"), "repo instructions", "utf-8")
    writeFileSync(join(serviceDir, "AGENTS.override.md"), "service override", "utf-8")

    process.env["NOBIE_STATE_DIR"] = stateDir
    const chain = discoverInstructionChain(serviceDir)

    expect(chain.sources.map((source) => source.path)).toEqual([
      join(stateDir, "AGENTS.md"),
      join(repoDir, "AGENTS.md"),
      join(serviceDir, "AGENTS.override.md"),
    ])
    expect(chain.sources.map((source) => source.scope)).toEqual(["global", "project", "project"])
  })

  it("falls back to parent directory chain when git root is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "nobie-instructions-nogit-"))
    tempDirs.push(root)

    const stateDir = join(root, "state")
    const parentDir = join(root, "workspace")
    const childDir = join(parentDir, "service")

    mkdirSync(stateDir, { recursive: true })
    mkdirSync(childDir, { recursive: true })

    writeFileSync(join(stateDir, "AGENTS.md"), "global instructions", "utf-8")
    writeFileSync(join(parentDir, "AGENTS.md"), "parent instructions", "utf-8")
    writeFileSync(join(childDir, "AGENTS.override.md"), "child override", "utf-8")

    process.env["NOBIE_STATE_DIR"] = stateDir
    const chain = discoverInstructionChain(childDir)

    expect(chain.sources.map((source) => source.path)).toEqual([
      join(stateDir, "AGENTS.md"),
      join(parentDir, "AGENTS.md"),
      join(childDir, "AGENTS.override.md"),
    ])
  })
})
