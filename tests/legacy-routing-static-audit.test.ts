import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()

function rg(pattern: string, paths: string[]): string[] {
  try {
    return execFileSync("rg", [pattern, ...paths], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean)
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: number }).status
      : undefined
    if (status === 1) return []
    throw error
  }
}

function source(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8")
}

describe("legacy routing static audit", () => {
  it("keeps resolveRunRoute limited to explicit provider routing, not root request selection", () => {
    const matches = rg("resolveRunRoute\\(", ["packages/core/src"])
    const allowedPrefixes = [
      "packages/core/src/runs/routing.ts:",
      "packages/core/src/runs/routing.js:",
      "packages/core/src/runs/routing.d.ts:",
      "packages/core/src/runs/intake-bridge-pass.ts:",
      "packages/core/src/runs/intake-bridge-pass.js:",
    ]
    expect(matches.filter((line) => !allowedPrefixes.some((prefix) => line.startsWith(prefix)))).toEqual([])

    const intakeBridgePass = source("packages/core/src/runs/intake-bridge-pass.ts")
    const explicitProviderStart = intakeBridgePass.indexOf("function resolveExplicitProviderRoute")
    const decisionRouteStart = intakeBridgePass.indexOf("async function resolveDelegatedDecisionRoute")
    const runBridgeStart = intakeBridgePass.indexOf("export async function runIntakeBridgePass")
    expect(explicitProviderStart).toBeGreaterThanOrEqual(0)
    expect(decisionRouteStart).toBeGreaterThan(explicitProviderStart)
    expect(runBridgeStart).toBeGreaterThan(decisionRouteStart)

    const explicitProviderSection = intakeBridgePass.slice(explicitProviderStart, decisionRouteStart)
    const decisionRouteSection = intakeBridgePass.slice(decisionRouteStart, runBridgeStart)
    const runBridgeSection = intakeBridgePass.slice(runBridgeStart)

    expect(explicitProviderSection).toContain("input.moduleDependencies.resolveRunRoute")
    expect(decisionRouteSection).not.toContain("resolveRunRoute(")
    expect(runBridgeSection).not.toContain("resolveRunRoute(")
    expect(runBridgeSection).toContain("resolveExplicitProviderRoute")
    expect(runBridgeSection).toContain("resolveDelegatedDecisionRoute")
  })

  it("does not keep removed phase022 topology route helpers", () => {
    expect(rg("buildIntakeTopologyExecutionDecision|resolveDelegatedTopologyRoute", [
      "packages/core/src",
    ])).toEqual([])
  })

  it("keeps provider:openai mention inside explicit provider route normalization only", () => {
    const matches = rg("provider:openai", ["packages/core/src/runs", "packages/core/src/orchestration"])
    const allowedPrefixes = [
      "packages/core/src/runs/routing.ts:",
      "packages/core/src/runs/routing.js:",
    ]
    expect(matches.filter((line) => !allowedPrefixes.some((prefix) => line.startsWith(prefix)))).toEqual([])
    expect(source("packages/core/src/runs/intake-bridge-pass.ts")).toContain(
      "provider_direct_blocked_without_explicit_target",
    )
    expect(source("packages/core/src/runs/intake-bridge-pass.ts")).toContain(
      "provider_direct_allowed_with_explicit_target",
    )
  })

  it("does not use legacy single-nobie delegation failure as an initial execution selector", () => {
    expect(rg("delegate_failure_single_nobie", ["packages/core/src"])).toEqual([])
    expect(source("packages/core/src/orchestration/planner.ts")).not.toContain(
      "delegate_failure_single_nobie",
    )
  })

  it("limits legacy single_nobie text to compatibility, settings, and release gates", () => {
    const matches = rg("single_nobie", ["packages/core/src"])
    const allowedPrefixes = [
      "packages/core/src/contracts/sub-agent-orchestration.ts:",
      "packages/core/src/contracts/sub-agent-orchestration.js:",
      "packages/core/src/contracts/sub-agent-orchestration.d.ts:",
      "packages/core/src/runs/store.ts:",
      "packages/core/src/runs/store.js:",
      "packages/core/src/runs/runtime-inspector-projection.ts:",
      "packages/core/src/runs/runtime-inspector-projection.js:",
      "packages/core/src/runs/start-launch.ts:",
      "packages/core/src/runs/start-launch.js:",
      "packages/core/src/config/types.ts:",
      "packages/core/src/config/types.js:",
      "packages/core/src/config/types.d.ts:",
      "packages/core/src/api/routes/settings.ts:",
      "packages/core/src/api/routes/settings.js:",
      "packages/core/src/orchestration/mode.ts:",
      "packages/core/src/orchestration/mode.js:",
      "packages/core/src/orchestration/mode.d.ts:",
      "packages/core/src/orchestration/registry.ts:",
      "packages/core/src/orchestration/registry.js:",
      "packages/core/src/orchestration/registry.d.ts:",
      "packages/core/src/release/package.ts:",
      "packages/core/src/release/package.js:",
      "packages/core/src/release/sub-agent-release-gate.ts:",
      "packages/core/src/release/sub-agent-release-gate.js:",
      "packages/core/src/release/sub-agent-release-gate.d.ts:",
      "packages/core/src/release/enterprise-topology-release-gate.ts:",
      "packages/core/src/release/enterprise-topology-release-gate.js:",
      "packages/core/src/release/enterprise-topology-release-gate.d.ts:",
    ]

    expect(matches.filter((line) => !allowedPrefixes.some((prefix) => line.startsWith(prefix)))).toEqual([])
    expect(source("packages/core/src/orchestration/planner.ts")).not.toContain("single_nobie")
    expect(source("packages/core/src/orchestration/execution-harness.ts")).not.toContain("single_nobie")
    expect(source("packages/core/src/runs/intake-bridge-pass.ts")).not.toContain("single_nobie")
  })

  it("does not justify provider direct fallback with topology routing opt-out", () => {
    const matches = rg("topology_routing_not_opted_in", ["packages/core/src"])
    expect(matches.every((line) => line.startsWith("packages/core/src/topology-runtime/harness"))).toBe(true)
    expect(source("packages/core/src/runs/intake-bridge-pass.ts")).not.toContain(
      "topology_routing_not_opted_in",
    )
  })

  it("keeps activeSubAgents out of execution-decision candidate construction", () => {
    const matches = rg("activeSubAgents", [
      "packages/core/src/orchestration",
      "packages/core/src/runs",
      "packages/core/src/topology-runtime",
    ])
    const allowedPrefixes = [
      "packages/core/src/orchestration/mode.ts:",
      "packages/core/src/orchestration/mode.js:",
      "packages/core/src/orchestration/mode.d.ts:",
      "packages/core/src/runs/start.ts:",
      "packages/core/src/runs/start.js:",
    ]
    expect(matches.filter((line) => !allowedPrefixes.some((prefix) => line.startsWith(prefix)))).toEqual([])

    const candidateSourceFiles = [
      "packages/core/src/runs/intake-bridge-pass.ts",
      "packages/core/src/orchestration/execution-context-builder.ts",
      "packages/core/src/orchestration/execution-harness.ts",
      "packages/core/src/orchestration/planner.ts",
    ]
    for (const file of candidateSourceFiles) {
      expect(source(file), file).not.toContain("activeSubAgents")
    }
    expect(source("packages/core/src/topology-runtime/harness.ts")).not.toContain("activeSubAgents")
    expect(source("packages/core/src/topology-runtime/harness.js")).not.toContain("activeSubAgents")
    expect(source("packages/core/src/topology-runtime/harness.d.ts")).not.toContain("activeSubAgents")
  })

  it("does not use active_default_workflow_candidate as a runtime route reason", () => {
    const removedDefaultRouteReason = ["compiled", "default", "entry"].join("_")
    const runtimeSourceFiles = [
      "packages/core/src/topology-runtime/harness.ts",
      "packages/core/src/topology-runtime/harness.js",
      "packages/core/src/topology-runtime/harness.d.ts",
      "packages/core/src/runs/intake-bridge-pass.ts",
      "packages/core/src/orchestration/execution-harness.ts",
      "packages/core/src/orchestration/planner.ts",
    ]
    for (const file of runtimeSourceFiles) {
      expect(source(file), file).not.toContain("active_default_workflow_candidate")
    }
    expect(source("packages/core/src/topology-runtime/harness.ts")).not.toContain(removedDefaultRouteReason)
    expect(source("packages/core/src/topology-runtime/harness.js")).not.toContain(removedDefaultRouteReason)
    expect(source("packages/core/src/topology-runtime/harness.d.ts")).not.toContain(removedDefaultRouteReason)
  })

  it("does not generate new planner fallback plans through single_nobie", () => {
    expect(source("packages/core/src/orchestration/planner.ts")).not.toContain("single_nobie")
    expect(source("packages/core/src/orchestration/execution-harness.ts")).not.toContain("single_nobie")
  })
})
