import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import type {
  EnterpriseTopologyObservedEdgeRecord,
  EnterpriseTopologyRunTraceProjection,
} from "../packages/webui/src/lib/enterprise-topology-operations.ts"
import type { EnterpriseTopologyValidationIssue } from "../packages/webui/src/contracts/enterprise-topology.ts"
import {
  TopologyImprovePanel,
  buildTopologyImproveActionPlans,
} from "../packages/webui/src/components/topology/TopologyImprovePanel.tsx"
import {
  TopologyRunTraceOverlay,
  type TopologyRunTraceOverlayInput,
} from "../packages/webui/src/components/topology/TopologyRunTraceOverlay.tsx"
import {
  TopologyValidationAssistant,
  buildTopologyWorkspaceIssues,
} from "../packages/webui/src/components/topology/TopologyValidationAssistant.tsx"
import {
  buildTopologyWorkspaceCanvasModel,
} from "../packages/webui/src/components/topology/TopologyWorkspaceCanvas.tsx"
import {
  buildTopologyWorkspaceModel,
  buildTopologyWorkspaceSnapshot,
} from "../packages/webui/src/lib/topology-workspace.ts"
import { buildTopologyWorkspaceStarterDraft } from "../packages/webui/src/lib/topology-workspace-templates.ts"

const now = Date.UTC(2026, 3, 30, 21, 0, 0)
const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", {
  topologyId: "topology:task011",
  now,
})

const observedEdge: EnterpriseTopologyObservedEdgeRecord = {
  edgeId: "observed:review-intake",
  topologyId: topology.id,
  topologyRunId: "topology-run:task011",
  fromNodeId: "node:customer-request-review",
  toNodeId: "node:customer-request-intake",
  edgeKind: "delegation_path",
  source: "trace",
  confidence: 0.91,
  firstSeenAt: now,
  lastSeenAt: now + 1,
}

const gapFinding = {
  findingId: "finding:observed-review-intake",
  topologyId: topology.id,
  topologyRunId: "topology-run:task011",
  findingKind: "observed_only_relation",
  severity: "medium",
  status: "open",
  summary: "실제 실행 경로가 설계에 없습니다.",
  recommendation: "실제 경로가 맞다면 선언된 연결 후보로 추가하세요.",
  relatedEntities: [
    { entityType: "node", id: "node:customer-request-review" },
    { entityType: "node", id: "node:customer-request-intake" },
  ],
  relatedRelations: [],
  relatedRuns: ["topology-run:task011"],
  detail: {
    reasonCode: "observed_relation_not_declared",
    relationType: "delegates_to",
  },
  createdAt: now,
  updatedAt: now,
}

function overlay(): TopologyRunTraceOverlayInput {
  return {
    run: {
      topologyRunId: "topology-run:task011",
      topologyId: topology.id,
      status: "failed",
      entryNodeId: "node:customer-request-intake",
      startedAt: now,
      finishedAt: now + 2,
      createdAt: now,
      updatedAt: now + 2,
    },
    traceEvents: [{
      traceEventId: "trace:task011:path",
      topologyRunId: "topology-run:task011",
      nodeRunId: "node-run:intake",
      workOrderId: "work-order:intake",
      phase: "child_delegation",
      component: "runtime",
      reasonCode: "delegation_path_recorded",
      delegationPath: ["node:customer-request-intake", "node:customer-request-review"],
      event: {
        schemaVersion: 1,
        traceEventId: "trace:task011:path",
        topologyRunId: "topology-run:task011",
        nodeRunId: "node-run:intake",
        workOrderId: "work-order:intake",
        phase: "child_delegation",
        component: "runtime",
        reasonCode: "delegation_path_recorded",
        delegationPath: ["node:customer-request-intake", "node:customer-request-review"],
        at: now,
      },
      at: now,
      sequence: 1,
    }],
    toolCalls: [],
    failureReports: [{
      failureReportId: "failure:task011",
      topologyRunId: "topology-run:task011",
      nodeRunId: "node-run:intake",
      workOrderId: "work-order:intake",
      nodeId: "node:customer-request-intake",
      failurePhase: "exhaustion",
      report: {
        schemaVersion: 1,
        failureReportId: "failure:task011",
        topologyRunId: "topology-run:task011",
        nodeRunId: "node-run:intake",
        workOrderId: "work-order:intake",
        nodeId: "node:customer-request-intake",
        exhaustionSummary: {
          selfExecutionAttempted: true,
          childDelegationAttempted: true,
          toolExecutionAttempted: false,
          retryAttempted: false,
          fallbackAttempted: false,
          partialSuccessChecked: false,
          parentRecoveryPossibleChecked: true,
          successCriteriaStillNotMet: true,
        },
        attempts: [],
        untriedOptions: ["fallback"],
        recommendedAction: "Review retry and fallback candidates",
        createdAt: now,
      },
      createdAt: now,
    }],
    observedEdges: [observedEdge],
    gapFindings: [gapFinding],
  }
}

