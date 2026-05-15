import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  previewExecutorTopologyV2RegistryMigration,
} from "../packages/core/src/topology/executor-topology-v2.ts"
import type {
  EnterpriseTopologyRegistryStore,
  TopologyExportEnvelope,
} from "../packages/core/src/topology/registry.ts"

const now = Date.UTC(2026, 4, 10, 9, 0, 0)

function node(input: {
  id: string
  name: string
  children?: string[]
  metadata?: NodeContract["metadata"]
}): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id: input.id,
    name: input.name,
    displayName: input.name,
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    description: `${input.name} 업무를 처리합니다.`,
    instruction: `${input.name} 업무를 처리합니다.`,
    tags: [],
    children: input.children ?? [],
    allowedToolIds: ["tool:legacy-market"],
    allowedSystemIds: ["system:legacy-terminal"],
    failurePolicy: {
      failureReportRequired: true,
      allowPartialSuccess: true,
      fallbackNodeIds: [],
    },
    recoveryPolicy: {
      retryAllowed: true,
      redelegationAllowed: true,
      fallbackAllowed: true,
      partialSuccessAllowed: true,
    },
    metadata: input.metadata,
  }
}

function relation(input: {
  id: string
  relationType: EnterpriseRelation["relationType"]
  from: EnterpriseRelation["from"]
  to: EnterpriseRelation["to"]
}): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id: input.id,
    name: input.id,
    displayName: input.id,
    status: "active",
    createdAt: now,
    updatedAt: now,
    relationType: input.relationType,
    from: input.from,
    to: input.to,
  }
}

function legacyTopology(): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: "workspace:draft",
    name: "업무 흐름",
    displayName: "업무 흐름",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes: [
      node({
        id: "node:lead",
        name: "리더",
        children: ["node:worker", "node:missing"],
        metadata: {
          executorGraph: {
            workspace: {
              executors: [{ id: "node:lead", inferredTools: ["tool:legacy-market"] }],
            },
            inferredRuntimeMode: "auto",
            inferredTools: ["tool:legacy-market"],
            advancedMapping: { allowedToolIds: ["tool:legacy-market"] },
            position: { x: 100, y: 120 },
          },
          suggestionHistory: [{
            suggestionRunId: "suggestion:legacy",
            selectedAlternativeId: "alt-1",
            alternativeSummaries: ["legacy"],
          }],
        },
      }),
      node({ id: "node:worker", name: "실행자" }),
    ],
    teams: [{
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "team",
      id: "team:legacy",
      name: "Legacy Team",
      status: "active",
      createdAt: now,
      updatedAt: now,
      nodeIds: ["node:lead"],
      tags: [],
    }],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [{
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "enterprise_system",
      id: "system:legacy-terminal",
      name: "Legacy Terminal",
      status: "active",
      createdAt: now,
      updatedAt: now,
      ownerNodeId: "node:lead",
      capabilities: [],
      dataClasses: [],
      integrationMode: "manual",
    }] as EnterpriseTopology["systems"],
    tools: [{
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "enterprise_tool",
      id: "tool:legacy-market",
      name: "Legacy Market Tool",
      status: "active",
      createdAt: now,
      updatedAt: now,
      toolType: "browser",
      ownerNodeId: "node:lead",
      capabilities: [],
      riskLevel: "low",
      approvalRequired: false,
    }] as EnterpriseTopology["tools"],
    processes: [],
    relations: [
      relation({
        id: "relation:lead-worker",
        relationType: "delegates_to",
        from: { entityType: "node", id: "node:lead" },
        to: { entityType: "node", id: "node:worker" },
      }),
      relation({
        id: "relation:lead-tool",
        relationType: "uses_tool",
        from: { entityType: "node", id: "node:lead" },
        to: { entityType: "enterprise_tool", id: "tool:legacy-market" },
      }),
    ],
    metadata: {
      executorGraph: {
        workspace: {
          executors: [{ id: "node:lead", inferredTools: ["tool:legacy-market"] }],
        },
      },
      recommendedEntry: "node:lead",
      active_default_workflow_candidate: "node:lead",
    },
  }
}

