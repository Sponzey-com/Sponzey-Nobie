import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import type { AgentTopologyProjection } from "../packages/webui/src/contracts/topology.ts"
import type { NodeContract } from "../packages/webui/src/contracts/enterprise-topology.ts"
import type { EnterpriseTopologyCanvasNodeData } from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
import {
  TopologyWorkspaceCanvas,
  buildTopologyWorkspaceCanvasModel,
  topologyWorkspaceResourceNodeClassName,
} from "../packages/webui/src/components/topology/TopologyWorkspaceCanvas.tsx"
import {
  TopologyWorkspaceInspector,
  applyTopologyWorkspaceExecutorMappingToNode,
  buildTopologyWorkspaceExecutorMapping,
  buildTopologyWorkspaceRuntimeExecutorResourceOptions,
} from "../packages/webui/src/components/topology/TopologyWorkspaceInspector.tsx"
import {
  buildTopologyWorkspaceModel,
  buildTopologyWorkspaceSnapshot,
} from "../packages/webui/src/lib/topology-workspace.ts"
import { buildTopologyWorkspaceStarterDraft } from "../packages/webui/src/lib/topology-workspace-templates.ts"
import { resolveTopologyWorkspaceInitialLayer } from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"

const now = Date.UTC(2026, 3, 30, 20, 0, 0)

const runtimeResources: AgentTopologyProjection = {
  schemaVersion: 1,
  generatedAt: now,
  rootAgentId: "agent:nobie",
  nodes: [
    {
      id: "agent:intake",
      kind: "sub_agent",
      entityId: "agent:intake",
      label: "Intake Agent",
      status: "active",
      position: { x: 0, y: 0 },
      badges: ["customer-success"],
      data: {},
      diagnostics: [],
    },
    {
      id: "team:support",
      kind: "team",
      entityId: "team:support",
      label: "Support Team",
      status: "active",
      position: { x: 240, y: 0 },
      badges: ["support"],
      data: {},
      diagnostics: [],
    },
  ],
  edges: [
    {
      id: "edge:intake-support",
      kind: "team_membership",
      source: "agent:intake",
      target: "team:support",
      label: "member",
      valid: true,
      style: "membership",
      data: {},
      diagnostics: [],
    },
  ],
  inspectors: {
    agents: {
      "agent:intake": {
        agentId: "agent:intake",
        nodeId: "agent:intake",
        kind: "sub_agent",
        displayName: "Intake Agent",
        status: "active",
        role: "Receive customer requests",
        specialtyTags: ["customer-success"],
        teamIds: ["team:support"],
        source: "db",
        model: {
          providerId: "openai",
          modelId: "gpt-5.4",
          availability: "available",
          reasonCodes: [],
        },
        skillMcp: {
          enabledSkillIds: [],
          enabledMcpServerIds: ["crm"],
          enabledToolNames: ["crm.search"],
          disabledToolNames: [],
          secretScope: "configured",
        },
        tools: {
          enabledCount: 1,
          disabledCount: 0,
          enabledToolNames: ["crm.search"],
          disabledToolNames: [],
        },
        memory: {
          owner: "agent:intake",
          visibility: "team_visible",
          readScopeCount: 1,
          readScopes: ["customer"],
          writeScope: "agent:intake",
          retentionPolicy: "short_term",
          writebackReviewRequired: false,
        },
        capability: {
          riskCeiling: "medium",
          allowExternalNetwork: true,
          allowFilesystemWrite: false,
          allowShellExecution: false,
          allowScreenControl: false,
          allowedPathCount: 0,
          availability: "available",
          reasonCodes: [],
        },
        delegation: {
          enabled: true,
          maxParallelSessions: 2,
        },
        diagnostics: [],
      },
    },
    teams: {
      "team:support": {
        teamId: "team:support",
        nodeId: "team:support",
        displayName: "Support Team",
        status: "active",
        purpose: "Support customer requests",
        ownerAgentId: "agent:intake",
        leadAgentId: "agent:intake",
        memberAgentIds: ["agent:intake"],
        activeMemberAgentIds: ["agent:intake"],
        roleHints: ["support"],
        requiredTeamRoles: ["intake"],
        requiredCapabilityTags: ["customer-success"],
        members: [{
          agentId: "agent:intake",
          label: "Intake Agent",
          primaryRole: "intake",
          teamRoles: ["intake"],
          required: true,
          executionState: "active",
          directChild: true,
          active: true,
          reasonCodes: [],
          specialtyTags: ["customer-success"],
          capabilityIds: ["customer-success"],
          modelAvailability: "available",
          capabilityAvailability: "available",
        }],
        roleCoverage: {
          required: ["intake"],
          covered: ["intake"],
          missing: [],
          providers: { intake: ["agent:intake"] },
        },
        capabilityCoverage: {
          required: ["customer-success"],
          covered: ["customer-success"],
          missing: [],
          providers: { "customer-success": ["agent:intake"] },
        },
        health: {
          status: "healthy",
          executionCandidate: true,
          activeMemberCount: 1,
          referenceMemberCount: 1,
          unresolvedMemberCount: 0,
          excludedMemberCount: 0,
          degradedReasonCodes: [],
        },
        builder: {
          ownerAgentId: "agent:intake",
          directChildAgentIds: ["agent:intake"],
          candidates: [],
        },
        diagnostics: [],
      },
    },
  },
  layout: {
    schemaVersion: 1,
    layout: "task010",
    nodes: {},
    updatedAt: now,
  },
  diagnostics: [],
  validation: {
    hierarchy: { maxDepth: 8, maxChildCount: 8 },
    teamActiveMembershipRule: "owner_direct_child_required",
  },
}

