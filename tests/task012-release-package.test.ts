import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PATHS, reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.ts"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"
import {
  buildReleaseManifest,
  buildReleasePipelinePlan,
  buildReleaseRollbackRunbook,
  buildReleaseUpdatePreflightReport,
  writeReleasePackage,
} from "../packages/core/src/release/package.ts"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const filePath = join(rootDir, ...relativePath.split("/"))
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf-8")
}

function createReleaseFixture(): string {
  const rootDir = makeTempDir("nobie-task012-release-root-")
  writeFile(rootDir, "package.json", JSON.stringify({ version: "9.9.9" }))
  writeFile(rootDir, "packages/cli/dist/index.js", "#!/usr/bin/env node\nconsole.log('cli')\n")
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
  const stateDir = makeTempDir("nobie-task012-state-")
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
  getDb()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) process.env.NOBIE_STATE_DIR = undefined
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) process.env.NOBIE_CONFIG = undefined
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task012 release package", () => {
  it("builds a git-tag-based release manifest with required artifacts and checksums", () => {
    const rootDir = createReleaseFixture()
    const manifest = buildReleaseManifest({
      rootDir,
      releaseVersion: "v1.2.3-test",
      gitTag: "v1.2.3-test",
      gitCommit: "abc1234",
      targetPlatforms: ["macos", "windows"],
      now: new Date("2026-04-16T00:00:00.000Z"),
    })

    expect(manifest.kind).toBe("nobie.release.package")
    expect(manifest.releaseVersion).toBe("v1.2.3-test")
    expect(manifest.gitTag).toBe("v1.2.3-test")
    expect(manifest.requiredMissing).toEqual([])
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "gateway:cli",
          status: "present",
          checksum: expect.any(String),
        }),
        expect.objectContaining({
          id: "webui:static",
          status: "present",
          checksum: expect.any(String),
        }),
        expect.objectContaining({
          id: "db:migrations",
          status: "present",
          checksum: expect.any(String),
        }),
        expect.objectContaining({
          id: "yeonjang:protocol",
          status: "present",
          checksum: expect.any(String),
        }),
        expect.objectContaining({
          id: "runbook:release",
          status: "present",
          checksum: expect.any(String),
        }),
        expect.objectContaining({ id: "admin:diagnostic-bundle", status: "missing_optional" }),
      ]),
    )
    expect(
      manifest.artifacts.some(
        (artifact) => artifact.kind === "prompt_seed" && artifact.status === "present",
      ),
    ).toBe(true)
    expect(
      manifest.featureFlags.some((flag) => flag.featureKey === "sub_agent_orchestration"),
    ).toBe(true)
    expect(manifest.performanceEvidence.kind).toBe("nobie.release.performance")
    expect(manifest.releaseNotes.featureFlagDefaults.join("\n")).toContain(
      "sub_agent_orchestration",
    )
    expect(manifest.pipeline.order).toContain("backup-rehearsal")
    expect(manifest.pipeline.order).toContain("channel-smoke-dry-run")
    expect(manifest.updatePreflight.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "node-22",
        "command:pnpm",
        "command:cargo",
        "os-supported",
        "write-permission",
        "prompt-seed",
        "yeonjang-protocol",
        "db-backup-required",
      ]),
    )
    expect(manifest.rollback.restoreTargets).toEqual(
      expect.arrayContaining([expect.stringContaining("DB")]),
    )
    expect(
      manifest.cleanInstallChecklist.some((item) => item.id === "db-migration" && item.required),
    ).toBe(true)
  })

  it("writes release manifest, checksum file, and copied payload", () => {
    const rootDir = createReleaseFixture()
    const outputDir = makeTempDir("nobie-task012-release-output-")
    const result = writeReleasePackage({
      rootDir,
      outputDir,
      releaseVersion: "v1.2.3-test",
      gitTag: "v1.2.3-test",
      gitCommit: "abc1234",
      targetPlatforms: ["macos", "windows"],
      copyPayload: true,
    })

    expect(existsSync(result.manifestPath)).toBe(true)
    expect(existsSync(result.checksumPath)).toBe(true)
    expect(
      existsSync(join(outputDir, "payload", "gateway", "packages", "cli", "dist", "index.js")),
    ).toBe(true)
    expect(existsSync(join(outputDir, "payload", "webui", "dist", "index.html"))).toBe(true)
    expect(readFileSync(result.checksumPath, "utf-8")).toContain(
      "gateway/packages/cli/dist/index.js",
    )
    expect(result.copiedArtifacts.length).toBeGreaterThan(5)
  })

  it("keeps release pipeline and rollback runbook explicit", () => {
    const pipeline = buildReleasePipelinePlan({ targetPlatforms: ["macos", "windows", "linux"] })
    const runbook = buildReleaseRollbackRunbook()
    const preflight = buildReleaseUpdatePreflightReport({
      rootDir: createReleaseFixture(),
      targetPlatforms: ["macos"],
      promptSourceCount: 2,
    })

    expect(pipeline.steps.map((step) => step.id)).toEqual([
      "environment-preflight",
      "clean-build",
      "typecheck",
      "unit-tests",
      "orchestration-release-gate",
      "memory-isolation-release-gate",
      "capability-isolation-release-gate",
      "model-execution-release-gate",
      "performance-release-gate",
      "web-retrieval-fixture-regression",
      "ui-mode-release-gate",
      "backup-rehearsal",
      "admin-diagnostic-export",
      "channel-smoke-dry-run",
      "yeonjang-macos",
      "yeonjang-windows",
      "yeonjang-linux",
      "package-manifest",
      "rollout-shadow-evidence",
      "plan-drift-evidence",
      "web-retrieval-live-smoke",
      "live-smoke-gate",
    ])
    expect(pipeline.steps.find((step) => step.id === "live-smoke-gate")?.required).toBe(false)
    expect(runbook.restoreTargets.join("\n")).toContain("prompt")
    expect(runbook.restoreTargets.join("\n")).toContain("Yeonjang")
    expect(runbook.retryForbiddenWhen.length).toBeGreaterThan(0)
    expect(preflight.checks.find((check) => check.id === "db-backup-required")).toMatchObject({
      ok: false,
      required: false,
    })
  })

  it("runs release script in dry-run mode and writes manifest evidence", () => {
    const outputDir = makeTempDir("nobie-task012-script-output-")
    const stdout = execFileSync(
      "node",
      [
        "scripts/release-package.mjs",
        "--dry-run",
        "--json",
        "--no-copy",
        "--output-dir",
        outputDir,
        "--platform",
        "macos",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf-8",
      },
    )
    const parsed = JSON.parse(stdout) as {
      dryRun: boolean
      manifestPath: string
      checksumPath: string
      manifest: { kind: string; pipeline: { order: string[] } }
    }

    expect(parsed.dryRun).toBe(true)
    expect(parsed.manifest.kind).toBe("nobie.release.package")
    expect(parsed.manifest.pipeline.order).toContain("package-manifest")
    expect(existsSync(parsed.manifestPath)).toBe(true)
    expect(existsSync(parsed.checksumPath)).toBe(true)
  })
})
