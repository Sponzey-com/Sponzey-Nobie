import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.ts"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"
import { buildReleaseManifest, buildReleasePipelinePlan } from "../packages/core/src/release/package.ts"
import {
  ENTERPRISE_TOPOLOGY_RELEASE_FEATURE_FLAGS,
  ENTERPRISE_TOPOLOGY_RELEASE_MODE_SEQUENCE,
  ENTERPRISE_TOPOLOGY_RELEASE_REGRESSION_COMMANDS,
  buildEnterpriseTopologyReleaseFlagMatrix,
  buildEnterpriseTopologyReleaseReadinessSummary,
  buildEnterpriseTopologyRollbackRunbook,
  buildEnterpriseTopologyRollbackSmoke,
  type EnterpriseTopologyReleaseFeatureFlagKey,
} from "../packages/core/src/release/enterprise-topology-release-gate.ts"
import {
  listFeatureFlags,
  type FeatureFlagMode,
  type RuntimeFeatureFlag,
} from "../packages/core/src/runtime/rollout-safety.ts"
import { buildStartPlan, defaultStartPlanDependencies } from "../packages/core/src/runs/start-plan.ts"
import { resolveTopologyRootRunRouting } from "../packages/core/src/topology-runtime/harness.ts"

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
  const rootDir = makeTempDir("nobie-task025-release-root-")
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

function useTempState(): void {
  closeDb()
  const stateDir = makeTempDir("nobie-task025-state-")
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
  getDb()
}

