import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { registerTopologyAnalysisRoutes } from "../packages/core/src/api/routes/topology-analysis.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { runMigrations } from "../packages/core/src/db/migrations.ts"
import {
  analyzeTopologyGaps,
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
  extractObservedTopologyEdges,
  type EnterpriseTopology,
  type ObservedTopologyEdge,
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

const now = Date.UTC(2026, 3, 29, 10, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function topologyFixture(): EnterpriseTopology {
  const topology = structuredClone(buildExampleEnterpriseTopology(now))
  topology.status = "active"
  topology.nodes = topology.nodes.map((node) => ({ ...node, status: "active" }))
  return topology
}

function observedEdge(input: {
  relationType: ObservedTopologyEdge["relationType"]
  fromType: ObservedTopologyEdge["from"]["entityType"]
  fromId: string
  toType: ObservedTopologyEdge["to"]["entityType"]
  toId: string
  topologyRunId?: string
}): ObservedTopologyEdge {
  const edge: ObservedTopologyEdge = {
    edgeId: `observed:test:${input.relationType}:${input.fromId}:${input.toId}`,
    topologyId: "topology:customer-success",
    relationType: input.relationType,
    edgeKind: input.relationType === "owns" ? "observed_owner" : input.relationType === "uses_tool" ? "tool_call" : "delegation_path",
    from: { entityType: input.fromType, id: input.fromId },
    to: { entityType: input.toType, id: input.toId },
    source: "manual",
    confidence: 0.9,
    firstSeenAt: now,
    lastSeenAt: now,
    evidence: { test: true },
  }
  if (input.topologyRunId !== undefined) edge.topologyRunId = input.topologyRunId
  return edge
}

function coreDb(db: SqliteDatabase): Parameters<typeof runMigrations>[0] {
  return db as Parameters<typeof runMigrations>[0]
}

function migratedDb(): SqliteDatabase {
  const db = new BetterSqlite3(":memory:")
  db.pragma("foreign_keys = ON")
  runMigrations(coreDb(db))
  return db
}

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task015-topology-analysis-"))
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

describe("task015 declared vs observed topology analysis", () => {
  it("detects single point of failure and missing backup with recommendations", () => {
    const analysis = analyzeTopologyGaps({
      topology: topologyFixture(),
      observedEdges: [],
      now,
    })

    const singlePoint = analysis.findings.find((finding) => finding.findingKind === "single_point_of_failure")
    const missingBackup = analysis.findings.find((finding) => finding.findingKind === "missing_backup")

    expect(singlePoint).toMatchObject({
      severity: "high",
      detail: expect.objectContaining({ reasonCode: "execution_node_without_backup" }),
    })
    expect(singlePoint?.recommendation).toContain("fallback node")
    expect(missingBackup).toMatchObject({
      severity: "medium",
      detail: expect.objectContaining({ reasonCode: "failure_node_missing_fallback" }),
    })
  })

  it("detects approval bottlenecks from declared approval relations", () => {
    const topology = topologyFixture()
    topology.relations.push({
      schemaVersion: 1,
      entityType: "relation",
      id: "relation:lead-approves-intake",
      name: "Lead approves intake",
      status: "active",
      createdAt: now,
      updatedAt: now,
      relationType: "approves",
      from: { entityType: "position", id: "position:cs-lead" },
      to: { entityType: "node", id: "node:intake" },
    }, {
      schemaVersion: 1,
      entityType: "relation",
      id: "relation:lead-approves-triage",
      name: "Lead approves triage",
      status: "active",
      createdAt: now,
      updatedAt: now,
      relationType: "approves",
      from: { entityType: "position", id: "position:cs-lead" },
      to: { entityType: "node", id: "node:triage" },
    })

    const analysis = analyzeTopologyGaps({ topology, observedEdges: [], now })
    const bottleneck = analysis.findings.find((finding) => finding.findingKind === "approval_bottleneck")

    expect(bottleneck).toMatchObject({
      severity: "high",
      relatedRelations: ["relation:lead-approves-intake", "relation:lead-approves-triage"],
      detail: expect.objectContaining({ reasonCode: "single_approver_multiple_targets" }),
    })
    expect(bottleneck?.recommendation).toContain("backup approvers")
  })

  it("detects declared owner and observed owner mismatch", () => {
    const analysis = analyzeTopologyGaps({
      topology: topologyFixture(),
      observedEdges: [
        observedEdge({
          relationType: "owns",
          fromType: "position",
          fromId: "position:ops-lead",
          toType: "node",
          toId: "node:intake",
          topologyRunId: "topology-run:owner-drift",
        }),
      ],
      now,
    })

    const mismatch = analysis.findings.find((finding) => {
      return finding.findingKind === "mismatched_relation"
        && finding.detail.reasonCode === "declared_observed_owner_mismatch"
    })

    expect(mismatch).toMatchObject({
      topologyRunId: "topology-run:owner-drift",
      severity: "high",
    })
    expect(mismatch?.relatedEntities.map((entity) => `${entity.entityType}:${entity.id}`)).toEqual(
      expect.arrayContaining(["position:position:ops-lead", "position:position:cs-lead", "node:node:intake"]),
    )
  })

  it("classifies observed-only relations for undeclared runtime tool usage", () => {
    const analysis = analyzeTopologyGaps({
      topology: topologyFixture(),
      observedEdges: [
        observedEdge({
          relationType: "uses_tool",
          fromType: "node",
          fromId: "node:triage",
          toType: "enterprise_tool",
          toId: "tool:crm-search",
          topologyRunId: "topology-run:undeclared-tool",
        }),
      ],
      now,
    })

    expect(analysis.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "observed_only",
          relationType: "uses_tool",
          reasonCode: "observed_relation_not_declared",
        }),
      ]),
    )
    expect(analysis.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          findingKind: "observed_only_relation",
          severity: "high",
        }),
      ]),
    )
  })

  it("extracts observed delegation, tool, failure, fallback, and owner edges from trace store rows", () => {
    const db = migratedDb()
    try {
      db.prepare(
        `INSERT INTO topology_runs
         (topology_run_id, topology_id, topology_version, status, entry_node_id, started_at, finished_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("topology-run:extract", "topology:customer-success", 15, "failed", "node:intake", now, now + 10, now, now)
      db.prepare(
        `INSERT INTO topology_node_runs
         (node_run_id, topology_run_id, work_order_id, node_id, status, final_state, started_at, finished_at, created_at, updated_at, metrics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("node-run:intake", "topology-run:extract", "work-order:intake", "node:intake", "failed", "failed", now, now + 10, now, now, "{}")
      db.prepare(
        `INSERT INTO topology_work_orders
         (work_order_id, topology_run_id, node_run_id, parent_work_order_id, from_node_id, to_type, to_id, delegation_path_json, work_order_json, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "work-order:intake",
        "topology-run:extract",
        "node-run:intake",
        "node:nobie",
        "node",
        "node:intake",
        JSON.stringify(["node:nobie", "node:intake", "node:triage"]),
        "{}",
        now,
      )
      db.prepare(
        `INSERT INTO topology_tool_calls
         (tool_call_id, topology_run_id, node_run_id, work_order_id, tool_id, dispatcher_tool_name, status,
          reason_code, retry_possible, fallback_possible, started_at, completed_at, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "tool-call:extract",
        "topology-run:extract",
        "node-run:intake",
        "work-order:intake",
        "tool:crm-search",
        "tool:crm-search",
        "succeeded",
        "tool_execution_succeeded",
        0,
        0,
        now + 1,
        now + 2,
        "{}",
      )
      db.prepare(
        `INSERT INTO topology_failure_reports
         (failure_report_id, topology_run_id, node_run_id, work_order_id, node_id, failure_phase, report_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "failure:extract",
        "topology-run:extract",
        "node-run:intake",
        "work-order:intake",
        "node:intake",
        "exhaustion",
        JSON.stringify({
          attempts: [{ kind: "fallback", status: "attempted" }],
        }),
        now + 10,
      )
      db.prepare(
        `INSERT INTO topology_trace_events
         (trace_event_id, topology_run_id, node_run_id, work_order_id, parent_work_order_id, phase, component,
          reason_code, delegation_path_json, payload_json, event_json, at, sequence)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "trace:owner",
        "topology-run:extract",
        "node-run:intake",
        "work-order:intake",
        "work_order",
        "node-runtime",
        "owner_observed",
        JSON.stringify(["node:nobie", "node:intake"]),
        JSON.stringify({ observedOwnerRef: { entityType: "position", id: "position:ops-lead" } }),
        "{}",
        now + 3,
        1,
      )

      const edges = extractObservedTopologyEdges({
        db: coreDb(db),
        topology: topologyFixture(),
        topologyRunId: "topology-run:extract",
      })

      expect(edges.map((edge) => edge.relationType)).toEqual(
        expect.arrayContaining(["delegates_to", "uses_tool", "runtime_failure", "fallback_route", "owns"]),
      )
      expect(edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ edgeKind: "fallback_route", from: { entityType: "node", id: "node:intake" }, to: { entityType: "node", id: "node:triage" } }),
          expect.objectContaining({ edgeKind: "observed_owner", from: { entityType: "position", id: "position:ops-lead" } }),
        ]),
      )
    } finally {
      db.close()
    }
  })

  it("exposes declared/observed analysis API and persists gap findings", async () => {
    useTempState()
    const topology = topologyFixture()
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    const appended = registry.appendTopologyVersion({ topology, createdBy: "task015-test" })
    const activated = registry.activateTopologyVersion(topology.id, appended.version.version)
    expect(activated.ok).toBe(true)

    const app = Fastify({ logger: false })
    registerTopologyAnalysisRoutes(app)
    await app.ready()
    try {
      const analyzed = await app.inject({
        method: "POST",
        url: "/api/topologies/topology:customer-success/analyze",
        payload: { persist: true },
        remoteAddress: "127.0.0.1",
      })
      const gaps = await app.inject({
        method: "GET",
        url: "/api/topologies/topology:customer-success/gaps",
        remoteAddress: "127.0.0.1",
      })

      expect(analyzed.statusCode).toBe(200)
      expect((analyzed.json().analysis as { summary: { findingCount: number } }).summary.findingCount).toBeGreaterThan(0)
      expect(gaps.statusCode).toBe(200)
      expect((gaps.json().findings as unknown[]).length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
})
