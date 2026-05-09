import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { AgentTopologyProjection } from "../packages/webui/src/contracts/topology.ts"
import type { EnterpriseTopologyRunTraceProjection } from "../packages/webui/src/lib/enterprise-topology-operations.ts"
import {
  buildTopologyWorkspaceModel,
  buildTopologyWorkspaceSnapshot,
  selectTopologyWorkspaceItem,
  selectTopologyWorkspaceLayer,
} from "../packages/webui/src/lib/topology-workspace.ts"
import { buildTopologyWorkspaceStarterDraft } from "../packages/webui/src/lib/topology-workspace-templates.ts"

const now = Date.UTC(2026, 3, 30, 13, 0, 0)

function capability(status: FeatureCapability["status"], reason?: string): FeatureCapability {
  return {
    key: "enterprise_topology_builder_ui",
    label: "Topology Workspace",
    area: "gateway",
    status,
    implemented: true,
    enabled: status === "ready",
    ...(reason ? { reason } : {}),
  }
}

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
      position: { x: 180, y: 0 },
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
    layout: "workspace-test",
    nodes: {},
    updatedAt: now,
  },
  diagnostics: [],
  validation: {
    hierarchy: { maxDepth: 8, maxChildCount: 8 },
    teamActiveMembershipRule: "owner_direct_child_required",
  },
}

function trace(topologyId: string): EnterpriseTopologyRunTraceProjection {
  return {
    run: {
      topologyRunId: "topology-run:1",
      topologyId,
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
        traceEventId: "trace:event:1",
        topologyRunId: "topology-run:1",
        nodeRunId: "node-run:1",
        workOrderId: "work-order:1",
        phase: "dispatch",
        component: "runtime",
        reasonCode: "started",
        delegationPath: ["node:customer-request-intake"],
        event: {
          phase: "dispatch",
          component: "runtime",
          reasonCode: "started",
          delegationPath: ["node:customer-request-intake"],
        },
        at: now,
        sequence: 1,
      },
    ],
    toolCalls: [],
    observedEdges: [
      {
        edgeId: "observed:intake-review",
        topologyId,
        topologyRunId: "topology-run:1",
        fromNodeId: "node:customer-request-intake",
        toNodeId: "node:customer-request-review",
        edgeKind: "delegates_to",
        source: "trace",
        confidence: 1,
        firstSeenAt: now,
        lastSeenAt: now + 1,
      },
    ],
    gapFindings: [{ id: "gap:1", kind: "observed_only_edge" }],
  }
}

describe("task003 topology workspace view model", () => {
  it("places the enterprise draft into the build layer model", () => {
    const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", {
      topologyId: "topology:workspace-test",
      now,
    })
    const snapshot = buildTopologyWorkspaceSnapshot({
      topology,
      capabilities: [capability("ready")],
    })
    const model = buildTopologyWorkspaceModel({ snapshot, selectedLayer: "build" })

    expect(model.topologyId).toBe("topology:workspace-test")
    expect(model.topology?.nodes.map((node) => node.name)).toEqual(["요청 접수", "요청 검토", "답변 정리"])
    expect(model.selectedLayer).toBe("build")
    expect(model.layers.build.enabled).toBe(true)
    expect(model.sourceOfTruth).toEqual(expect.objectContaining({
      topology: "enterprise_topology_registry",
      runtimeResources: "agent_team_registry",
      projectionOnly: true,
    }))
  })

  it("keeps runtime resources as a resources-layer projection", () => {
    const snapshot = buildTopologyWorkspaceSnapshot({
      topologyId: "topology:workspace-test",
      runtimeResources,
    })
    const model = buildTopologyWorkspaceModel({ snapshot, selectedLayer: "resources" })

    expect(model.runtimeResources.source).toBe("agent_topology")
    expect(model.runtimeResources.nodeCount).toBe(2)
    expect(model.runtimeResources.edgeCount).toBe(1)
    expect(model.runtimeResources.projection?.rootAgentId).toBe("agent:nobie")
    expect(model.layers.resources.enabled).toBe(true)
    expect(model.layers.resources.readOnly).toBe(true)
  })

  it("connects latest trace and recent run summaries to the same topology context", () => {
    const latestTrace = trace("topology:workspace-test")
    const snapshot = buildTopologyWorkspaceSnapshot({
      topologyId: "topology:workspace-test",
      latestTrace,
    })
    const mismatch = buildTopologyWorkspaceSnapshot({
      topologyId: "topology:other",
      latestTrace,
    })
    const model = buildTopologyWorkspaceModel({ snapshot, selectedLayer: "trace" })

    expect(model.runs.map((run) => run.topologyRunId)).toEqual(["topology-run:1"])
    expect(model.observed.latestTrace?.run.topologyId).toBe("topology:workspace-test")
    expect(model.observed.traceEventCount).toBe(1)
    expect(model.observed.observedEdgeCount).toBe(1)
    expect(model.gaps).toHaveLength(1)
    expect(mismatch.latestTrace).toBeNull()
  })

  it("preserves selection while switching layers and supports common selection kinds", () => {
    const snapshot = buildTopologyWorkspaceSnapshot({ topologyId: "topology:workspace-test" })
    const model = buildTopologyWorkspaceModel({ snapshot, selectedLayer: "build" })
    const selected = selectTopologyWorkspaceItem(model, {
      kind: "node",
      nodeId: "node:customer-request-intake",
      entityType: "node",
    })
    const traceLayer = selectTopologyWorkspaceLayer(selected, "trace")
    const issueSelection = selectTopologyWorkspaceItem(traceLayer, {
      kind: "issue",
      issueId: "issue:missing-entry",
      source: "validation",
      targetId: "node:customer-request-intake",
    })

    expect(traceLayer.selectedLayer).toBe("trace")
    expect(traceLayer.selection).toEqual(selected.selection)
    expect(issueSelection.selection).toEqual(expect.objectContaining({
      kind: "issue",
      source: "validation",
      targetId: "node:customer-request-intake",
    }))
  })

  it("uses capabilities and feature flags to disable gated layers with reasons", () => {
    const snapshot = buildTopologyWorkspaceSnapshot({
      topologyId: "topology:workspace-test",
      capabilities: [capability("disabled", "builder disabled by test")],
      featureFlags: [
        { featureKey: "topology_runtime_enabled", mode: "off", reason: "runtime disabled by test" },
        { featureKey: "declared_observed_topology_analysis", mode: "off", reason: "analysis disabled by test" },
      ],
    })
    const model = buildTopologyWorkspaceModel({ snapshot, selectedLayer: "build" })

    expect(model.layers.build).toEqual(expect.objectContaining({
      enabled: false,
      readOnly: true,
      reason: "builder disabled by test",
    }))
    expect(model.layers.run.reason).toBe("runtime disabled by test")
    expect(model.layers.trace.enabled).toBe(false)
    expect(model.layers.improve.reason).toBe("analysis disabled by test")
    expect(model.layers.resources.enabled).toBe(true)
  })

  it("exposes a client snapshot aggregator instead of requiring pages to compose every API directly", () => {
    const clientSource = readFileSync(new URL("../packages/webui/src/api/client.ts", import.meta.url), "utf-8")

    expect(clientSource).toContain("topologyWorkspaceSnapshot")
    expect(clientSource).toContain("/api/agent-topology")
    expect(clientSource).toContain("/api/topology-templates")
    expect(clientSource).toContain("/api/relation-templates")
    expect(clientSource).toContain("/api/work-order-templates")
    expect(clientSource).toContain("buildTopologyWorkspaceSnapshot")
  })
})