function registryFor(topology: EnterpriseTopology, calls: { append: number }): EnterpriseTopologyRegistryStore {
  const envelope: TopologyExportEnvelope = {
    topologyRecord: {
      topologyId: topology.id,
      name: topology.name,
      status: "active",
      activeVersion: 3,
      activeVersionId: `${topology.id}@3`,
      createdAt: now,
      updatedAt: now,
    },
    version: {
      versionId: `${topology.id}@3`,
      topologyId: topology.id,
      version: 3,
      topology,
      sourceHash: "fixture",
      validationSnapshotId: "validation:fixture",
      createdAt: now,
    },
    validationSnapshot: {
      snapshotId: "validation:fixture",
      topologyId: topology.id,
      versionId: `${topology.id}@3`,
      version: 3,
      executable: true,
      validation: {
        ok: true,
        executable: true,
        issueCounts: { info: 0, warning: 0, blocked: 0, invalid: 0 },
        issues: [],
      },
      createdAt: now,
    },
  }
  return {
    appendTopologyVersion: () => {
      calls.append += 1
      throw new Error("dry-run must not append topology versions")
    },
    activateTopologyVersion: () => {
      throw new Error("dry-run must not activate topology versions")
    },
    rollbackTopologyVersion: () => {
      throw new Error("not used")
    },
    archiveTopology: () => null,
    listTopologies: () => [envelope.topologyRecord],
    getTopology: () => envelope.topologyRecord,
    listVersions: () => [envelope.version],
    getVersion: () => envelope.version,
    exportTopology: () => envelope,
    listHistory: () => [],
  }
}

describe("ExecutorTopologyV2 migration dry-run report", () => {
  it("reports removed, transformed, and preserved fields without writing registry state", () => {
    const calls = { append: 0 }
    const preview = previewExecutorTopologyV2RegistryMigration({
      registry: registryFor(legacyTopology(), calls),
      materializedAt: now + 1,
    })
    const report = preview.report

    expect(preview.ok).toBe(true)
    expect(calls.append).toBe(0)
    expect(report).toMatchObject({
      reportVersion: 1,
      dryRun: true,
      writePlanned: false,
      destructiveChangesPlanned: false,
      backupRequired: true,
      rollbackSupported: true,
      approvalRequiredForDestructiveChanges: true,
      topologyId: "workspace:draft",
      sourceVersion: 3,
      sourceVersionId: "workspace:draft@3",
    })
    expect(report?.summary).toMatchObject({
      sourceNodeCount: 2,
      sourceDelegateEdgeCount: 1,
      runtimeNodeCount: 2,
      runtimeEdgeCount: 1,
    })
    expect(report?.removedFields.map((field) => field.path)).toEqual(expect.arrayContaining([
      "$.teams",
      "$.systems",
      "$.tools",
      "$.metadata.executorGraph.workspace",
      "$.metadata.recommendedEntry",
      "$.metadata.active_default_workflow_candidate",
      "$.nodes[0].children",
      "$.nodes[0].allowedToolIds",
      "$.nodes[0].allowedSystemIds",
      "$.nodes[0].metadata.executorGraph.workspace",
      "$.nodes[0].metadata.executorGraph.inferredRuntimeMode",
      "$.nodes[0].metadata.executorGraph.inferredTools",
      "$.nodes[0].metadata.executorGraph.advancedMapping",
      "$.nodes[0].metadata.suggestionHistory",
      "$.relations[1]",
    ]))
    expect(report?.transformedFields.map((field) => field.targetPath)).toEqual(expect.arrayContaining([
      "$.nodes",
      "$.edges[id=edge:relation:lead-worker]",
    ]))
    expect(report?.preservedFields.map((field) => field.path)).toEqual(expect.arrayContaining([
      "$",
      "$.nodes[0]",
      "$.nodes[1]",
      "enterprise_topology_versions",
      "enterprise_topology_history",
      "topology_runs",
      "topology_trace_events",
      "run_subsessions",
    ]))
    expect(report?.removedFields.every((field) => field.destructive === false)).toBe(true)
    expect(report?.rollbackProcedure.join("\n")).toContain("Do not physically delete legacy rows")
    expect(JSON.stringify(preview.runtimeReadModel)).not.toContain("tool:legacy-market")
    expect(JSON.stringify(preview.materializedTopology)).not.toContain("tool:legacy-market")
  })
})
