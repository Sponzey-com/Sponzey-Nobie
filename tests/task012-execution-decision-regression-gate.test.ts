import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function read(path: string): string {
  return readFileSync(path, "utf8")
}

describe("task012 execution decision regression gate", () => {
  it("publishes focused Phase 022 regression scripts", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> }

    expect(pkg.scripts["test:phase022:prompts"]).toContain("tests/prompt-source-registry.test.ts")
    expect(pkg.scripts["test:phase022:prompts"]).toContain("tests/task012-agent-prompt-bundle-preflight.test.ts")
    expect(pkg.scripts["test:phase022:execution"]).toContain("tests/task022-no-keyword-execution-decision.test.ts")
    expect(pkg.scripts["test:phase022:execution"]).toContain("tests/task025-multilingual-execution-decision.test.ts")
    expect(pkg.scripts["test:phase022:execution"]).toContain("tests/task026-risk-boundary-execution-decision.test.ts")
    expect(pkg.scripts["test:phase022:execution"]).toContain("tests/task012-execution-decision-regression-gate.test.ts")
    expect(pkg.scripts["test:phase022:webui"]).toContain("tests/task009-simple-run-ux.test.tsx")
    expect(pkg.scripts["test:phase022:webui"]).toContain("tests/task024-webui-runtime-inspector.test.ts")
    expect(pkg.scripts["test:phase022"]).toBe(
      "pnpm run test:phase022:prompts && pnpm run test:phase022:execution && pnpm run test:phase022:webui",
    )
    expect(pkg.scripts["test:phase024:acceptance"]).toContain("tests/legacy-routing-static-audit.test.ts")
    expect(pkg.scripts["test:phase024:acceptance"]).toContain("tests/no-provider-direct-with-topology-executors.test.ts")
    expect(pkg.scripts["test:phase024:acceptance"]).toContain("tests/channel-request-execution-decision-first.test.ts")
    expect(pkg.scripts["test:phase024:acceptance"]).toContain("tests/runtime-build-restart-required.test.ts")
  })

  it("documents fast gates, allowed string handling, and Runtime Inspector evidence", () => {
    const doc = read("docs/execution-decision-regression.md")
    const runbook = read("docs/release-runbook.md")

    expect(doc).toContain("pnpm run test:phase022:prompts")
    expect(doc).toContain("pnpm run test:phase022:execution")
    expect(doc).toContain("pnpm run test:phase022:webui")
    expect(doc).toContain("raw user message")
    expect(doc).toContain("Allowed when it does not change execution decisions")
    expect(doc).toContain("Runtime Inspector")
    expect(doc).toContain("selected executor")
    expect(doc).toContain("Task012 Legacy Routing Acceptance")
    expect(doc).toContain("pnpm run test:phase024:acceptance")
    expect(doc).toContain("Allowed legacy locations")
    expect(doc).toContain("providerDirectUsed=false")
    expect(runbook).toContain("pnpm run test:phase022")
    expect(runbook).toContain("Execution Decision Regression Gate")
  })

  it("keeps user-facing setup copy on execution path terms instead of a separate router concept", () => {
    const sources = [
      "packages/webui/src/pages/SetupPage.tsx",
      "packages/webui/src/components/setup/BackendHealthCard.tsx",
      "packages/webui/src/components/setup/SetupVisualizationCanvas.tsx",
      "packages/webui/src/lib/setup-readiness.ts",
      "packages/webui/src/lib/setup-visualization-scenes.ts",
      "packages/core/src/control-plane/index.ts",
    ].map(read).join("\n")

    for (const forbidden of [
      "Nobie Core Router",
      "라우팅 대상",
      "라우팅 런타임",
      "라우팅 projection",
      "라우팅 프로필",
      "라우팅 화면",
      "AI 라우팅",
      "AI 라우팅 태그",
      "라우팅 대상 없음",
      "No routing targets",
      "routing projection",
      "routing scene",
      "routing target",
      "routing profile",
      "AI Routing Tags",
      "AI Routing\"",
      "라우팅\", \"Routing",
    ]) {
      expect(sources, `user-facing copy must not contain ${forbidden}`).not.toContain(forbidden)
    }

    expect(sources).toContain("노비 실행 경로")
    expect(sources).toContain("실행 대상")
    expect(sources).toContain("AI 실행 대상")
    expect(sources).toContain("AI 실행 경로")
    expect(sources).toContain("Execution path")
    expect(sources).toContain("AI execution path")
  })
})
