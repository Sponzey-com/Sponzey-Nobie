import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import type { AgentTopologyProjection } from "../packages/webui/src/contracts/topology.ts"
import type { EnterpriseTopologyRunTraceProjection } from "../packages/webui/src/lib/enterprise-topology-operations.ts"
import {
  buildTopologyWorkspaceModel,
  buildTopologyWorkspaceSnapshot,
} from "../packages/webui/src/lib/topology-workspace.ts"
import { buildTopologyWorkspaceStarterDraft } from "../packages/webui/src/lib/topology-workspace-templates.ts"
import {
  TopologyWorkspaceCanvas,
  buildTopologyWorkspaceCanvasModel,
  topologyWorkspaceCanvasLegend,
} from "../packages/webui/src/components/topology/TopologyWorkspaceCanvas.tsx"

const now = Date.UTC(2026, 3, 30, 14, 0, 0)

const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", {
  topologyId: "topology:workspace-canvas",
  now,
})

const runtimeResources: AgentTopologyProjection = {
  schemaVersion: 1,
  generatedAt: now,
  rootAgentId: "agent:nobie",
  nodes: [
    {
      id: "agent:nobie",
      kind: "nobie",
      entityId: "agent:nobie",
      label: "Nobie",
      status: "active",
      position: { x: 0, y: 0 },
      badges: [],
      data: {},
      diagnostics: [],
    },
    {
      id: "team:support",
      kind: "team",
      entityId: "team:support",
      label: "Support Team",
      status: "active",
      position: { x: 200, y: 0 },
      badges: [],
      data: {},
      diagnostics: [],
    },
  ],
  edges: [
    {
      id: "edge:nobie-support",
      kind: "team_membership",
      source: "agent:nobie",
      target: "team:support",
      label: "member",
      valid: true,
      style: "membership",
      data: {},
      diagnostics: [],
    },
  ],
  inspectors: { agents: {}, teams: {} },
  layout: {
    schemaVersion: 1,
    layout: "workspace-canvas-test",
    nodes: {},
    updatedAt: now,
  },
  diagnostics: [],
  validation: {
    hierarchy: { maxDepth: 8, maxChildCount: 8 },
    teamActiveMembershipRule: "owner_direct_child_required",
  },
}

function trace(): EnterpriseTopologyRunTraceProjection {
  return {
    run: {
      topologyRunId: "topology-run:canvas",
      topologyId: "topology:workspace-canvas",
      status: "completed",
      entryNodeId: "node:customer-request-intake",
      startedAt: now,
      finishedAt: now + 1,
      createdAt: now,
      updatedAt: now + 1,
    },
    nodeRuns: [],
    workOrders: [],
    resultReports: [],
    failureReports: [],
    traceEvents: [
      {
        traceEventId: "trace:event:dispatch",
        topologyRunId: "topology-run:canvas",
        nodeRunId: "node-run:intake",
        workOrderId: "work-order:intake",
        phase: "dispatch",
        component: "runtime",
        reasonCode: "started",
        delegationPath: ["node:customer-request-intake", "node:customer-request-review"],
        event: {
          phase: "dispatch",
          component: "runtime",
          reasonCode: "started",
          delegationPath: ["node:customer-request-intake", "node:customer-request-review"],
        },
        at: now,
        sequence: 1,
      },
    ],
    toolCalls: [],
    observedEdges: [
      {
        edgeId: "observed:intake-review",
        topologyId: "topology:workspace-canvas",
        topologyRunId: "topology-run:canvas",
        fromNodeId: "node:customer-request-intake",
        toNodeId: "node:customer-request-review",
        edgeKind: "delegates_to",
        source: "trace",
        confidence: 1,
        firstSeenAt: now,
        lastSeenAt: now + 1,
      },
    ],
    gapFindings: [{ id: "gap:observed-only", kind: "observed_only_edge" }],
  }
}

function workspaceModel(layer: "build" | "run" | "trace" | "improve" | "resources") {
  return buildTopologyWorkspaceModel({
    snapshot: buildTopologyWorkspaceSnapshot({
      topology,
      runtimeResources,
      latestTrace: trace(),
    }),
    selectedLayer: layer,
  })
}

