import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import { runMigrations } from "../packages/core/src/db/migrations.ts"
import {
  createEnterpriseTopologyRegistry,
  enterpriseTopologyFromExecutorTopologyV2,
  loadExecutorTopologyV2ReadModelFromRegistry,
  materializeExecutorTopologyV2ReadModelInRegistry,
  previewExecutorTopologyV2RegistryMigration,
  repairExecutorTopologyV2ForPersistence,
  validateExecutorTopologyV2,
  type ExecutorTopologyV2,
} from "../packages/core/src/index.ts"

const require = createRequire(import.meta.url)
type SqliteStatement = {
  run(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
  get(...args: unknown[]): unknown
}
type SqliteDatabase = {
  exec(sql: string): void
  pragma(sql: string): unknown
  prepare(sql: string): SqliteStatement
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  close(): void
}
type BetterSqlite3Factory = new (filename: string) => SqliteDatabase
const BetterSqlite3 = require("../packages/core/node_modules/better-sqlite3") as BetterSqlite3Factory

const now = Date.UTC(2026, 4, 8, 16, 0, 0)

function migratedDb(): SqliteDatabase {
  const db = new BetterSqlite3(":memory:")
  db.pragma("foreign_keys = ON")
  runMigrations(db as Parameters<typeof runMigrations>[0])
  return db
}

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
    description: `${input.name} 역할을 수행합니다.`,
    instruction: `${input.name} 역할을 수행합니다.`,
    tags: [],
    children: input.children ?? [],
    allowedToolIds: ["tool:legacy-web"],
    allowedSystemIds: ["system:legacy-crm"],
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

function relation(id: string, sourceNodeId: string, targetNodeId: string): EnterpriseRelation {
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
        children: ["node:worker", "node:ghost"],
        metadata: {
          executorGraph: {
            workspace: {
              executors: [{ id: "node:lead", inferredTools: ["tool:legacy-web"] }],
            },
            inferredRuntimeMode: "auto",
            inferredTools: ["tool:legacy-web"],
            advancedMapping: { allowedToolIds: ["tool:legacy-web"] },
            position: { x: 80, y: 120 },
          },
        },
      }),
      node({ id: "node:worker", name: "실행자" }),
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
    relations: [relation("relation:lead-worker", "node:lead", "node:worker")],
    metadata: {
      executorGraph: {
        workspace: {
          executors: [{ id: "node:lead", inferredTools: ["tool:legacy-web"] }],
        },
      },
      active_default_workflow_candidate: "node:lead",
      recommendedEntry: "node:lead",
      inferredTools: ["tool:legacy-web"],
    },
  }
}

function dirtyV2(): ExecutorTopologyV2 {
  return {
    schemaVersion: 2,
    id: "workspace:draft",
    name: "업무 흐름",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes: [{
      id: "node:lead",
      name: "리더",
      roleName: "리더",
      description: "작업을 위임합니다.",
      position: { x: 80, y: 120 },
      status: "active",
      metadata: {
        executorGraph: {
          workspace: { executors: [{ id: "node:lead", inferredTools: ["tool:legacy-web"] }] },
          inferredTools: ["tool:legacy-web"],
        },
        active_default_workflow_candidate: "node:lead",
      },
      children: ["node:worker"],
      allowedToolIds: ["tool:legacy-web"],
      allowedSystemIds: ["system:legacy-crm"],
    } as unknown as ExecutorTopologyV2["nodes"][number]],
    edges: [],
    metadata: {
      executorGraph: {
        workspace: { connections: [] },
      },
      recommendedEntry: "node:lead",
    },
  } as unknown as ExecutorTopologyV2
}

describe("stale executor graph metadata gate", () => {
  it("removes stale workspace, permission, and default-entry metadata from V2 persistence payloads", () => {
    const repaired = repairExecutorTopologyV2ForPersistence(dirtyV2()).topology
    const materialized = enterpriseTopologyFromExecutorTopologyV2(repaired)
    const repairedJson = JSON.stringify(repaired)
    const materializedJson = JSON.stringify(materialized)

    expect(validateExecutorTopologyV2(repaired)).toEqual({ ok: true, issues: [] })
    expect(repairedJson).not.toContain('"workspace"')
    expect(repairedJson).not.toContain("tool:legacy-web")
    expect(repairedJson).not.toContain("system:legacy-crm")
    expect(repairedJson).not.toContain("active_default_workflow_candidate")
    expect(repairedJson).not.toContain("recommendedEntry")
    expect(repairedJson).not.toContain('"children"')
    expect(repairedJson).not.toContain("allowedToolIds")
    expect(repairedJson).not.toContain("allowedSystemIds")
    expect(materializedJson).not.toContain('"workspace"')
    expect(materializedJson).not.toContain("tool:legacy-web")
    expect(materialized.nodes.every((node) => node.children.length === 0)).toBe(true)
    expect(materialized.nodes.every((node) => node.allowedToolIds.length === 0)).toBe(true)
    expect(materialized.nodes.every((node) => node.allowedSystemIds.length === 0)).toBe(true)
  })

  it("dry-runs and materializes the active DB topology as a stale-free V2 read model while preserving history", () => {
    const db = migratedDb()
    try {
      const registry = createEnterpriseTopologyRegistry({
        db: db as Parameters<typeof runMigrations>[0],
        now: () => now,
      })
      const appended = registry.appendTopologyVersion({ topology: legacyTopology(), createdBy: "test" })
      const activated = registry.activateTopologyVersion("workspace:draft", appended.version.version)
      expect(activated.ok).toBe(true)

      const preview = previewExecutorTopologyV2RegistryMigration({
        registry,
        materializedAt: now + 1,
      })
      expect(preview.ok).toBe(true)
      expect(preview.dryRun).toBe(true)
      expect(preview.sourceVersion).toBe(1)
      expect(preview.staleIssueCount).toBeGreaterThan(0)
      expect(preview.historyPreserved).toBe(true)
      expect(JSON.stringify(preview.runtimeReadModel)).not.toContain('"workspace"')
      expect(JSON.stringify(preview.materializedTopology)).not.toContain("tool:legacy-web")

      const materialized = materializeExecutorTopologyV2ReadModelInRegistry({
        registry,
        createdBy: "migration:test",
        materializedAt: now + 2,
      })
      expect(materialized.ok).toBe(true)
      expect(registry.getTopology("workspace:draft")?.activeVersion).toBe(2)
      expect(registry.listVersions("workspace:draft").map((version) => version.version)).toEqual([2, 1])
      expect(JSON.stringify(registry.getVersion("workspace:draft", 1)?.topology)).toContain("tool:legacy-web")
      expect(JSON.stringify(registry.exportTopology("workspace:draft")?.version.topology)).not.toContain("tool:legacy-web")
      expect(registry.exportTopology("workspace:draft")?.version.importSource).toBe("executor_topology_v2_materialize")

      const reloaded = loadExecutorTopologyV2ReadModelFromRegistry({ registry })
      expect(reloaded.ok).toBe(true)
      expect(reloaded.topology?.schemaVersion).toBe(2)
      expect(JSON.stringify(reloaded.topology)).not.toContain('"workspace"')
    } finally {
      db.close()
    }
  })
})
