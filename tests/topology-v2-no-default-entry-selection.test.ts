import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  buildAgentExecutionContextFromGraphSnapshot,
} from "../packages/core/src/orchestration/execution-context-builder.ts"
import {
  buildExecutionGraphSnapshot,
  EXECUTION_GRAPH_ROOT_AGENT_ID,
  WORKSPACE_DRAFT_TOPOLOGY_ID,
} from "../packages/core/src/orchestration/execution-graph-snapshot.ts"
import { createEnterpriseTopologyRegistry } from "../packages/core/src/topology/registry.ts"

const now = Date.UTC(2026, 4, 8, 0, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

beforeEach(() => {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-topology-v2-no-default-entry-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function node(id: string, name: string): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id,
    name,
    displayName: name,
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

function delegatesTo(id: string, fromNodeId: string, toNodeId: string): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id,
    name: id,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType: "delegates_to",
    from: { entityType: "node", id: fromNodeId },
    to: { entityType: "node", id: toNodeId },
  }
}

function topology(): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: WORKSPACE_DRAFT_TOPOLOGY_ID,
    name: "Workspace default entry guard",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    metadata: {
      active_default_workflow_candidate: "node:finance",
    },
    nodes: [
      node("node:lead", "마당쇠"),
      node("node:finance", "행랑아범"),
      node("node:backend", "삼식이"),
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
    relations: [
      delegatesTo("relation:lead-backend", "node:lead", "node:backend"),
    ],
  }
}

function persistTopology(): void {
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  registry.appendTopologyVersion({
    topology: topology(),
    createdBy: "topology-v2-no-default-entry-selection-test",
  })
}

describe("topology v2 direct child selection", () => {
  it("does not select active_default_workflow_candidate or the first unparented node for root requests", () => {
    persistTopology()

    const graph = buildExecutionGraphSnapshot({
      mode: "workspace",
      currentExecutorId: EXECUTION_GRAPH_ROOT_AGENT_ID,
      now: () => now,
    })
    const rootDirectChildren = [
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:finance`,
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:lead`,
    ]

    expect(graph.rootDirectChildAgentIds).toEqual(rootDirectChildren)
    expect(graph.availableExecutorIds).toEqual(rootDirectChildren)
    expect(graph.trace.available_executor_ids).toEqual(rootDirectChildren)
    expect(graph.validationIssues.map((issue) => issue.code)).not.toContain("active_default_workflow_candidate")
    expect(graph.edges.map((edge) => edge.source)).toEqual(expect.arrayContaining(["unparented_root", "topology_relation"]))
    expect(graph.edges.filter((edge) => edge.source === "unparented_root").map((edge) => edge.childAgentId)).toEqual(rootDirectChildren)
  })

  it("uses only outgoing edge targets when the current executor is a child node", () => {
    persistTopology()
    const leadId = `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:lead`
    const backendId = `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:backend`

    const graph = buildExecutionGraphSnapshot({
      mode: "workspace",
      currentExecutorId: leadId,
      now: () => now,
    })
    const context = buildAgentExecutionContextFromGraphSnapshot({
      graph,
      request: {
        kind: "delegation_request",
        structured_goal: "백엔드 실행자에게 넘길 수 있는지 판단한다.",
      },
      requester: {
        requester_id: EXECUTION_GRAPH_ROOT_AGENT_ID,
        requester_type: "executor",
      },
    })

    expect(graph.availableExecutorIds).toEqual([backendId])
    expect(context.accessible_executors.map((executor) => executor.executor_id)).toEqual([backendId])
    expect(context.diagnostic_executors?.map((executor) => executor.executor_id)).toEqual(expect.arrayContaining([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:finance`,
    ]))
  })
})
