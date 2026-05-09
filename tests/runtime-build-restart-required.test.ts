import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildRuntimeBuildStatus } from "../packages/core/src/runtime/build-status.ts"
import {
  createDryRunChannelSmokeExecutor,
  getDefaultChannelSmokeScenarios,
  validateChannelSmokeTrace,
} from "../packages/core/src/channels/smoke-runner.ts"

const tempDirs: string[] = []

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "nobie-runtime-build-"))
  tempDirs.push(root)
  return root
}

function writeMtimeFile(path: string, mtimeMs: number): void {
  writeFileSync(path, `mtime:${mtimeMs}\n`)
  const date = new Date(mtimeMs)
  utimesSync(path, date, date)
}

function createPackage(root: string, pkg: "core" | "cli", sourceMtimeMs: number, distMtimeMs: number): void {
  const sourceDir = join(root, "packages", pkg, "src")
  const distDir = join(root, "packages", pkg, "dist")
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(distDir, { recursive: true })
  writeMtimeFile(join(sourceDir, `${pkg}.ts`), sourceMtimeMs)
  writeMtimeFile(join(distDir, `${pkg}.js`), distMtimeMs)
}

function statusFor(root: string, processStartTimeMs: number) {
  return buildRuntimeBuildStatus({
    workspaceRoot: root,
    processStartTimeMs,
    now: new Date("2026-05-08T00:00:00.000Z"),
    commandRunner: (_command, args) => {
      if (args.join(" ") === "rev-parse HEAD") return "0123456789abcdef0123456789abcdef01234567"
      if (args.join(" ") === "describe --tags --always --dirty") return "v0.1.0-test"
      return null
    },
  })
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("runtime build/restart required status", () => {
  it("marks restart required when dist is newer than the Gateway process start", () => {
    const root = fixtureRoot()
    createPackage(root, "core", 10_000, 20_000)
    createPackage(root, "cli", 10_000, 12_000)

    const status = statusFor(root, 15_000)

    expect(status.restartRequired).toBe(true)
    expect(status.buildRequired).toBe(false)
    expect(status.warnings).toContain("restart_required")
    expect(status.packages.find((pkg) => pkg.package === "core")?.restartRequired).toBe(true)
    expect(status.buildId).toBe("v0.1.0-test")
  })

  it("marks build required when source is newer than dist", () => {
    const root = fixtureRoot()
    createPackage(root, "core", 30_000, 20_000)
    createPackage(root, "cli", 10_000, 20_000)

    const status = statusFor(root, 40_000)

    expect(status.buildRequired).toBe(true)
    expect(status.restartRequired).toBe(false)
    expect(status.warnings).toContain("build_required")
    expect(status.packages.find((pkg) => pkg.package === "core")?.buildRequired).toBe(true)
  })

  it("does not mark build required when only declaration files are newer than dist", () => {
    const root = fixtureRoot()
    createPackage(root, "core", 10_000, 20_000)
    createPackage(root, "cli", 10_000, 20_000)
    const runtimeDir = join(root, "packages", "core", "src", "runtime")
    mkdirSync(runtimeDir, { recursive: true })
    writeMtimeFile(join(runtimeDir, "generated.d.ts"), 30_000)

    const status = statusFor(root, 40_000)

    expect(status.buildRequired).toBe(false)
    expect(status.restartRequired).toBe(false)
    expect(status.warnings).not.toContain("build_required")
    expect(status.packages.find((pkg) => pkg.package === "core")?.sourceNewest?.path).toBe(
      join(root, "packages", "core", "src", "core.ts"),
    )
  })

  it("marks build required when a source file has no compiled dist output", () => {
    const root = fixtureRoot()
    createPackage(root, "core", 10_000, 20_000)
    createPackage(root, "cli", 10_000, 20_000)
    const newSource = join(root, "packages", "core", "src", "runtime", "new-helper.ts")
    mkdirSync(join(root, "packages", "core", "src", "runtime"), { recursive: true })
    writeMtimeFile(newSource, 12_000)

    const status = statusFor(root, 30_000)

    expect(status.buildRequired).toBe(true)
    expect(status.packages.find((pkg) => pkg.package === "core")?.missingOutputs).toEqual([
      join(root, "packages", "core", "dist", "runtime", "new-helper.js"),
    ])
  })

  it("documents that restart clears restart required once process start is newer than dist", () => {
    const root = fixtureRoot()
    createPackage(root, "core", 10_000, 20_000)
    createPackage(root, "cli", 10_000, 20_000)

    const status = statusFor(root, 30_000)

    expect(status.restartRequired).toBe(false)
    expect(status.buildRequired).toBe(false)
    expect(status.warnings).toEqual([])
  })

  it("requires channel smoke traces to prove request isolation, decision trace, topology run, and no provider-direct bypass", async () => {
    const scenario = getDefaultChannelSmokeScenarios().find((item) => item.id === "webui.basic_query")
    if (!scenario) throw new Error("missing webui.basic_query scenario")
    const execute = createDryRunChannelSmokeExecutor()

    const passing = validateChannelSmokeTrace(scenario, await execute(scenario))
    expect(passing).toEqual({ status: "passed", failures: [] })

    const failing = validateChannelSmokeTrace(scenario, {
      sourceChannel: "webui",
      responseChannel: "webui",
      correlationKey: "webui_run_id",
      requestFlow: {
        runId: "run-a",
        requestGroupId: "request-b",
        requestGroupMatchesRunId: false,
        decisionTracePresent: false,
        topologyRunCreated: false,
        providerDirectUsed: true,
      },
      auditLogId: "audit-test",
    })
    expect(failing.status).toBe("failed")
    expect(failing.failures).toEqual(expect.arrayContaining([
      "request_group_id_not_run_id",
      "decision_trace_missing",
      "topology_run_missing",
      "provider_direct_used",
    ]))
  })
})
