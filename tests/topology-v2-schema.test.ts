import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
  isExecutorTopologyV2,
  validateExecutorTopologyV2,
  type ExecutorTopologyV2,
} from "../packages/core/src/topology/executor-topology-v2.ts"
import {
  TOPOLOGY_VALIDATOR_QUICK_FIX_CODES,
  validateEnterpriseTopologyCompatibility,
  validateTopology,
} from "../packages/core/src/topology/validator.ts"

const now = Date.UTC(2026, 4, 8, 10, 0, 0)

function topology(overrides: Partial<ExecutorTopologyV2> = {}): ExecutorTopologyV2 {
  return {
    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
    id: "workspace:draft",
    name: "Draft workspace",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "node:intake",
        name: "요청 정리",
        roleName: "intake",
        description: "요청을 정리하고 다음 실행자에게 위임합니다.",
        position: { x: 40, y: 80 },
        status: "active",
      },
      {
        id: "node:worker",
        name: "실행자",
        roleName: "worker",
        description: "위임받은 일을 실행합니다.",
        position: { x: 40, y: 240 },
        status: "active",
      },
    ],
    edges: [
      {
        id: "edge:intake-worker",
        sourceNodeId: "node:intake",
        targetNodeId: "node:worker",
        type: "delegates_to",
        status: "active",
      },
    ],
    ...overrides,
  }
}

function enterpriseNode(id: string, name: string): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id,
    name,
    displayName: name,
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    description: `${name}가 맡은 일을 처리합니다.`,
    instruction: `${name}가 맡은 일을 처리합니다.`,
    tags: [],
    children: [],
    allowedToolIds: [],
    allowedSystemIds: [],
    metadata: {
      executorTopologyV2: {
        schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
        nodeId: id,
      },
    },
  }
}

function enterpriseRelation(id: string, sourceNodeId: string, targetNodeId: string): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id,
    name: "넘김",
    displayName: "넘김",
    status: "active",
    createdAt: now,
    updatedAt: now,
    relationType: "delegates_to",
    from: { entityType: "node", id: sourceNodeId },
    to: { entityType: "node", id: targetNodeId },
  }
}

function enterpriseProjection(): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: "workspace:draft",
    name: "Draft workspace",
    displayName: "Draft workspace",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes: [
      enterpriseNode("node:intake", "요청 정리"),
      enterpriseNode("node:worker", "실행자"),
    ],
    teams: [],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [],
    tools: [],
    processes: [],
    relations: [enterpriseRelation("edge:intake-worker", "node:intake", "node:worker")],
    metadata: {
      executorTopologyV2: {
        schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
        sourceOfTruth: "executor_topology_v2",
      },
    },
  }
}

