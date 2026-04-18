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
    ["definitions.md", "정의"],
    ["definitions.md.en", "Definitions"],
    ["identity.md", "정체성"],
    ["identity.md.en", "Identity"],
    ["user.md", "사용자"],
    ["user.md.en", "User"],
    ["soul.md", "소울"],
    ["soul.md.en", "Soul"],
    ["planner.md", "플래너"],
    ["planner.md.en", "Planner"],
    ["memory_policy.md", "메모리 정책"],
    ["memory_policy.md.en", "Memory Policy"],
    ["tool_policy.md", "도구 정책"],
    ["tool_policy.md.en", "Tool Policy"],
    ["web_retrieval_planner.md", "웹 검색 회복 플래너"],
    ["web_retrieval_planner.md.en", "Web Retrieval Recovery Planner"],
    ["recovery_policy.md", "복구 정책"],
    ["recovery_policy.md.en", "Recovery Policy"],
    ["completion_policy.md", "완료 정책"],
    ["completion_policy.md.en", "Completion Policy"],
    ["output_policy.md", "출력 정책"],
    ["output_policy.md.en", "Output Policy"],
    ["channel.md", "채널 정책"],
    ["channel.md.en", "Channel Policy"],
    ["bootstrap.md", "부트스트랩"],
    ["bootstrap.md.en", "Bootstrap"],
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
    expect(dryRun.sourceOrder[0]).toMatchObject({ sourceId: "definitions", locale: "ko" })
    expect(dryRun.totalChars).toBeGreaterThan(0)
  })

  it("writes prompt source changes with backup and rolls back to the previous checksum", () => {
    const root = createPromptFixture()
    const promptPath = join(root, "prompts", "identity.md")
    const beforeContent = readFileSync(promptPath, "utf-8")

    const writeResult = writePromptSourceWithBackup({
      workDir: root,
      sourceId: "identity",
      locale: "ko",
      content: "# 정체성\n\n## 기준\n\n사용자 수정본\n",
    })

    expect(writeResult.backup).toBeTruthy()
    expect(writeResult.source.checksum).toBe(writeResult.diff.afterChecksum)
    expect(writeResult.diff.beforeChecksum).not.toBe(writeResult.diff.afterChecksum)
    expect(writeResult.backup?.backupPath && existsSync(writeResult.backup.backupPath)).toBe(true)
    expect(readFileSync(promptPath, "utf-8")).toContain("사용자 수정본")

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
      locale: "ko",
      content: "# identity\n\napi_key = sk-abcdefghijklmnopqrstuvwxyz123456",
    })).toThrow(/secret-like/iu)

    rmSync(join(root, "prompts", "planner.md.en"))
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
