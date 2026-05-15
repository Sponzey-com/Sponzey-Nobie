import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseMetadata,
  type EnterpriseTopology,
  type FailureReport,
  type WorkOrder,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  buildEnterpriseTopologyReleaseReadinessSummary,
  buildEnterpriseTopologyWorkspaceUsabilityGate,
} from "../packages/core/src/release/enterprise-topology-release-gate.ts"
import {
  EXECUTOR_GRAPH_METADATA_KEY,
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  buildExecutorGraphRollbackEvidence,
  compileExecutorGraphToEnterpriseTopology,
  readExecutorGraphMetadata,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import {
  confirmExecutorUnderstanding,
  createExecutorDraftFromInference,
} from "../packages/core/src/topology/executor-inference.ts"
import {
  createExecutorConnectionDraft,
} from "../packages/core/src/topology/executor-relation-inference.ts"
import {
  EXECUTOR_FAILURE_OBSERVABILITY_METADATA_KEY,
  EXECUTOR_OBSERVABILITY_METADATA_KEY,
  attachExecutorFailureEvidence,
  buildExecutorRunObservabilityMetadata,
  executorInferenceEvidenceForNode,
} from "../packages/core/src/topology/executor-observability.ts"
import {
  createNodeRuntimeTraceEvent,
} from "../packages/core/src/topology-runtime/trace.ts"
import { ExecutorRunResultPanel } from "../packages/webui/src/components/topology/ExecutorRunResultPanel.tsx"
import type { TopologyRunTraceOverlayInput } from "../packages/webui/src/components/topology/TopologyRunTraceOverlay.tsx"

const now = Date.UTC(2026, 4, 2, 18, 0, 0)

describe("task014 Executor internal observability and rollback safety", () => {
  it("stores confirmed understanding and inference evidence in topology and node metadata", () => {
    const { topology } = compiledFixture()
    const metadata = readExecutorGraphMetadata(topology)
    const nodeEvidence = executorInferenceEvidenceForNode({ topology, nodeId: "node:intake" })
    const rawNodeMetadata = topology.nodes.find((node) => node.id === "node:intake")
      ?.metadata?.[EXECUTOR_GRAPH_METADATA_KEY]

    expect(metadata?.workspace.executors[0]?.inferenceEvidence).toEqual(expect.objectContaining({
      evidenceId: "executor-inference:node:intake",
      executorId: "node:intake",
      understandingState: "confirmed",
      confirmedUnderstandingVersion: "executor-understanding:v1",
      userDescription: {
        name: "고객 접수 담당자",
        description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
      },
      normalizedUnderstanding: expect.objectContaining({
        runtimeMode: "unknown",
        tools: [],
      }),
      inferenceRuleIds: expect.arrayContaining([
        "runtime:unknown",
        "profile:executor",
      ]),
    }))
    expect(nodeEvidence).toEqual(metadata?.workspace.executors[0]?.inferenceEvidence)
    expect(rawNodeMetadata).toEqual(expect.objectContaining({
      sourceOfTruth: "executor_topology_v2",
      projectionOnly: true,
      inferenceEvidence: expect.objectContaining({
        evidenceId: "executor-inference:node:intake",
      }),
    }))
  })

  it("links run metadata, trace event payload, and FailureReport back to Executor inference evidence", () => {
    const { topology } = compiledFixture()
    const observabilityMetadata = buildExecutorRunObservabilityMetadata({
      topology,
      topologyRunId: "topology-run:task014",
      entryNodeId: "node:intake",
      templateId: "work-order-template:customer-request-triage",
      contextPresetId: "context:customer-urgent",
      requestText: "긴급 고객 요청을 처리해줘",
      source: "executor_run_panel",
      workOrderId: "work-order:task014:intake",
      generatedAt: now,
    })
    const workOrder = workOrderFixture(observabilityMetadata)
    const traceEvent = createNodeRuntimeTraceEvent({
      workOrder,
      nodeRunId: "node-run:task014:intake",
      state: "failed_candidate",
      sequence: 1,
      at: now + 1,
      phase: "exhaustion",
      reasonCode: "final_failure_after_exhaustion",
    })
    const failure = attachExecutorFailureEvidence({
      failureReport: failureReportFixture(),
      workOrder,
      traceEvents: [traceEvent],
    })
    const runEvidence = observabilityMetadata[EXECUTOR_OBSERVABILITY_METADATA_KEY]
    const traceEvidence = traceEvent.payload?.[EXECUTOR_OBSERVABILITY_METADATA_KEY]
    const failureEvidence = failure.partialResult?.[EXECUTOR_FAILURE_OBSERVABILITY_METADATA_KEY]

    expect(runEvidence).toEqual(expect.objectContaining({
      evidenceId: "executor-run-evidence:topology-run:task014:node:intake",
      inferenceEvidenceRef: "executor-inference:node:intake",
      runtimeProfileSnapshotId: expect.stringContaining("runtime-profile:topology:task014:node:intake"),
      workOrderInference: expect.objectContaining({
        templateId: "work-order-template:customer-request-triage",
        contextPresetId: "context:customer-urgent",
        source: "executor_run_panel",
        requestText: "긴급 고객 요청을 처리해줘",
      }),
      nodeContractRef: expect.objectContaining({
        topologyId: "topology:task014",
        nodeId: "node:intake",
        sourceOfTruth: "executor_topology_v2",
      }),
    }))
    expect(traceEvidence).toEqual(expect.objectContaining({
      runEvidenceRef: "executor-run-evidence:topology-run:task014:node:intake",
      inferenceEvidenceRef: "executor-inference:node:intake",
      entryNodeContractId: "node:intake",
    }))
    expect(failureEvidence).toEqual(expect.objectContaining({
      evidenceId: "executor-failure-evidence:failure:task014",
      runEvidenceRef: "executor-run-evidence:topology-run:task014:node:intake",
      inferenceEvidenceRef: "executor-inference:node:intake",
      traceEventIds: ["trace:topology-run:task014:node-run:task014:intake:1"],
      userDescription: expect.objectContaining({
        description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
      }),
    }))
  })

  it("keeps raw evidence hidden in Simple results and visible in Advanced trace details", () => {
    const { topology, graph } = compiledFixture()
    const observabilityMetadata = buildExecutorRunObservabilityMetadata({
      topology,
      topologyRunId: "topology-run:task014",
      entryNodeId: "node:intake",
      templateId: "work-order-template:customer-request-triage",
      contextPresetId: "context:customer-urgent",
      requestText: "긴급 고객 요청을 처리해줘",
      source: "executor_run_panel",
      workOrderId: "work-order:task014:intake",
      generatedAt: now,
    })
    const workOrder = workOrderFixture(observabilityMetadata)
    const traceEvent = createNodeRuntimeTraceEvent({
      workOrder,
      nodeRunId: "node-run:task014:intake",
      state: "failed_candidate",
      sequence: 1,
      at: now + 1,
      phase: "exhaustion",
      reasonCode: "final_failure_after_exhaustion",
    })
    const failure = attachExecutorFailureEvidence({
      failureReport: failureReportFixture(),
      workOrder,
      traceEvents: [traceEvent],
    })
    const overlay = overlayFixture(observabilityMetadata, traceEvent, failure)
    const simpleHtml = renderToStaticMarkup(
      createElement(ExecutorRunResultPanel, {
        topology,
        graph,
        overlay,
      }),
    )
    const advancedHtml = renderToStaticMarkup(
      createElement(ExecutorRunResultPanel, {
        topology,
        graph,
        overlay,
        advancedOpen: true,
      }),
    )

    expect(simpleHtml).not.toContain("executor-result-observability-evidence")
    expect(simpleHtml).not.toContain("executor-run-evidence:topology-run:task014:node:intake")
    expect(simpleHtml).not.toContain("executor-inference:node:intake")
    expect(advancedHtml).toContain('data-testid="executor-result-observability-evidence"')
    expect(advancedHtml).toContain("executor-run-evidence:topology-run:task014:node:intake")
    expect(advancedHtml).toContain("executor-inference:node:intake")
    expect(advancedHtml).toContain("executor-failure-evidence:failure:task014")
  })

  it("verifies rollback restores ExecutorGraph projection metadata with the EnterpriseTopology version", () => {
    const { topology } = compiledFixture()
    const passed = buildExecutorGraphRollbackEvidence({
      restoredTopology: topology,
      expectedTopologyId: "topology:task014",
      expectedTopologyVersion: 7,
      expectedTopologyVersionId: "topology-version:task014:7",
      actualTopologyVersion: 7,
      actualTopologyVersionId: "topology-version:task014:7",
    })
    const missingMetadata = buildExecutorGraphRollbackEvidence({
      restoredTopology: {
        ...topology,
        metadata: {},
      },
      expectedTopologyId: "topology:task014",
      expectedTopologyVersion: 7,
      expectedTopologyVersionId: "topology-version:task014:7",
      actualTopologyVersion: 7,
      actualTopologyVersionId: "topology-version:task014:7",
    })

    expect(passed).toEqual(expect.objectContaining({
      status: "passed",
      metadataProjectionRestored: true,
      executorIdsMatch: true,
      connectionIdsMatch: true,
      confirmedUnderstandingRestored: true,
      sourceOfTruthPreserved: true,
    }))
    expect(missingMetadata.status).toBe("failed")
    expect(missingMetadata.blockingFailures).toEqual(expect.arrayContaining([
      "executor_graph_metadata_missing",
      "executor_projection_mismatch",
      "connection_projection_mismatch",
      "confirmed_understanding_mismatch",
    ]))
  })

  it("fails release readiness when rollback projection evidence is missing", () => {
    const gate = buildEnterpriseTopologyWorkspaceUsabilityGate({
      now: new Date("2026-05-02T18:00:00.000Z"),
      internalStability: {
        rollbackProjectionRestoreVerified: false,
      },
    })
    const summary = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-05-02T18:00:00.000Z"),
      workspaceUsability: gate,
    })

    expect(gate.status).toBe("failed")
    expect(summary.gateStatus).toBe("failed")
    expect(summary.blockingFailures.join("\n")).toContain(
      "workspace_usability:executor_graph_rollback_projection_restore_missing",
    )
    expect(summary.blockingFailures.join("\n")).toContain("topology_workspace_executor_first_usability")
  })

  it("documents evidence audit and rollback projection checks", () => {
    const runbook = readFileSync(new URL("../docs/release-runbook.md", import.meta.url), "utf-8")

    expect(runbook).toContain("Executor observability gate")
    expect(runbook).toContain("user description -> inference -> NodeContract -> WorkOrder -> FailureReport")
    expect(runbook).toContain("nobie.executor_graph.rollback_projection")
    expect(runbook).toContain("Executor evidence audit checks")
    expect(runbook).toContain("sourceOfTruth=executor_topology_v2")
  })
})

