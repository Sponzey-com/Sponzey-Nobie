import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildPromptSourceContentDiff,
  checkPromptSourceLocaleParity,
  dryRunPromptSourceAssembly,
  loadPromptSourceRegistry,
  rollbackPromptSourceBackup,
  writePromptSourceWithBackup,
} from "../packages/core/src/memory/nobie-md.ts"

const tempDirs: string[] = []

function createPromptFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "nobie-prompt-ops-"))
  tempDirs.push(root)
  const promptsDir = join(root, "prompts")
  mkdirSync(promptsDir)
  for (const [filename, title] of [
    ["definitions.md", "Definitions"],
    ["identity.md", "Identity"],
    ["user.md", "User"],
    ["soul.md", "Soul"],
    ["planner.md", "Planner"],
    ["memory_policy.md", "Memory Policy"],
    ["tool_policy.md", "Tool Policy"],
    ["web_retrieval_planner.md", "Web Retrieval Recovery Planner"],
    ["recovery_policy.md", "Recovery Policy"],
    ["completion_policy.md", "Completion Policy"],
    ["output_policy.md", "Output Policy"],
    ["channel.md", "Channel Policy"],
    ["bootstrap.md", "Bootstrap"],
  ] as const) {
    writeFileSync(join(promptsDir, filename), `# ${title}\n\n## 기준\n\n${filename} content\n`, "utf-8")
  }
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("prompt source operations", () => {
  it("builds prompt diffs and dry-run assembly order without executing a run", () => {
    const root = createPromptFixture()
    const diff = buildPromptSourceContentDiff("# A\nold\n", "# A\nnew\nadded\n")

    expect(diff.changed).toBe(true)
    expect(diff.lines).toEqual(expect.arrayContaining([
      { kind: "changed", beforeLine: 2, afterLine: 2, before: "old", after: "new" },
      { kind: "added", afterLine: 3, after: "added" },
    ]))

    const dryRun = dryRunPromptSourceAssembly(root)
    expect(dryRun.assembly?.snapshot.sources.map((source) => source.sourceId)).toEqual([
      "definitions",
      "identity",
      "user",
      "soul",
      "planner",
      "memory_policy",
      "tool_policy",
      "recovery_policy",
      "completion_policy",
      "output_policy",
      "channel",
    ])
    expect(dryRun.sourceOrder[0]).toMatchObject({ sourceId: "definitions", locale: "en" })
    expect(dryRun.totalChars).toBeGreaterThan(0)
  })

  it("writes prompt source changes with backup and rolls back to the previous checksum", () => {
    const root = createPromptFixture()
    const promptPath = join(root, "prompts", "identity.md")
    const beforeContent = readFileSync(promptPath, "utf-8")

    const writeResult = writePromptSourceWithBackup({
      workDir: root,
      sourceId: "identity",
      locale: "en",
      content: "# Identity\n\n## Rules\n\nUser edited copy\n",
    })

    expect(writeResult.backup).toBeTruthy()
    expect(writeResult.source.checksum).toBe(writeResult.diff.afterChecksum)
    expect(writeResult.diff.beforeChecksum).not.toBe(writeResult.diff.afterChecksum)
    expect(writeResult.backup?.backupPath && existsSync(writeResult.backup.backupPath)).toBe(true)
    expect(readFileSync(promptPath, "utf-8")).toContain("User edited copy")

    const rollback = rollbackPromptSourceBackup({
      sourcePath: writeResult.backup!.sourcePath,
      backupPath: writeResult.backup!.backupPath,
    })

    expect(rollback.restoredChecksum).toBe(writeResult.diff.beforeChecksum)
    expect(rollback.previousChecksum).toBe(writeResult.diff.afterChecksum)
    expect(readFileSync(promptPath, "utf-8")).toBe(beforeContent)
  })

  it("rejects unsafe source writes and reports locale parity gaps", () => {
    const root = createPromptFixture()
    expect(() => writePromptSourceWithBackup({
      workDir: root,
      sourceId: "identity",
      locale: "en",
      content: "# identity\n\napi_key = sk-abcdefghijklmnopqrstuvwxyz123456",
    })).toThrow(/secret-like/iu)

    rmSync(join(root, "prompts", "planner.md"))
    const parity = checkPromptSourceLocaleParity(root)
    expect(parity.ok).toBe(false)
    expect(parity.issues).toContainEqual({
      sourceId: "planner",
      code: "missing_locale",
      locale: "en",
      message: "planner is missing English source",
    })
    expect(loadPromptSourceRegistry(root).some((source) => source.sourceId === "identity")).toBe(true)
  })
})
