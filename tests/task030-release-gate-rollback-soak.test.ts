import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.ts"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"
import { buildReleaseManifest, buildReleasePipelinePlan } from "../packages/core/src/release/package.ts"
import {
  DEFAULT_SUB_AGENT_RELEASE_THRESHOLDS,
  SUB_AGENT_RELEASE_MODE_SEQUENCE,
  buildSubAgentReleaseReadinessSummary,
  buildSubAgentRollbackEvidence,
  runSubAgentRestartResumeSoak,
  type SubAgentReleaseGateCheckId,
} from "../packages/core/src/release/sub-agent-release-gate.ts"
import {
  runSubAgentBenchmarkSuite,
  type SubAgentBenchmarkSuiteResult,
} from "../packages/core/src/benchmarks/sub-agent-benchmarks.ts"

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
  const rootDir = makeTempDir("nobie-task030-release-root-")
  writeFile(rootDir, "package.json", JSON.stringify({ version: "9.9.9" }))
  writeFile(rootDir, "packages/cli/dist/index.js", "#!/usr/bin/env node\nconsole.log('cli')\n")
  writeFile(rootDir, "packages/core/dist/index.js", "export const core = true\n")
  writeFile(rootDir, "packages/webui/dist/index.html", "<html></html>\n")
  writeFile(rootDir, "packages/core/src/db/migrations.ts", "export const MIGRATIONS = []\n")
  writeFile(rootDir, "Yeonjang/src/protocol.rs", "pub struct Request;\n")
  writeFile(rootDir, "Yeonjang/manifests/permissions.json", "{}\n")
  writeFile(rootDir, "docs/release-runbook.md", "# Release Runbook\n")
  ensurePromptSourceFiles(rootDir)
  return rootDir
}

function cloneSuite(suite: SubAgentBenchmarkSuiteResult): SubAgentBenchmarkSuiteResult {
  return JSON.parse(JSON.stringify(suite)) as SubAgentBenchmarkSuiteResult
}