function topologyFeatureFlags(
  overrides: Partial<Record<EnterpriseTopologyReleaseFeatureFlagKey, FeatureFlagMode>> = {},
) {
  return ENTERPRISE_TOPOLOGY_RELEASE_FEATURE_FLAGS.map((definition) => {
    const mode = overrides[definition.featureKey] ?? definition.defaultMode
    return {
      featureKey: definition.featureKey,
      mode,
      compatibilityMode: mode !== "enforced",
      source: "task025-test",
    }
  })
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task025 Enterprise Topology release gate", () => {
  it("registers every topology rollout feature flag with safe defaults", () => {
    const flags = new Map(listFeatureFlags(getDb()).map((flag) => [flag.featureKey, flag]))

    expect(flags.get("enterprise_topology_registry")?.mode).toBe("off")
    expect(flags.get("enterprise_topology_validator")?.mode).toBe("shadow")
    expect(flags.get("enterprise_topology_compiler")?.mode).toBe("off")
    expect(flags.get("topology_runtime_mvp")?.mode).toBe("off")
    expect(flags.get("topology_runtime_recursive_delegation")?.mode).toBe("off")
    expect(flags.get("topology_tool_runtime")?.mode).toBe("off")
    expect(flags.get("topology_exhaustion_failure")?.mode).toBe("off")
    expect(flags.get("declared_observed_topology_analysis")?.mode).toBe("off")
    expect(flags.get("enterprise_topology_builder_ui")?.mode).toBe("off")
    expect(flags.get("topology_runtime_enabled")?.mode).toBe("off")
  })

  it("keeps the feature-flag-off path on single Nobie fallback", async () => {
    const offFlag: RuntimeFeatureFlag = {
      featureKey: "topology_runtime_enabled",
      mode: "off",
      compatibilityMode: true,
      updatedAt: 0,
      updatedBy: "task025-test",
      reason: "off path regression",
      evidence: null,
      source: "default",
    }
    const decision = resolveTopologyRootRunRouting({
      message: "topology:customer-success 고객 요청 업무 처리",
      runId: "run:task025-off",
      sessionId: "session:task025-off",
      source: "webui",
      targetId: "topology:customer-success",
      isRootRequest: true,
      featureFlag: offFlag,
    })
    const plan = await buildStartPlan({
      message: "topology:customer-success 고객 요청 업무 처리",
      sessionId: "session:task025-off",
      runId: "run:task025-off",
      source: "webui",
      targetId: "topology:customer-success",
    }, {
      ...defaultStartPlanDependencies,
      resolveTopologyRootRunRouting: () => decision,
    })

    expect(decision).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "feature_flag_off",
      explicitTopologyId: "topology:customer-success",
    }))
    expect(plan.topologyRouting).toEqual(decision)
    expect(plan.orchestrationMode).toBe("single_nobie")
  })

  it("documents rollout stages and release gate regression commands", () => {
    const summary = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-04-30T00:00:00.000Z"),
    })
    const checkIds = summary.checks.map((check) => check.id)

    expect(ENTERPRISE_TOPOLOGY_RELEASE_MODE_SEQUENCE.map((mode) => mode.id)).toEqual([
      "contracts_validator_only",
      "dry_run_shadow",
      "gated_mode",
      "opt_in_routing",
    ])
    expect(summary.gateStatus).toBe("passed")
    expect(summary.requestedMode).toBe("contracts_validator_only")
    expect(checkIds).toEqual([
      "feature_flag_matrix",
      "contracts_validator_only_stage",
      "dry_run_shadow_stage",
      "gated_mode_stage",
      "opt_in_routing_stage",
      "feature_flag_off_path",
      "single_nobie_fallback",
      "sub_agent_regression_suite",
      "channel_finalizer_regression_suite",
      "webui_build_gate",
      "topology_workspace_route_compatibility",
      "topology_workspace_layer_gate",
      "topology_workspace_executor_first_usability",
      "topology_workspace_usability_gate",
      "topology_runtime_smoke",
      "topology_rollback_smoke",
      "active_topology_snapshot_restore",
    ])
    expect(ENTERPRISE_TOPOLOGY_RELEASE_REGRESSION_COMMANDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sub_agent_regression_suite",
          command: expect.arrayContaining(["tests/task030-release-gate-rollback-soak.test.ts"]),
        }),
        expect.objectContaining({
          id: "channel_finalizer_regression_suite",
          command: expect.arrayContaining(["tests/task023-channel-finalizer-late-result.test.ts"]),
        }),
        expect.objectContaining({
          id: "webui_build_gate",
          command: ["pnpm", "--filter", "@nobie/webui", "build"],
        }),
        expect.objectContaining({
          id: "topology_workspace_usability_gate",
          command: expect.arrayContaining([
            "tests/task013-executor-first-usability.test.tsx",
            "tests/task013-executor-first-release-gate.test.ts",
            "tests/task012-topology-workspace-release-gate.test.ts",
          ]),
        }),
        expect.objectContaining({
          id: "topology_runtime_smoke",
          command: expect.arrayContaining(["tests/task023-topology-root-run-integration.test.ts"]),
        }),
      ]),
    )
  })

  it("passes opt-in MVP routing only when prerequisite flags are enforced", () => {
    const featureFlags = topologyFeatureFlags({
      enterprise_topology_registry: "enforced",
      enterprise_topology_validator: "enforced",
      enterprise_topology_compiler: "enforced",
      topology_runtime_mvp: "enforced",
      topology_runtime_enabled: "enforced",
    })
    const summary = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-04-30T00:00:00.000Z"),
      requestedMode: "opt_in_routing",
      featureFlags,
    })
    const broken = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-04-30T00:00:00.000Z"),
      requestedMode: "opt_in_routing",
      featureFlags: topologyFeatureFlags({
        enterprise_topology_registry: "enforced",
        enterprise_topology_validator: "enforced",
        enterprise_topology_compiler: "enforced",
        topology_runtime_mvp: "off",
        topology_runtime_enabled: "enforced",
      }),
    })
    const matrix = buildEnterpriseTopologyReleaseFlagMatrix({
      requestedMode: "opt_in_routing",
      featureFlags,
    })

    expect(summary.gateStatus).toBe("passed")
    expect(summary.runtimeSmoke.topologyRuntimeMvpPassed).toBe(true)
    expect(matrix.find((row) => row.featureKey === "topology_runtime_enabled")).toEqual(
      expect.objectContaining({
        currentMode: "enforced",
        satisfiesRequestedMode: true,
      }),
    )
    expect(broken.gateStatus).toBe("failed")
    expect(broken.blockingFailures.join("\n")).toContain("topology_runtime_enabled_requires_enforced:topology_runtime_mvp")
  })

  it("documents rollback without data deletion and requires active topology plus snapshot restore", () => {
    const runbook = buildEnterpriseTopologyRollbackRunbook()
    const rollback = buildEnterpriseTopologyRollbackSmoke({
      now: new Date("2026-04-30T00:00:00.000Z"),
      featureFlagModeBeforeRollback: "enforced",
    })

    expect(rollback.status).toBe("passed")
    expect(rollback.featureFlagModeAfterRollback).toBe("off")
    expect(rollback.dataDeletionRequired).toBe(false)
    expect(rollback.activeTopologyRollbackVerified).toBe(true)
    expect(rollback.compiledSnapshotRestoreVerified).toBe(true)
    expect(runbook.steps.join("\n")).toContain("topology_runtime_enabled=off")
    expect(runbook.steps.join("\n")).toContain("enterprise_topology_builder_ui=off")
    expect(runbook.steps.join("\n")).toContain("/advanced/topology")
    expect(runbook.steps.join("\n")).toContain("active topology")
    expect(runbook.steps.join("\n")).toContain("compiled snapshot")
  })

  it("wires topology readiness into release manifest, pipeline, runbook, and evidence docs", () => {
    const rootDir = createReleaseFixture()
    const manifest = buildReleaseManifest({
      rootDir,
      releaseVersion: "v1.2.3-task025",
      gitTag: "v1.2.3-task025",
      gitCommit: "task025",
      targetPlatforms: [],
      now: new Date("2026-04-30T00:00:00.000Z"),
    })
    const pipeline = buildReleasePipelinePlan({ targetPlatforms: [] })
    const runbook = readFileSync(join(process.cwd(), "docs", "release-runbook.md"), "utf-8")

    expect(manifest.enterpriseTopologyReleaseGate.kind).toBe(
      "nobie.enterprise_topology.release_readiness",
    )
    expect(manifest.enterpriseTopologyReleaseGate.gateStatus).toBe("passed")
    expect(manifest.releaseNotes.knownLimitations.join("\n")).toContain(
      "Enterprise Topology release gate: passed",
    )
    expect(manifest.rollback.steps.join("\n")).toContain("topology_runtime_enabled=off")
    expect(manifest.rollback.steps.join("\n")).toContain("compiled snapshot")
    expect(manifest.cleanInstallChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "enterprise-topology-release-gate", required: true }),
      ]),
    )
    expect(pipeline.order).toContain("enterprise-topology-release-gate")
    expect(
      pipeline.steps.find((step) => step.id === "enterprise-topology-release-gate")?.command,
    ).toEqual([
      "pnpm",
      "test",
      "tests/task025-enterprise-topology-release-gate.test.ts",
      "tests/task013-executor-first-release-gate.test.ts",
      "tests/task013-executor-first-usability.test.tsx",
      "tests/task012-topology-workspace-release-gate.test.ts",
    ])
    expect(runbook).toContain("## Enterprise Topology Rollout Gate")
    expect(runbook).toContain("enterpriseTopologyReleaseGate")
    expect(runbook).toContain("Topology Workspace route gate")
    expect(existsSync(join(rootDir, "docs", "release-runbook.md"))).toBe(true)
  })
})