describe("task004 topology workspace canvas layers", () => {
  it("shows declared topology nodes and edges in the build layer", () => {
    const layerModel = buildTopologyWorkspaceCanvasModel({ workspaceModel: workspaceModel("build") })

    expect(layerModel.layer).toBe("build")
    expect(layerModel.visibleDeclaredNodes.map((node) => node.data.source)).toEqual([
      "declared",
      "declared",
      "declared",
    ])
    expect(layerModel.visibleDeclaredEdges).toHaveLength(2)
    expect(layerModel.resourceNodes).toHaveLength(0)
    expect(layerModel.observedEdges).toHaveLength(0)
    expect(layerModel.legend.map((item) => item.id)).toEqual(["declared-node", "declared-edge"])
  })

  it("keeps trace overlay edges in the same declared canvas coordinate system", () => {
    const traceOverlay = {
      run: trace().run,
      traceEvents: trace().traceEvents,
      toolCalls: [],
      failureReports: [],
    }
    const layerModel = buildTopologyWorkspaceCanvasModel({
      workspaceModel: workspaceModel("trace"),
      traceOverlay,
    })
    const tracedEdge = layerModel.visibleDeclaredEdges.find((edge) => edge.id === "relation:customer-request-intake-review")

    expect(layerModel.visibleDeclaredNodes.map((node) => node.id)).toContain("node:node:customer-request-intake")
    expect(tracedEdge?.source).toBe("node:node:customer-request-intake")
    expect(tracedEdge?.target).toBe("node:node:customer-request-review")
    expect(tracedEdge?.className).toContain("topology-workspace-trace-edge")
    expect(tracedEdge?.style?.stroke).toBe("#0284c7")
    expect(layerModel.legend.map((item) => item.id)).toContain("trace-path")
  })

  it("renders runtime resources as muted dashed resource nodes", () => {
    const layerModel = buildTopologyWorkspaceCanvasModel({ workspaceModel: workspaceModel("resources") })
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, { workspaceModel: workspaceModel("resources") }),
    )

    expect(layerModel.visibleDeclaredNodes).toHaveLength(0)
    expect(layerModel.resourceNodes.map((node) => node.data.source)).toEqual(["runtime_resource", "runtime_resource"])
    expect(layerModel.resourceNodes.every((node) => node.data.muted)).toBe(true)
    expect(layerModel.resourceNodes.every((node) => node.data.strokePattern === "dashed")).toBe(true)
    expect(layerModel.resourceEdges[0]?.style?.strokeDasharray).toBe("6 4")
    expect(html).toContain('data-testid="topology-workspace-resources-layer"')
    expect(html).toContain('data-testid="topology-workspace-resource-node"')
    expect(html).toContain("Support Team")
  })

  it("shows observed-only edges in the improve layer with dashed styling", () => {
    const layerModel = buildTopologyWorkspaceCanvasModel({ workspaceModel: workspaceModel("improve") })

    expect(layerModel.visibleDeclaredEdges).toHaveLength(2)
    expect(layerModel.observedEdges).toHaveLength(1)
    expect(layerModel.observedEdges[0]).toEqual(expect.objectContaining({
      id: "observed:observed:intake-review",
      className: "topology-workspace-observed-edge",
    }))
    expect(layerModel.observedEdges[0]?.style?.strokeDasharray).toBe("6 4")
    expect(layerModel.observedEdges[0]?.data?.source).toBe("observed")
    expect(layerModel.legend.map((item) => item.id)).toEqual(["declared", "observed"])
  })

  it("changes legend content by layer and includes label plus stroke pattern semantics", () => {
    expect(topologyWorkspaceCanvasLegend("build").map((item) => [item.labelKo, item.strokePattern])).toEqual([
      ["업무 항목", "solid"],
      ["연결", "solid"],
    ])
    expect(topologyWorkspaceCanvasLegend("trace").map((item) => item.id)).toEqual([
      "trace-path",
      "trace-failed",
      "trace-candidate",
    ])
    expect(topologyWorkspaceCanvasLegend("resources").map((item) => item.strokePattern)).toEqual(["dashed", "dashed"])
  })
})