beforeEach(() => {
  closeDb()
  const stateDir = makeTempDir("nobie-task030-state-")
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

describe("task030 release gate, rollback, and soak", () => {
  it("defines staged rollout modes and produces a complete release dry-run summary", () => {
    const now = new Date("2026-04-25T00:00:00.000Z")
    const summary = buildSubAgentReleaseReadinessSummary({ now })

    expect(SUB_AGENT_RELEASE_MODE_SEQUENCE.map((mode) => mode.id)).toEqual([
      "flag_off",
      "dry_run_only",
      "limited_beta",
      "full_enable",
    ])
    expect(summary.gateStatus).toBe("passed")
    expect(summary.defaultThresholds).toEqual(DEFAULT_SUB_AGENT_RELEASE_THRESHOLDS)
    expect(summary.dryRunSummary.orchestrationMode.requestedMode).toBe("limited_beta")
    expect(summary.dryRunSummary.registry.hotSnapshotP95Ms).toBeLessThanOrEqual(100)
    expect(summary.dryRunSummary.planner.hotPathP95Ms).toBeLessThanOrEqual(700)
    expect(summary.dryRunSummary.eventStream.projectionRecovered).toBe(true)
    expect(summary.dryRunSummary.delivery.duplicateFinalAnswerCount).toBe(0)
    expect(summary.dryRunSummary.migration.rehearsalIncluded).toBe(true)
  })

  it("keeps every required sub-agent release gate explicit", () => {
    const summary = buildSubAgentReleaseReadinessSummary({
      now: new Date("2026-04-25T00:00:00.000Z"),
    })
    const ids = summary.checks.map((check) => check.id)
    const expected: SubAgentReleaseGateCheckId[] = [
      "release_mode_sequence",
      "release_dry_run_summary",
      "migration_rehearsal",
      "feature_flag_off_rollback",
      "no_sub_agent_fallback",
      "disabled_agent_fallback",
      "one_sub_agent_delegation",
      "multiple_parallel_delegation",
      "team_composition_validation",
      "team_target_expansion",
      "result_review_feedback_loop",
      "memory_isolation",
      "data_exchange_redaction",
      "capability_permission_approval",
      "model_cost_audit",
      "fallback_reason_audit",
      "channel_final_delivery_dedupe",
      "react_flow_graph_validation",
      "webui_runtime_projection",
      "focus_template_import_safety",
      "learning_history_restore_append_only",
      "benchmark_threshold",
      "nested_delegation_regression",
      "cascade_stop",
      "restart_resume_soak",
      "duplicate_final_zero_tolerance",
      "rollback_feature_flag_off",
    ]

    expect(ids).toEqual(expected)
    expect(summary.checks.every((check) => check.required)).toBe(true)
    expect(summary.checks.every((check) => check.status === "passed")).toBe(true)
  })

  it("fails the release when duplicate finals, orphan sessions, or restart recovery break thresholds", () => {
    const suite = cloneSuite(
      runSubAgentBenchmarkSuite({ now: new Date("2026-04-25T00:00:00.000Z") }),
    )
    suite.aggregate.duplicateFinalAnswerCount = 1
    const soak = runSubAgentRestartResumeSoak({
      now: new Date("2026-04-25T00:00:00.000Z"),
      overrides: {
        orphanSubSessionCount: 1,
        duplicateEventCount: 1,
        restartRecoveryP95Ms: 3_200,
      },
    })
    const summary = buildSubAgentReleaseReadinessSummary({ benchmarkSuite: suite, soak })

    expect(summary.gateStatus).toBe("failed")
    expect(summary.blockingFailures.join("\n")).toContain("duplicate_final_zero_tolerance")
    expect(summary.blockingFailures.join("\n")).toContain("orphan_sub_session_count:1")
    expect(summary.blockingFailures.join("\n")).toContain("restart_recovery_p95:3200ms")
  })

  it("documents non-destructive rollback by feature flag off", () => {
    const rollback = buildSubAgentRollbackEvidence({
      now: new Date("2026-04-25T00:00:00.000Z"),
      featureFlagModeBeforeRollback: "enforced",
    })

    expect(rollback.status).toBe("passed")
    expect(rollback.featureFlagModeAfterRollback).toBe("off")
    expect(rollback.dataDeletionRequired).toBe(false)
    expect(rollback.singleNobieModeRestored).toBe(true)
    expect(rollback.existingRunCreateSmokePassed).toBe(true)
    expect(rollback.finalAnswerSmokePassed).toBe(true)
  })

  it("wires the final gate into release manifest, pipeline, and operations runbook", () => {
    const rootDir = createReleaseFixture()
    const manifest = buildReleaseManifest({
      rootDir,
      releaseVersion: "v1.2.3-task030",
      gitTag: "v1.2.3-task030",
      gitCommit: "task030",
      targetPlatforms: [],
      now: new Date("2026-04-25T00:00:00.000Z"),
    })
    const pipeline = buildReleasePipelinePlan({ targetPlatforms: [] })
    const runbook = readFileSync(join(process.cwd(), "docs", "release-runbook.md"), "utf-8")

    expect(manifest.subAgentReleaseGate.kind).toBe("nobie.sub_agent.release_readiness")
    expect(manifest.subAgentReleaseGate.gateStatus).toBe("passed")
    expect(manifest.releaseNotes.knownLimitations.join("\n")).toContain(
      "Sub-agent release readiness gate: passed",
    )
    expect(manifest.cleanInstallChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sub-agent-release-readiness-gate", required: true }),
      ]),
    )
    expect(pipeline.order).toContain("sub-agent-release-readiness-gate")
    expect(
      pipeline.steps.find((step) => step.id === "sub-agent-release-readiness-gate")?.command,
    ).toEqual(["pnpm", "test", "tests/task030-release-gate-rollback-soak.test.ts"])
    expect(runbook).toContain("## Sub-Agent Rollout Gate")
    expect(runbook).toContain("subAgentReleaseGate")
    expect(existsSync(join(rootDir, "docs", "release-runbook.md"))).toBe(true)
  })
})
