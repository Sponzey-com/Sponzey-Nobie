import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"
import { buildReleaseManifest } from "../packages/core/src/release/package.ts"
import { buildUiModeReleaseGateSummary, buildUiModeSmokeMatrix } from "../packages/core/src/release/ui-mode-gate.ts"

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
  const rootDir = tempDir("nobie-task017-release-root-")
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
  const stateDir = tempDir("nobie-task017-state-")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
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

describe("task017 UI mode release gate", () => {
  it("defines a required smoke matrix for beginner, advanced, and admin modes", () => {
    const matrix = buildUiModeSmokeMatrix()

    expect(matrix.map((scenario) => scenario.mode)).toEqual(["beginner", "advanced", "admin"])
    expect(matrix.every((scenario) => scenario.status === "passed")).toBe(true)
    expect(matrix.find((scenario) => scenario.mode === "beginner")?.steps.map((step) => step.id)).toEqual([
      "first_run",
      "ai_connection",
      "chat_once",
      "approval_once",
      "result_visible",
    ])
    expect(matrix.find((scenario) => scenario.mode === "advanced")?.steps.map((step) => step.id)).toContain("doctor_summary")
    expect(matrix.find((scenario) => scenario.mode === "admin")?.steps.map((step) => step.id)).toEqual([
      "flag_on",
      "timeline",
      "inspectors",
      "export_dry_run",
    ])
  })

  it("summarizes resolver, redaction, admin guard, redirect, and regression blockers", () => {
    const summary = buildUiModeReleaseGateSummary()

    expect(summary.gateStatus).toBe("passed")
    expect(summary.resolver).toEqual(expect.objectContaining({
      defaultMode: "beginner",
      advancedPreferredMode: "advanced",
      adminRequestedWithoutFlag: "beginner",
      adminRequestedWithFlag: "admin",
      adminAvailableOnlyWithFlag: true,
    }))
    expect(summary.adminGuard).toEqual(expect.objectContaining({
      defaultDenied: true,
      developmentRuntimeFlagAllowed: true,
      productionRuntimeFlagWithoutConfigDenied: true,
      productionConfigAndRuntimeFlagAllowed: true,
      passed: true,
    }))
    expect(summary.redaction.every((item) => item.passed)).toBe(true)
    expect(summary.redaction.flatMap((item) => item.forbiddenPatterns)).toEqual([])
    expect(summary.routeRedirects).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "/dashboard", expectedTo: "/advanced/dashboard", actualTo: "/advanced/dashboard", passed: true }),
      expect.objectContaining({ from: "/settings/ai", expectedTo: "/advanced/settings/ai", actualTo: "/advanced/settings/ai", passed: true }),
      expect.objectContaining({ from: "/chat", expectedTo: null, actualTo: null, passed: true }),
    ]))
    expect(summary.regressionGuards.map((guard) => guard.id)).toEqual([
      "ai-connection-save-stability",
      "beginner-raw-error-redaction",
      "admin-disabled-blocks-data",
      "approval-and-final-answer-dedupe",
      "run-state-reversal-guard",
    ])
    expect(summary.blockingFailures).toEqual([])
  })

  it("fails the release gate when a required mode smoke or regression guard fails", () => {
    const smokeFailure = buildUiModeReleaseGateSummary({ smokeOverrides: { beginner: { chat_once: "failed" } } })
    const regressionFailure = buildUiModeReleaseGateSummary({ regressionOverrides: { "approval-and-final-answer-dedupe": "failed" } })

    expect(smokeFailure.gateStatus).toBe("failed")
    expect(smokeFailure.blockingFailures).toContain("ui_mode_smoke_failed:beginner")
    expect(regressionFailure.gateStatus).toBe("failed")
    expect(regressionFailure.blockingFailures).toContain("regression_guard_failed:approval-and-final-answer-dedupe")
  })

  it("includes UI mode evidence in the release manifest and pipeline", () => {
    const rootDir = createReleaseRoot()
    const manifest = buildReleaseManifest({
      rootDir,
      releaseVersion: "v-task017",
      gitTag: "v-task017",
      gitCommit: "def5678",
      targetPlatforms: ["macos"],
      now: new Date("2026-04-18T00:00:00.000Z"),
    })

    expect(manifest.uiModeEvidence.kind).toBe("ui_mode.release_gate")
    expect(manifest.uiModeEvidence.gateStatus).toBe("passed")
    expect(manifest.uiModeEvidence.smokeMatrix.map((scenario) => scenario.mode)).toEqual(["beginner", "advanced", "admin"])
    expect(manifest.pipeline.order).toContain("ui-mode-release-gate")
    expect(manifest.pipeline.steps.find((step) => step.id === "ui-mode-release-gate")).toEqual(expect.objectContaining({
      required: true,
      smoke: false,
      command: ["pnpm", "test", "tests/task017-ui-release-gate.test.ts"],
    }))
    expect(manifest.cleanInstallChecklist.some((item) => item.id === "ui-mode-release-gate" && item.required)).toBe(true)
  })
})