function selectedTask(): EnterpriseTopologyCanvasNodeData {
  return {
    kind: "task",
    label: "요청 접수",
    detail: "draft",
    status: "draft",
    entityId: "node:intake",
    entityType: "node",
  }
}

function nodeContract(): NodeContract {
  return {
    schemaVersion: 1,
    entityType: "node",
    id: "node:intake",
    name: "요청 접수",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    tags: [],
    children: [],
    allowedToolIds: [],
    allowedSystemIds: [],
  }
}

describe("task010 topology workspace resources layer", () => {
  it("loads the agent topology projection into the resources layer", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceCanvas, {
        selectedLayer: "resources",
        runtimeResources,
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-resources-layer"')
    expect(html).toContain("Intake Agent")
    expect(html).toContain("Support Team")
    expect(html).toContain('data-source="runtime_resource"')
    expect(html).toContain("Health:")
    expect(html).toContain("Capability:")
    expect(html).toContain("openai/gpt-5.4")
  })

  it("keeps runtime resource nodes visually distinct from declared topology nodes", () => {
    const topology = buildTopologyWorkspaceStarterDraft("customer-request-flow", {
      topologyId: "topology:task010",
      now,
    })
    const model = buildTopologyWorkspaceModel({
      snapshot: buildTopologyWorkspaceSnapshot({ topology, runtimeResources }),
      selectedLayer: "resources",
    })
    const layerModel = buildTopologyWorkspaceCanvasModel({ workspaceModel: model })

    expect(layerModel.visibleDeclaredNodes).toHaveLength(0)
    expect(layerModel.resourceNodes).toHaveLength(2)
    expect(layerModel.resourceNodes.every((node) => node.data.source === "runtime_resource")).toBe(true)
    expect(layerModel.resourceNodes.every((node) => node.data.strokePattern === "dashed")).toBe(true)
    expect(topologyWorkspaceResourceNodeClassName("team")).toContain("border-dashed")
    expect(topologyWorkspaceResourceNodeClassName("team")).not.toBe(topologyWorkspaceResourceNodeClassName("agent"))
    expect(layerModel.resourceNodes[0]?.data.tooltip).toContain("Capability:")
  })

  it("uses resources layer data as executor picker choices without making AgentConfig the source of truth", () => {
    const options = buildTopologyWorkspaceRuntimeExecutorResourceOptions(runtimeResources)
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceInspector, {
        selectedData: selectedTask(),
        selectedNodeContract: nodeContract(),
        runtimeResources,
      }),
    )
    const mapping = buildTopologyWorkspaceExecutorMapping({
      nodeId: "node:intake",
      executorKind: "agent",
      executorId: "agent:intake",
      selectedAt: now,
    })
    const mappedNode = applyTopologyWorkspaceExecutorMappingToNode(nodeContract(), mapping)

    expect(options.map((option) => [option.kind, option.executorId])).toEqual([
      ["agent", "agent:intake"],
      ["team", "team:support"],
    ])
    expect(html).toContain('data-testid="topology-workspace-executor-resource-options"')
    expect(html).toContain('data-executor-id="agent:intake"')
    expect(html).toContain('data-executor-id="team:support"')
    expect(mappedNode.metadata?.runtimeSourceOfTruth).toBe("enterprise_node")
    expect(mappedNode.metadata?.runtimeExecutor).toEqual(expect.objectContaining({
      sourceOfTruth: "enterprise_node",
      executorKind: "agent",
      executorId: "agent:intake",
      createsAgentConfig: false,
    }))
    expect(mappedNode.metadata?.agentConfigId).toBeUndefined()
  })

  it("keeps runtime resources as an internal projection without exposing a resources workspace route", () => {
    const topologyPage = readFileSync(
      new URL("../packages/webui/src/pages/TopologyPage.tsx", import.meta.url),
      "utf-8",
    )
    const clientSource = readFileSync(
      new URL("../packages/webui/src/api/client.ts", import.meta.url),
      "utf-8",
    )

    expect(resolveTopologyWorkspaceInitialLayer("?mode=resources")).toBe("build")
    expect(resolveTopologyWorkspaceInitialLayer("?layer=trace")).toBe("trace")
    expect(resolveTopologyWorkspaceInitialLayer("?mode=unknown")).toBe("build")
    expect(clientSource).toContain('request<AgentTopologyResponse>("/api/agent-topology")')
    expect(clientSource).toContain("runtimeResources")
    expect(topologyPage).toContain("api.agentTopology")
    expect(topologyPage).not.toContain("/advanced/topology?mode=resources")
    expect(topologyPage).not.toContain("runtime-topology-workspace-resources-link")
    expect(topologyPage).toContain("Runtime Resource Topology")
    expect(topologyPage).not.toContain("EnterpriseTopologyCanvas")
  })
})
