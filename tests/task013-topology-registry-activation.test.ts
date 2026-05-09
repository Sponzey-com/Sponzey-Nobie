import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { registerTopologyRoutes } from "../packages/core/src/api/routes/topologies.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { verifyMigrationState } from "../packages/core/src/db/migration-safety.ts"
import { runMigrations } from "../packages/core/src/db/migrations.ts"
import {
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
  type CompiledTopologySnapshot,
  type EnterpriseTopology,
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
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: {
    method: string
    url: string
    payload?: unknown
    headers?: Record<string, string>
    remoteAddress?: string
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>
}

const now = Date.UTC(2026, 3, 29, 8, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function topologyFixture(): EnterpriseTopology {
  const topology = structuredClone(buildExampleEnterpriseTopology(now))
  topology.status = "active"
  topology.nodes = topology.nodes.map((node) => ({ ...node, status: "active" }))
  return topology
}

function migratedDb(): SqliteDatabase {
  const db = new BetterSqlite3(":memory:")
  db.pragma("foreign_keys = ON")
  runMigrations(db as Parameters<typeof runMigrations>[0])
  return db
}

function registryFor(db: SqliteDatabase) {
  return createEnterpriseTopologyRegistry({
    db: db as Parameters<typeof runMigrations>[0],
    now: () => now,
  })
}

function invalidTopologyFixture(): EnterpriseTopology {
  const topology = topologyFixture()
  const [firstNode] = topology.nodes
  if (firstNode === undefined) throw new Error("expected first node")
  delete (firstNode as Partial<typeof firstNode>).failurePolicy
  return topology
}

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task013-topology-registry-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

afterEach(() => {
  closeDb()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
})

describe("task013 durable topology registry and activation", () => {
  it("adds durable registry tables through migration rehearsal", () => {
    const db = migratedDb()
    try {
      const report = verifyMigrationState(db as Parameters<typeof verifyMigrationState>[0])
      expect(report.ok).toBe(true)
      expect(report.schemaVersion).toBeGreaterThanOrEqual(41)
      expect(report.requiredTables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "enterprise_topologies",
          "enterprise_topology_versions",
          "enterprise_topology_history",
          "compiled_topology_snapshots",
          "topology_validation_snapshots",
        ]),
      )
    } finally {
      db.close()
    }
  })

  it("stores topology versions append-only with validation and compiled snapshots", () => {
    const db = migratedDb()
    try {
      const registry = registryFor(db)
      const topologyV1 = topologyFixture()
      const first = registry.appendTopologyVersion({ topology: topologyV1, createdBy: "tester" })
      const topologyV2 = topologyFixture()
      topologyV2.name = "Customer Success Topology v2"
      topologyV2.updatedAt = now + 1
      topologyV2.nodes[0] = {
        ...topologyV2.nodes[0]!,
        name: "Customer Request Intake v2",
      }
      const second = registry.appendTopologyVersion({ topology: topologyV2, createdBy: "tester" })

      expect(first.version.version).toBe(1)
      expect(second.version.version).toBe(2)
      expect(registry.listVersions(topologyV1.id).map((version) => version.version)).toEqual([2, 1])
      expect(registry.getVersion(topologyV1.id, 1)?.topology.name).toBe("Customer Success Topology")
      expect(registry.getVersion(topologyV1.id, 2)?.topology.name).toBe("Customer Success Topology v2")
      expect(first.validationSnapshot.executable).toBe(true)
      expect(first.compiledSnapshot?.snapshot.sourceTopologyVersion).toBe("1")
      expect(second.compiledSnapshot?.snapshot.sourceTopologyVersion).toBe("2")
    } finally {
      db.close()
    }
  })

  it("blocks activation when validation snapshot is blocked or invalid", () => {
    const db = migratedDb()
    try {
      const registry = registryFor(db)
      const appended = registry.appendTopologyVersion({ topology: invalidTopologyFixture() })
      const activation = registry.activateTopologyVersion(appended.version.topologyId, appended.version.version)

      expect(appended.validationSnapshot.executable).toBe(false)
      expect(appended.compiledSnapshot).toBeUndefined()
      expect(activation.ok).toBe(false)
      if (!activation.ok) {
        expect(activation.reasonCode).toBe("topology_validation_blocked")
        expect(activation.issues).toContain("failure_policy_missing")
      }
      expect(registry.getTopology(appended.version.topologyId)?.activeVersion).toBeUndefined()
      expect(registry.listHistory(appended.version.topologyId).map((event) => event.eventType)).toContain("activation_blocked")
    } finally {
      db.close()
    }
  })

  it("blocks activation when compiled snapshot source version mismatches the stored version", () => {
    const db = migratedDb()
    try {
      const registry = registryFor(db)
      const appended = registry.appendTopologyVersion({ topology: topologyFixture() })
      const compiled = appended.compiledSnapshot?.snapshot
      if (compiled === undefined) throw new Error("expected compiled snapshot")
      const mismatched: CompiledTopologySnapshot = {
        ...compiled,
        sourceTopologyVersion: "999",
      }
      db.prepare(
        `UPDATE compiled_topology_snapshots
         SET source_topology_version = ?, snapshot_json = ?
         WHERE snapshot_id = ?`,
      ).run("999", JSON.stringify(mismatched), compiled.compiledTopologySnapshotId)

      const activation = registry.activateTopologyVersion(appended.version.topologyId, appended.version.version)

      expect(activation.ok).toBe(false)
      if (!activation.ok) {
        expect(activation.reasonCode).toBe("compiled_snapshot_source_mismatch")
        expect(activation.issues).toContain("compiled_source_version_mismatch")
      }
      expect(registry.getTopology(appended.version.topologyId)?.activeVersion).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it("rolls back the active topology pointer with validation and compiled snapshot context", () => {
    const db = migratedDb()
    try {
      const registry = registryFor(db)
      const topologyV1 = topologyFixture()
      const first = registry.appendTopologyVersion({ topology: topologyV1 })
      const topologyV2 = topologyFixture()
      topologyV2.name = "Customer Success Topology v2"
      topologyV2.updatedAt = now + 1
      const second = registry.appendTopologyVersion({ topology: topologyV2 })

      const activated = registry.activateTopologyVersion(topologyV1.id, second.version.version)
      expect(activated.ok).toBe(true)
      expect(registry.getTopology(topologyV1.id)?.activeVersion).toBe(2)

      const rollback = registry.rollbackTopologyVersion(topologyV1.id, first.version.version)

      expect(rollback.ok).toBe(true)
      if (rollback.ok) {
        expect(rollback.topologyRecord.activeVersion).toBe(1)
        expect(rollback.validationSnapshot.snapshotId).toBe(first.validationSnapshot.snapshotId)
        expect(rollback.compiledSnapshot.snapshot.compiledTopologySnapshotId).toBe(first.compiledSnapshot?.snapshotId)
        expect(rollback.history.eventType).toBe("rolled_back")
      }
      expect(registry.exportTopology(topologyV1.id)?.version.version).toBe(1)
    } finally {
      db.close()
    }
  })

  it("supports import/export and registry API route smoke", async () => {
    useTempState()
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const topology = topologyFixture()
      const imported = await app.inject({
        method: "POST",
        url: "/api/topologies/import",
        payload: {
          topology,
          activate: true,
          createdBy: "route-test",
        },
      })

      expect(imported.statusCode, imported.json().message as string | undefined).toBe(201)
      expect(imported.json().ok).toBe(true)

      const listed = await app.inject({ method: "GET", url: "/api/topologies" })
      expect(listed.statusCode).toBe(200)
      expect((listed.json().topologies as Array<{ topologyId: string }>).map((item) => item.topologyId)).toContain(topology.id)

      const exported = await app.inject({
        method: "GET",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/export`,
      })
      expect(exported.statusCode).toBe(200)
      const body = exported.json()
      expect((body.export as { version: { version: number } }).version.version).toBe(1)
      expect((body.export as { compiledSnapshot: { snapshot: { sourceTopologyVersion: string } } }).compiledSnapshot.snapshot.sourceTopologyVersion).toBe("1")
    } finally {
      await app.close()
    }
  })
})