function compiledFixture(): {
  graph: ExecutorGraphWorkspace
  topology: EnterpriseTopology
} {
  const intake = confirmExecutorUnderstanding(createExecutorDraftFromInference({
    id: "node:intake",
    sourceNodeId: "node:intake",
    name: "고객 접수 담당자",
    description: "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
    now,
  }))
  const reviewer = confirmExecutorUnderstanding(createExecutorDraftFromInference({
    id: "node:reviewer",
    sourceNodeId: "node:reviewer",
    name: "검토자",
    description: "정리된 내용을 검토하고 승인 의견을 남긴다.",
    now,
  }))
  const graph = graphFixture([intake, reviewer], [
    createExecutorConnectionDraft({ source: intake, target: reviewer }),
  ])
  const compiled = compileExecutorGraphToEnterpriseTopology(graph, { now })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error("compile failed")
  return { graph, topology: compiled.topology }
}

function graphFixture(
  executors: ExecutorDraft[],
  connections: ExecutorConnectionDraft[],
): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task014",
    topologyId: "topology:task014",
    name: "Task014 observability graph",
    mode: "simple",
    executors,
    sections: [],
    connections,
    selectedId: executors[0]?.id ?? null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.84,
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

function workOrderFixture(observabilityMetadata: EnterpriseMetadata): WorkOrder {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    workOrderId: "work-order:task014:intake",
    topologyRunId: "topology-run:task014",
    parentWorkOrderId: null,
    fromNodeId: "node:intake",
    to: { type: "node", id: "node:intake" },
    objective: "고객 요청 처리",
    scope: { included: ["node:intake", "node:reviewer"], excluded: [] },
    input: {
      ...observabilityMetadata,
      requestText: "긴급 고객 요청을 처리해줘",
    },
    expectedOutputSchema: { type: "object" },
    successCriteria: [{
      criterionId: "criterion:summary",
      description: "고객 요청이 정리됨",
      required: true,
      validationKind: "evidence",
    }],
    permissionScope: {
      allowedToolIds: ["tool:crm-search"],
      allowedSystemIds: ["system:crm"],
      dataDomainIds: [],
      riskLevel: "unknown",
    },
    authorityScope: {
      requiredAuthorityRuleIds: [],
      approvalRequired: false,
    },
    failureReportRequired: true,
    delegationPath: ["node:intake"],
    createdAt: now,
  }
}