function traceProjection(): EnterpriseTopologyRunTraceProjection {
  const current = overlay()
  return {
    run: current.run!,
    nodeRuns: [],
    workOrders: [],
    resultReports: [],
    failureReports: current.failureReports,
    traceEvents: current.traceEvents,
    toolCalls: current.toolCalls,
    observedEdges: current.observedEdges ?? [],
    gapFindings: current.gapFindings ?? [],
  }
}

function validationIssue(): EnterpriseTopologyValidationIssue {
  return {
    severity: "warning",
    path: "$.nodes[0].failurePolicy",
    code: "topology.warning",
    message: "fallback path missing",
    reasonCode: "fallback_path_missing",
    entityType: "node",
    entityId: "node:customer-request-intake",
  }
}

describe("task011 topology workspace trace and improve layer", () => {
  it("shows run trace path and observed summary from the workspace overlay", () => {
    const html = renderToStaticMarkup(createElement(TopologyRunTraceOverlay, { overlay: overlay() }))

    expect(html).toContain('data-testid="topology-trace-delegation-path"')
    expect(html).toContain("node:customer-request-intake -&gt; node:customer-request-review")
    expect(html).toContain('data-testid="topology-trace-observed-summary"')
    expect(html).toContain("Review retry and fallback candidates")
  })

  it("keeps failure reports, validation issues, and gap findings in the same source-aware drawer", () => {
    const issues = buildTopologyWorkspaceIssues({
      validationIssues: [validationIssue()],
      runtimeOverlay: overlay(),
      gapFindings: [gapFinding],
      topology,
    })
    const html = renderToStaticMarkup(
      createElement(TopologyValidationAssistant, {
        issues: [validationIssue()],
        runtimeOverlay: overlay(),
        gapFindings: [gapFinding],
        topology,
      }),
    )

    expect(issues.map((issue) => issue.source)).toEqual(expect.arrayContaining(["validation", "runtime", "gap"]))
    expect(issues.find((issue) => issue.source === "gap")?.targetId).toBe("node:node:customer-request-review")
    expect(html).toContain('data-testid="topology-workspace-issue-source-validation"')
    expect(html).toContain('data-testid="topology-workspace-issue-source-runtime"')
    expect(html).toContain('data-testid="topology-workspace-issue-source-gap"')
  })

  it("draws observed-only and missing-declared candidates with styles separate from declared edges", () => {
    const workspaceModel = buildTopologyWorkspaceModel({
      snapshot: buildTopologyWorkspaceSnapshot({
        topology,
        latestTrace: traceProjection(),
        gapFindings: [gapFinding],
      }),
      selectedLayer: "improve",
    })
    const layerModel = buildTopologyWorkspaceCanvasModel({ workspaceModel })
    const observed = layerModel.declaredModel.edges.find((edge) => edge.id === `observed:${observedEdge.edgeId}`)
    const candidate = layerModel.declaredModel.edges.find((edge) => edge.id.startsWith("gap-candidate:"))

    expect(layerModel.observedEdges[0]?.data?.source).toBe("observed")
    expect(observed?.className).toContain("topology-workspace-observed-edge-dotted")
    expect(observed?.style?.strokeDasharray).toBe("2 5")
    expect(candidate?.className).toBe("topology-workspace-gap-candidate-edge")
    expect(candidate?.style?.strokeDasharray).toBe("6 3")
  })

  it("renders clickable gap findings and previews improve actions before apply", () => {
    const actionPlans = buildTopologyImproveActionPlans({ finding: gapFinding, topology, now })
    const html = renderToStaticMarkup(
      createElement(TopologyImprovePanel, {
        topology,
        traceOverlay: overlay(),
        gapFindings: [gapFinding],
        observedEdges: [observedEdge],
      }),
    )

    expect(actionPlans[0]?.label).toBe("실제 경로를 연결 후보로 추가")
    expect(actionPlans[0]?.operations[0]?.op).toBe("createRelation")
    expect(html).toContain('data-testid="topology-improve-gap-finding"')
    expect(html).toContain('data-target-id="node:node:customer-request-review"')
    expect(html).toContain('data-testid="topology-improve-action-preview"')
    expect(html).toContain("실제 경로를 연결 후보로 추가")
  })

  it("shows an empty improve state and run CTA before the first run", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyImprovePanel, {
        topology,
        traceOverlay: null,
        gapFindings: [],
        observedEdges: [],
      }),
    )

    expect(html).toContain('data-testid="topology-improve-empty-state"')
    expect(html).toContain('data-testid="topology-improve-run-cta"')
  })
})
