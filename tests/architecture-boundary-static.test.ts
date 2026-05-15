import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()

function source(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8")
}

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

describe("architecture boundary static gate", () => {
  it("exposes the architecture cleanup suite as package scripts", () => {
    const packageJson = JSON.parse(source("package.json")) as { scripts?: Record<string, string> }
    const scripts = packageJson.scripts ?? {}

    expect(scripts["test:architecture:static"]).toContain("architecture-boundary-static.test.ts")
    expect(scripts["test:architecture:runtime"]).toContain("child-result-parent-aggregation-v2.test.ts")
    expect(scripts["test:architecture:webui"]).toContain("no-enterprise-advanced-ui-in-default-topology.test.tsx")
    expect(scripts["test:architecture:prompts"]).toContain("prompt-source-regression.test.ts")
    expect(scripts["test:architecture:generated"]).toContain("generated-artifact-consistency.test.ts")
    expect(scripts["test:architecture"]).toContain("test:architecture:static")
    expect(scripts["test:architecture"]).toContain("test:architecture:runtime")
    expect(scripts["test:architecture"]).toContain("test:architecture:webui")
    expect(scripts["test:architecture"]).toContain("test:architecture:prompts")
  })

  it("keeps source-of-truth documents for cleanup boundaries", () => {
    const requiredDocs = [
      "packages/core/src/source.md",
      "packages/core/src/runs/source.md",
      "packages/core/src/topology/source.md",
      "packages/webui/src/source.md",
      "packages/webui/src/components/topology/source.md",
      ".tasks/architecture-cleanup-inventory.md",
    ]

    for (const file of requiredDocs) {
      expect(existsSync(join(repoRoot, file)), file).toBe(true)
    }

    expect(source("packages/core/src/topology/source.md")).toContain("ExecutorGraph")
    expect(source("packages/core/src/topology/source.md")).toContain("EnterpriseTopology V1")
    expect(source("packages/webui/src/components/topology/source.md")).toContain("기본 topology")
    expect(source(".tasks/architecture-cleanup-inventory.md")).toContain("compatibility")
    expect(source("docs/release-runbook.md")).toContain("pnpm run test:architecture")
    expect(source("docs/execution-decision-regression.md")).toContain("pnpm run test:architecture")
  })

  it("does not route the default topology screen through legacy enterprise pages", () => {
    const defaultRouteFiles = [
      "packages/webui/src/App.tsx",
      "packages/webui/src/pages/TopologyWorkspacePage.tsx",
      "packages/webui/src/pages/TopologyPage.tsx",
    ]

    const banned = [
      "EnterpriseTopologyPage",
      "EnterpriseTopologyPalette",
      "EnterpriseTopologyInspector",
      "TopologyAdvancedImportExportPanel",
    ]

    for (const file of defaultRouteFiles) {
      const text = source(file)
      for (const token of banned) {
        expect(text, `${file} should not depend on ${token} in the default topology route`).not.toContain(token)
      }
    }
  })

  it("does not reintroduce compiled default entry execution routes", () => {
    const matches = rg("compiled_default_entry|compiled_default", [
      "packages/core/src/runs",
      "packages/core/src/orchestration",
      "packages/core/src/topology-runtime",
      "prompts",
    ])
    expect(matches).toEqual([])
  })

  it("keeps raw keyword executor routing out of execution decision sources", () => {
    const candidateFiles = [
      "packages/core/src/orchestration/execution-harness.ts",
      "packages/core/src/orchestration/execution-context-builder.ts",
      "packages/core/src/orchestration/execution-decision-contract.ts",
      "packages/core/src/orchestration/planner.ts",
      "packages/core/src/runs/intake-bridge-pass.ts",
      "packages/core/src/topology-runtime/harness.ts",
    ]

    const bannedPatterns = [
      ".includes(request",
      ".includes(userRequest",
      ".includes(raw",
      ".match(request",
      ".match(userRequest",
      "keywordTable",
      "keyword table",
    ]

    for (const file of candidateFiles) {
      const text = source(file)
      for (const token of bannedPatterns) {
        expect(text, `${file} should not use ${token} for execution decisions`).not.toContain(token)
      }
    }
  })

  it("keeps core domain candidate files independent from adapters", () => {
    const domainCandidateFiles = [
      "packages/core/src/topology/executor-topology-v2.ts",
      "packages/core/src/topology/executor-graph.ts",
      "packages/core/src/orchestration/execution-decision-contract.ts",
    ]
    const forbiddenImports = [
      "../api/",
      "../channels/",
      "../db/",
      "../ai/providers/",
      "packages/webui",
      "react",
    ]

    for (const file of domainCandidateFiles) {
      const text = source(file)
      for (const token of forbiddenImports) {
        expect(text, `${file} should not import adapter dependency ${token}`).not.toContain(token)
      }
    }
  })
})
