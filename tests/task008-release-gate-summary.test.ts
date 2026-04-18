import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.ts"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"
import { buildReleaseManifest } from "../packages/core/src/release/package.ts"
import {
  buildWebRetrievalReleaseGateSummary,
  loadWebRetrievalFixturesFromDir,
  runWebRetrievalFixtureRegression,
} from "../packages/core/src/runs/web-retrieval-smoke.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const filePath = join(rootDir, ...relativePath.split("/"))
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf-8")
}

function createReleaseRoot(): string {
  const rootDir = tempDir("nobie-task008-release-root-")
  writeFile(rootDir, "package.json", JSON.stringify({ version: "9.9.9" }))
  writeFile(rootDir, "packages/cli/dist/index.js", "console.log('cli')\n")
  writeFile(rootDir, "packages/core/dist/index.js", "export const core = true\n")
  writeFile(rootDir, "packages/webui/dist/index.html", "<html></html>\n")
  writeFile(rootDir, "packages/core/src/db/migrations.ts", "export const MIGRATIONS = []\n")
  writeFile(rootDir, "Yeonjang/src/protocol.rs", "pub struct Request;\n")
  writeFile(rootDir, "Yeonjang/manifests/permissions.json", "{}\n")
  writeFile(rootDir, "scripts/build-yeonjang-macos.sh", "#!/usr/bin/env bash\n")
  writeFile(rootDir, "scripts/start-yeonjang-macos.sh", "#!/usr/bin/env bash\n")
  writeFile(rootDir, "scripts/build-yeonjang-windows.bat", "@echo off\n")
  writeFile(rootDir, "scripts/start-yeonjang-windows.bat", "@echo off\n")
  writeFile(rootDir, "scripts/stop-yeonjang-windows.bat", "@echo off\n")
  writeFile(rootDir, "docs/release-runbook.md", "# Release Runbook\n")
  ensurePromptSourceFiles(rootDir)
  return rootDir
}

beforeEach(() => {
  closeDb()
  const stateDir = tempDir("nobie-task008-state-")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
  getDb()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task008 release gate summary", () => {
  it("includes retrieval policy, adapter checksum, fixture regression, and warning-only live smoke absence", () => {
    const rootDir = createReleaseRoot()
    const sourceFixtures = loadWebRetrievalFixturesFromDir(join(process.cwd(), "tests", "fixtures", "web-retrieval"))
    mkdirSync(join(rootDir, "tests", "fixtures", "web-retrieval"), { recursive: true })
    writeFile(rootDir, "tests/fixtures/web-retrieval/kospi.json", JSON.stringify(sourceFixtures[0], null, 2))

    const manifest = buildReleaseManifest({
      rootDir,
      releaseVersion: "v-task008",
      gitTag: "v-task008",
      gitCommit: "abc1234",
      targetPlatforms: ["macos"],
      now: new Date("2026-04-18T00:00:00.000Z"),
    })

    expect(manifest.webRetrievalEvidence.policyVersion).toContain("task009")
    expect(manifest.webRetrievalEvidence.sourceAdapters.adapters[0]).toEqual(expect.objectContaining({ checksum: expect.any(String), parserVersion: expect.any(String) }))
    expect(manifest.webRetrievalEvidence.fixtureRegression?.status).toBe("passed")
    expect(manifest.webRetrievalEvidence.gateStatus).toBe("warning")
    expect(manifest.webRetrievalEvidence.warnings).toContain("live_smoke_not_run")
    expect(manifest.pipeline.order).toContain("web-retrieval-fixture-regression")
    expect(manifest.pipeline.order).toContain("web-retrieval-live-smoke")
    expect(manifest.cleanInstallChecklist.some((item) => item.id === "web-retrieval-fixtures" && item.required)).toBe(true)
  })

  it("fails the release gate when fixture regression catches early surrender", () => {
    const fixture = loadWebRetrievalFixturesFromDir(join(process.cwd(), "tests", "fixtures", "web-retrieval"))
      .find((item) => item.id === "no-network-limited-completion")
    if (!fixture) throw new Error("missing no-network fixture")
    const regression = runWebRetrievalFixtureRegression([{ ...fixture, sources: fixture.sources.slice(0, 1) }])

    const gate = buildWebRetrievalReleaseGateSummary({ fixtureRegression: regression, liveSmoke: null })

    expect(gate.gateStatus).toBe("failed")
    expect(gate.blockingFailures.join("\n")).toContain("early_stop_before_minimum_ladder")
  })
})