function failureReportFixture(): FailureReport {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    failureReportId: "failure:task014",
    topologyRunId: "topology-run:task014",
    nodeRunId: "node-run:task014:intake",
    workOrderId: "work-order:task014:intake",
    nodeId: "node:intake",
    exhaustionSummary: {
      selfExecutionAttempted: true,
      childDelegationAttempted: false,
      toolExecutionAttempted: true,
      retryAttempted: true,
      fallbackAttempted: false,
      partialSuccessChecked: true,
      parentRecoveryPossibleChecked: true,
      successCriteriaStillNotMet: true,
      complete: true,
    },
    attempts: [{
      attemptId: "attempt:task014:tool",
      kind: "tool_execution",
      status: "failed",
      at: now + 2,
      reasonCode: "tool_permission_missing",
      summary: "CRM permission was missing.",
    }],
    untriedOptions: ["fallback"],
    recommendedAction: "Review retry and fallback candidates",
    createdAt: now + 3,
  }
}

function overlayFixture(
  runMetadata: Record<string, unknown>,
  traceEvent: ReturnType<typeof createNodeRuntimeTraceEvent>,
  failureReport: FailureReport,
): TopologyRunTraceOverlayInput {
  return {
    run: {
      topologyRunId: "topology-run:task014",
      topologyId: "topology:task014",
      status: "failed",
      entryNodeId: "node:intake",
      startedAt: now,
      finishedAt: now + 4,
      createdAt: now,
      updatedAt: now + 4,
      metadata: runMetadata,
    },
    traceEvents: [{
      traceEventId: traceEvent.traceEventId,
      topologyRunId: traceEvent.topologyRunId,
      nodeRunId: traceEvent.nodeRunId,
      workOrderId: traceEvent.workOrderId,
      phase: traceEvent.phase,
      component: traceEvent.component,
      reasonCode: traceEvent.reasonCode,
      delegationPath: traceEvent.delegationPath,
      payload: traceEvent.payload,
      event: traceEvent,
      at: Number(traceEvent.at),
      sequence: 1,
      ...(traceEvent.parentWorkOrderId ? { parentWorkOrderId: traceEvent.parentWorkOrderId } : {}),
    }],
    toolCalls: [],
    failureReports: [{
      failureReportId: failureReport.failureReportId,
      topologyRunId: failureReport.topologyRunId,
      nodeRunId: failureReport.nodeRunId,
      workOrderId: failureReport.workOrderId,
      nodeId: failureReport.nodeId,
      failurePhase: "exhaustion",
      report: failureReport,
      createdAt: Number(failureReport.createdAt),
    }],
    observedEdges: [],
    gapFindings: [],
  }
}