describe("ExecutorTopologyV2 schema", () => {
  it("accepts an executor-node and delegates_to edge source model", () => {
    const candidate = topology()
    const validation = validateExecutorTopologyV2(candidate)

    expect(validation).toEqual({ ok: true, issues: [] })
    expect(isExecutorTopologyV2(candidate)).toBe(true)
  })

  it("rejects stale V1 topology fields and node permission caches", () => {
    const candidate = {
      ...topology(),
      teams: [],
      relations: [],
      nodes: [
        {
          ...topology().nodes[0],
          children: ["node:worker"],
          allowedToolIds: ["tool:web-research"],
          allowedSystemIds: ["system:crm"],
        },
      ],
    }
    const validation = validateExecutorTopologyV2(candidate)

    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "stale_topology_field",
      "stale_node_field",
    ]))
    expect(validation.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "$.teams",
      "$.relations",
      "$.nodes[0].children",
      "$.nodes[0].allowedToolIds",
      "$.nodes[0].allowedSystemIds",
    ]))
  })

  it("rejects invalid edge types and missing endpoints", () => {
    const validation = validateExecutorTopologyV2({
      ...topology(),
      edges: [
        {
          id: "edge:bad",
          sourceNodeId: "node:intake",
          targetNodeId: "node:missing",
          type: "uses_tool",
          status: "active",
        },
      ],
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "invalid_edge_type",
      "invalid_edge_target",
    ]))
  })

  it("rejects self-loop edges, archived node connections, and projection-only metadata", () => {
    const validation = validateExecutorTopologyV2({
      ...topology(),
      metadata: {
        executorGraph: {
          workspace: { executors: [] },
        },
        aiSuggestionState: { suggestionRunId: "run:1" },
      },
      nodes: [
        {
          ...topology().nodes[0],
          metadata: {
            understanding: { userConfirmed: true },
            executorGraph: {
              inferredTools: ["tool:web"],
            },
          },
        },
        {
          ...topology().nodes[1],
          status: "archived",
        },
      ],
      edges: [
        {
          id: "edge:self",
          sourceNodeId: "node:intake",
          targetNodeId: "node:intake",
          type: "delegates_to",
          status: "active",
        },
        {
          id: "edge:archived",
          sourceNodeId: "node:intake",
          targetNodeId: "node:worker",
          type: "delegates_to",
          status: "active",
        },
      ],
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "self_loop_edge",
      "archived_edge_endpoint",
      "stale_metadata_field",
    ]))
    expect(validation.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "$.metadata.executorGraph.workspace",
      "$.metadata.aiSuggestionState",
      "$.nodes[0].metadata.understanding",
      "$.nodes[0].metadata.executorGraph.inferredTools",
    ]))
  })

  it("rejects duplicate ids and invalid node positions", () => {
    const validation = validateExecutorTopologyV2({
      ...topology(),
      nodes: [
        topology().nodes[0],
        {
          ...topology().nodes[0],
          position: { x: Number.NaN, y: "bad" },
        },
      ],
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "duplicate_node_id",
      "invalid_node_position_x",
      "invalid_node_position_y",
    ]))
  })

  it("rejects duplicate active executor names", () => {
    const validation = validateExecutorTopologyV2({
      ...topology(),
      nodes: [
        topology().nodes[0],
        {
          ...topology().nodes[1],
          name: "  요청   정리  ",
        },
      ],
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "duplicate_node_name",
        path: "$.nodes[1].name",
        nodeId: "node:worker",
      }),
    ]))
  })

  it("keeps the default persistence validation scoped to nodes and delegates_to edges", () => {
    const validation = validateTopology(enterpriseProjection())
    const compatibilityValidation = validateEnterpriseTopologyCompatibility(enterpriseProjection())

    expect(validation).toEqual({
      ok: true,
      executable: true,
      issues: [],
      issueCounts: { info: 0, warning: 0, blocked: 0, invalid: 0 },
    })
    expect(compatibilityValidation.issues.map((issue) => issue.reasonCode)).toEqual(expect.arrayContaining([
      "responsibility_matrix_missing",
      "failure_policy_missing",
      "recovery_policy_missing",
    ]))
  })

  it("does not expose V1 tool, system, or responsibility quick fixes as default validator quick fixes", () => {
    expect(TOPOLOGY_VALIDATOR_QUICK_FIX_CODES).not.toEqual(expect.arrayContaining([
      "tool_permission_missing",
      "system_permission_missing",
      "declared_tool_relation_missing",
      "declared_system_relation_missing",
      "responsibility_matrix_missing",
      "raci_accountable_missing",
    ]))
  })

  it("rejects V1 resource fields as stale schema fields instead of missing tool or system references", () => {
    const validation = validateExecutorTopologyV2({
      ...topology(),
      tools: [],
      systems: [],
      relations: [{
        id: "relation:intake-tool",
        relationType: "uses_tool",
        from: { entityType: "node", id: "node:intake" },
        to: { entityType: "enterprise_tool", id: "tool:missing" },
      }],
      nodes: [{
        ...topology().nodes[0],
        allowedToolIds: ["tool:missing"],
        allowedSystemIds: ["system:missing"],
      }],
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "stale_topology_field",
      "stale_node_field",
    ]))
    expect(validation.issues.map((issue) => issue.code)).not.toEqual(expect.arrayContaining([
      "missing_entity_reference",
      "tool_permission_missing",
      "system_permission_missing",
      "declared_tool_relation_missing",
      "declared_system_relation_missing",
    ]))
  })

  it("keeps endpoint repair structured and does not add name-based relation endpoint recovery", () => {
    const repairSource = readFileSync(new URL("../packages/core/src/topology/repair.ts", import.meta.url), "utf8")

    expect(repairSource).toContain("STRUCTURED_FROM_NODE_KEYS")
    expect(repairSource).toContain("STRUCTURED_TO_NODE_KEYS")
    expect(repairSource).not.toMatch(/"(fromName|sourceName|targetName|toName|fromDisplayName|targetDisplayName|toDisplayName)"/)
    expect(repairSource).toContain("not repaired from id or name text")
  })
})
