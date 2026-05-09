import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import type {
  EnterpriseTopologyObservedEdgeRecord,
} from "../packages/webui/src/lib/enterprise-topology-operations.ts"
import {
  TopologyImprovePanel,
  buildTopologyImproveActionPlans,
  buildTopologyImproveFindings,
  resolveTopologyImprovePreviewTransition,
} from "../packages/webui/src/components/topology/TopologyImprovePanel.tsx"
import {
  TopologyWorkspaceCanvas,
} from "../packages/webui/src/components/topology/TopologyWorkspaceCanvas.tsx"
import type {
  TopologyRunTraceOverlayInput,
} from "../packages/webui/src/components/topology/TopologyRunTraceOverlay.tsx"
import { buildTopologyWorkspaceStarterDraft } from "../packages/webui/src/lib/topology-workspace-templates.ts"

const now = Date.UTC(2026, 4, 2, 15, 0, 0)
const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", {
  topologyId: "topology:task011-simple",
  now,
})

const observedEdge: EnterpriseTopologyObservedEdgeRecord = {
  edgeId: "observed:review-intake",
  topologyId: topology.id,
  topologyRunId: "topology-run:task011-simple",
  fromNodeId: "node:customer-request-review",
  toNodeId: "node:customer-request-intake",
  edgeKind: "delegation_path",
  source: "trace",
  confidence: 0.91,
  firstSeenAt: now,
  lastSeenAt: now + 1,
}

const observedGap = {
  findingId: "finding:observed-review-intake",
  topologyId: topology.id,
  topologyRunId: "topology-run:task011-simple",
  findingKind: "observed_only_relation",
  severity: "medium",
  status: "open",
  summary: "Observed relation is not Declared.",
  recommendation: "If this observed path is correct, add it to declared relations.",
  relatedEntities: [
    { entityType: "node", id: "node:customer-request-review" },
    { entityType: "node", id: "node:customer-request-intake" },
  ],
  detail: {
    reasonCode: "observed_relation_not_declared",
    relationType: "delegates_to",
  },
  createdAt: now,
  updatedAt: now,
}

const permissionGap = {
  findingId: "finding:crm-permission",
  topologyId: topology.id,
  topologyRunId: "topology-run:task011-simple",
  findingKind: "tool_permission_missing",
  severity: "high",
  summary: "Tool permission missing",
  recommendation: "Add missing permission.",
  relatedEntities: [
    { entityType: "node", id: "node:customer-request-intake" },
  ],
  detail: {
    reasonCode: "tool_permission_missing",
    toolId: "tool:crm-search",
    recentFailureReason: "tool_permission_missing",
  },
}

const failureGap = {
  findingId: "finding:intake-failure",
  topologyId: topology.id,
  topologyRunId: "topology-run:task011-simple",
  findingKind: "failure_node_missing_fallback",
  severity: "high",
  summary: "Failure node missing fallback",
  recommendation: "Add fallback",
  failureCount: 3,
  recentFailureReason: "success criteria still not met",
  relatedEntities: [
    { entityType: "node", id: "node:customer-request-intake" },
  ],
  detail: {
    reasonCode: "failure_node_missing_fallback",
  },
}

const approvalGap = {
  findingId: "finding:approval-bottleneck",
  topologyId: topology.id,
  topologyRunId: "topology-run:task011-simple",
  findingKind: "approval_bottleneck",
  severity: "medium",
  summary: "Approval bottleneck",
  recommendation: "Add approval route",
  relatedEntities: [
    { entityType: "node", id: "node:customer-request-review" },
  ],
  detail: {
    reasonCode: "single_approver_multiple_targets",
  },
}

const gapFindings = [observedGap, permissionGap, failureGap, approvalGap]

