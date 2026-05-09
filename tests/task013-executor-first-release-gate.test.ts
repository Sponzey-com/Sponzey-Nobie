import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_ALLOWED_TYPING_INPUTS,
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_DEFAULT_HIDDEN_CONCEPTS,
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_HAPPY_PATH,
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_INTERNAL_STABILITY,
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_REQUIRED_SURFACES,
  buildEnterpriseTopologyReleaseReadinessSummary,
  buildEnterpriseTopologyWorkspaceUsabilityGate,
} from "../packages/core/src/release/enterprise-topology-release-gate.ts"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  compileExecutorGraphToEnterpriseTopology,
  readExecutorGraphMetadata,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import {
  createExecutorDraftFromInference,
  inferExecutorFromDescription,
} from "../packages/core/src/topology/executor-inference.ts"
import {
  createExecutorConnectionDraft,
} from "../packages/core/src/topology/executor-relation-inference.ts"
import { resolveTopologyRootRunRouting } from "../packages/core/src/topology-runtime/harness.ts"

const now = Date.UTC(2026, 4, 2, 17, 0, 0)

describe("task013 Executor-first release gate", () => {
  it("defines the Executor-first gate around three typed inputs, hidden default concepts, and internal stability", () => {
    const gate = buildEnterpriseTopologyWorkspaceUsabilityGate({
      now: new Date("2026-05-02T17:00:00.000Z"),
    })

    expect(gate.status).toBe("passed")
    expect(gate.executorFirstHappyPath).toEqual(ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_HAPPY_PATH)
    expect(gate.allowedTypingInputs).toEqual([
      "executor_name",
      "executor_work",
      "run_input",
    ])
    expect(gate.allowedTypingInputs).toEqual(ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_ALLOWED_TYPING_INPUTS)
    expect(gate.defaultHiddenConcepts).toEqual(ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_DEFAULT_HIDDEN_CONCEPTS)
    expect(gate.defaultRequiredSurfaces).toEqual(ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_REQUIRED_SURFACES)
    expect(gate.internalStability).toEqual(ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_INTERNAL_STABILITY)
    expect(gate.executorFirstHappyPath.filter((step) => step.actionKind === "text_input").map((step) => step.inputKind))
      .toEqual(["executor_name", "executor_work", "run_input"])
  })

  it("fails readiness when easy UX, rule-based fallback, or removed advanced surface guarantees regress", () => {
    const brokenGate = buildEnterpriseTopologyWorkspaceUsabilityGate({
      now: new Date("2026-05-02T17:00:00.000Z"),
      executorFirstHappyPath: ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_HAPPY_PATH.filter((step) =>
        step.id !== "review_understanding"
      ),
      allowedTypingInputs: ["executor_name", "executor_work"],
      defaultHiddenConcepts: ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_DEFAULT_HIDDEN_CONCEPTS.filter((concept) =>
        concept !== "WorkOrder Template"
      ),
      defaultRequiredSurfaces: ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_REQUIRED_SURFACES.filter((surface) =>
        surface !== "executor-understanding-panel"
      ),
      internalStability: {
        ruleBasedInferenceFallback: false,
        advancedTopologySurfaceRemoved: false,
      },
    })
    const summary = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-05-02T17:00:00.000Z"),
      workspaceUsability: brokenGate,
    })
    const failures = summary.blockingFailures.join("\n")

    expect(brokenGate.status).toBe("failed")
    expect(summary.gateStatus).toBe("failed")
    expect(failures).toContain("workspace_usability:missing_executor_first_step:review_understanding")
    expect(failures).toContain("workspace_usability:missing_allowed_typing_input:run_input")
    expect(failures).toContain("workspace_usability:missing_hidden_default_concept:workorder_template")
    expect(failures).toContain("workspace_usability:missing_default_surface:executor-understanding-panel")
    expect(failures).toContain("workspace_usability:rule_based_inference_fallback_missing")
    expect(failures).toContain("workspace_usability:advanced_topology_surface_still_exposed")
    expect(failures).toContain("topology_workspace_executor_first_usability")
  })

  it("wires Executor-first checks and task013 regressions into release readiness", () => {
    const summary = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-05-02T17:00:00.000Z"),
    })
    const checkIds = summary.checks.map((check) => check.id)
    const usabilityCommand = summary.regressionCommands.find((command) =>
      command.id === "topology_workspace_usability_gate"
    )

    expect(summary.gateStatus).toBe("passed")
    expect(checkIds).toContain("topology_workspace_executor_first_usability")
    expect(checkIds).not.toContain("topology_workspace_no_typing_usability")
    expect(usabilityCommand?.command).toEqual(expect.arrayContaining([
      "tests/task013-executor-first-usability.test.tsx",
      "tests/task013-executor-first-release-gate.test.ts",
      "tests/task012-advanced-escape-hatch.test.tsx",
    ]))
    expect(usabilityCommand?.description).toContain("Executor-first usability")
  })

  it("proves profile-based executor draft creation, ExecutorGraph compile, metadata boundary, and feature flag fallback", () => {
    const intake = executor("node:intake", "고객 접수 담당자", "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.")
    const reviewer = executor("node:reviewer", "검토자", "정리된 내용을 검토하고 승인 의견을 남긴다.")
    const graph = executorGraph([intake, reviewer], [
      createExecutorConnectionDraft({ source: intake, target: reviewer }),
    ])
    const compiled = compileExecutorGraphToEnterpriseTopology(graph, { now })
    const inference = inferExecutorFromDescription({
      name: intake.name,
      description: intake.description,
    })
    const fallbackDecision = resolveTopologyRootRunRouting({
      message: "topology:task013 고객 요청 처리",
      runId: "run:task013-off",
      sessionId: "session:task013-off",
      source: "webui",
      targetId: "topology:task013",
      isRootRequest: true,
      featureFlag: {
        featureKey: "topology_runtime_enabled",
        mode: "off",
        compatibilityMode: true,
        updatedAt: now,
        updatedBy: "task013",
        reason: "task013 executor-first fallback",
        evidence: null,
        source: "default",
      },
    })

    expect(inference.runtimeMode).toBe("unknown")
    expect(inference.toolHints).toEqual([])
    expect(inference.keywordHits).toEqual([])
    expect(inference.executorProfile).toEqual(expect.objectContaining({
      roleName: "executor",
      expectedOutputs: ["처리 결과"],
    }))
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(compiled.topology.nodes.map((node) => node.id)).toEqual(["node:intake", "node:reviewer"])
    expect(compiled.topology.relations).toEqual([
      expect.objectContaining({
        id: "relation:connection:node:intake:node:reviewer",
        relationType: "delegates_to",
      }),
    ])
    expect(readExecutorGraphMetadata(compiled.topology)).toEqual(expect.objectContaining({
      sourceOfTruth: "enterprise_topology",
      projectionOnly: true,
      executorIds: ["node:intake", "node:reviewer"],
    }))
    expect(JSON.stringify(compiled.topology.metadata)).not.toContain("agent_config")
    expect(fallbackDecision).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "feature_flag_off",
      explicitTopologyId: "topology:task013",
    }))
  })

  it("documents Executor-first release and rollback checks", () => {
    const runbook = readFileSync(new URL("../docs/release-runbook.md", import.meta.url), "utf-8")

    expect(runbook).toContain("Executor-first usability gate")
    expect(runbook).toContain("executor name, executor work, and run input")
    expect(runbook).toContain("Default UX leak gate")
    expect(runbook).toContain("Internal stability gate")
    expect(runbook).toContain("WorkOrder Template")
    expect(runbook).toContain("Simple mode rollback check")
    expect(runbook).toContain("노비가 이해한 내용")
  })
})

function executor(id: string, name: string, description: string): ExecutorDraft {
  return createExecutorDraftFromInference({
    id,
    sourceNodeId: id,
    name,
    description,
    now,
    userConfirmed: true,
  })
}

function executorGraph(
  executors: ExecutorDraft[],
  connections: ExecutorConnectionDraft[] = [],
): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task013-release",
    topologyId: "topology:task013-release",
    name: "Task013 release gate graph",
    mode: "simple",
    executors,
    sections: [],
    connections,
    selectedId: executors[0]?.id ?? null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.8,
      executorCount: executors.length,
      connectionCount: connections.length,
      issueCount: 0,
      generatedAt: now,
    },
    compiledPreview: null,
    latestRun: null,
    issues: [],
    sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  }
}