describe("task011 simple improve panel", () => {
  it("renders the default improve panel as easy Korean cards without Declared or Observed terms", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyImprovePanel, {
        topology,
        traceOverlay: overlay(),
        gapFindings,
        observedEdges: [observedEdge],
      }),
    )

    expect(html).toContain('data-testid="topology-improve-panel"')
    expect(html).toContain("고칠 점")
    expect(html).toContain("실제 실행과 다른 점")
    expect(html).toContain("필요한 권한")
    expect(html).not.toContain("Declared")
    expect(html).not.toContain("Observed")
    expect(html).not.toContain("observed_only_relation")
    expect(html).not.toContain("observed_relation_not_declared")
  })

  it("normalizes findings into user-facing categories and action cards", () => {
    const findings = buildTopologyImproveFindings({
      gapFindings,
      observedEdges: [observedEdge],
      topology,
    })
    const html = renderToStaticMarkup(
      createElement(TopologyImprovePanel, {
        topology,
        traceOverlay: overlay(),
        gapFindings,
        observedEdges: [observedEdge],
      }),
    )

    expect(findings.map((finding) => finding.category)).toEqual([
      "execution_drift",
      "permission",
      "frequent_failure",
      "blocked_connection",
    ])
    expect(html).toContain('data-testid="topology-improve-category-summary"')
    expect(html).toContain("tool:crm-search 권한이 필요합니다.")
    expect(html).toContain("최근 실행에서 3회 실패했습니다.")
    expect(html).toContain("승인 대기나 한 명에게 몰린 연결")
    expect(html).toContain("변경 미리보기")
  })

  it("does not apply an observed-only edge until the user confirms the preview", () => {
    const relationCountBefore = topology.relations.length
    const plan = buildTopologyImproveActionPlans({ finding: observedGap, topology, now })[0]
    const preview = resolveTopologyImprovePreviewTransition({
      intent: "preview",
      findingId: "finding:observed-review-intake",
      plan,
    })
    const html = renderToStaticMarkup(
      createElement(TopologyImprovePanel, {
        topology,
        traceOverlay: overlay(),
        gapFindings: [observedGap],
        observedEdges: [observedEdge],
      }),
    )

    expect(plan?.operations[0]?.op).toBe("createRelation")
    expect(preview.shouldApply).toBe(false)
    expect(preview.operations).toEqual([])
    expect(preview.pendingPreview).toEqual({
      findingId: "finding:observed-review-intake",
      quickFixId: "connect_selected_nodes",
    })
    expect(topology.relations).toHaveLength(relationCountBefore)
    expect(html).toContain('data-action-mode="preview_required"')
    expect(html).not.toContain("topology-improve-apply-confirmed")
  })

  it("requires confirmation and supports cancel before applying operations", () => {
    const plan = buildTopologyImproveActionPlans({ finding: observedGap, topology, now })[0]
    const cancel = resolveTopologyImprovePreviewTransition({
      intent: "cancel",
      findingId: "finding:observed-review-intake",
      plan,
    })
    const apply = resolveTopologyImprovePreviewTransition({
      intent: "apply",
      findingId: "finding:observed-review-intake",
      plan,
    })
    const html = renderToStaticMarkup(
      createElement(TopologyImprovePanel, {
        topology,
        traceOverlay: overlay(),
        gapFindings: [observedGap],
        observedEdges: [observedEdge],
        initialPendingPreview: {
          findingId: "finding:observed-review-intake",
          quickFixId: "connect_selected_nodes",
        },
      }),
    )

    expect(html).toContain('data-testid="topology-improve-preview-confirmation"')
    expect(html).toContain('data-testid="topology-improve-preview-cancel"')
    expect(html).toContain('data-testid="topology-improve-apply-confirmed-connect_selected_nodes"')
    expect(cancel.shouldApply).toBe(false)
    expect(cancel.operations).toEqual([])
    expect(apply.shouldApply).toBe(true)
    expect(apply.operations).toHaveLength(1)
  })

  it("keeps raw gap and observed edge debug details inside advanced information", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyImprovePanel, {
        topology,
        traceOverlay: overlay(),
        gapFindings: [observedGap],
        observedEdges: [observedEdge],
        advancedOpen: true,
      }),
    )

    expect(html).toContain('data-testid="topology-improve-advanced-debug"')
    expect(html).toContain("observed_only_relation")
    expect(html).toContain("observed:review-intake")
    expect(html).toContain('data-testid="topology-improve-raw-observed-edge"')
  })

  it("keeps the fixed simple sidebar instead of switching to an improve-only panel", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, {
        selectedLayer: "improve",
        exposureMode: "simple",
        topology,
        traceOverlay: overlay(),
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-simple-executor-layout"')
    expect(html).toContain('data-testid="topology-workspace-simple-sidebar"')
    expect(html).toContain('data-testid="executor-run-result-panel"')
    expect(html).toContain('data-testid="executor-inspector"')
    expect(html).not.toContain('data-testid="topology-improve-panel"')
  })
})

function overlay(): TopologyRunTraceOverlayInput {
  return {
    run: {
      topologyRunId: "topology-run:task011-simple",
      topologyId: topology.id,
      status: "failed",
      entryNodeId: "node:customer-request-intake",
      startedAt: now,
      finishedAt: now + 2,
      createdAt: now,
      updatedAt: now + 2,
    },
    traceEvents: [],
    toolCalls: [],
    failureReports: [],
    observedEdges: [observedEdge],
    gapFindings,
  }
}
