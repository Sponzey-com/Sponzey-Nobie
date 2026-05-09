import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { registerTopologyRunRoutes } from "../packages/core/src/api/routes/topology-runs.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { verifyMigrationState } from "../packages/core/src/db/migration-safety.ts"
import { runMigrations } from "../packages/core/src/db/migrations.ts"
import { buildRunRuntimeInspectorProjection } from "../packages/core/src/runs/runtime-inspector-projection.ts"
import type { RootRun } from "../packages/core/src/runs/types.ts"
import {
  buildExampleEnterpriseTopology,
  buildWorkOrder,
  compileTopologyOrThrow,
  createWorkOrderRuntimeEnvelope,
  getTopologyRunTraceProjection,
  listObservedTopologyEdges,
  listTopologyMetricsDaily,
  recordTopologyRuntimeExecution,
  runNodeRuntime,
  type CompiledTopologySnapshot,
  type EnterpriseTopology,
  type NodeContract,
  type NodeResultOutput,
  type ToolContext,
  type ToolResult,
  type WorkOrder,
  type WorkOrderRuntimeEnvelope,
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
    headers?: Record<string, string>
    remoteAddress?: string
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>
}

const now = Date.UTC(2026, 3, 29, 9, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function topologyFixture(): EnterpriseTopology {
  const topology = structuredClone(buildExampleEnterpriseTopology(now))
  topology.status = "active"
  topology.nodes = topology.nodes.map((node) => ({ ...node, status: "active" }))
  return topology
}

function compiledFixture(topology = topologyFixture()): CompiledTopologySnapshot {
  return compileTopologyOrThrow(topology, {
    sourceTopologyVersion: "14",
    compiledAt: now,
  })
}

function nodeById(topology: EnterpriseTopology, nodeId: string): NodeContract {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  if (node === undefined) throw new Error(`expected node ${nodeId}`)
  return node
}

function nodeContractsById(topology: EnterpriseTopology): Record<string, NodeContract> {
  return Object.fromEntries(topology.nodes.map((node) => [node.id, node]))
}

function workOrderFixture(overrides: Partial<WorkOrder> = {}): WorkOrder {
  const order = buildWorkOrder({
    workOrderId: "work-order:intake",
    topologyRunId: "topology-run:task014",
    parentWorkOrderId: null,
    fromNodeId: "node:nobie",
    to: { type: "node", id: "node:intake" },
    objective: "Triage the customer request and assign priority.",
    scope: {
      included: ["customer request", "CRM account context"],
      excluded: ["billing write actions"],
    },
    input: {
      requestId: "request:001",
      customerId: "customer:alpha",
    },
    expectedOutputSchema: {
      kind: "object",
      required: ["summary", "priority"],
    },
    successCriteria: [
      {
        criterionId: "criterion:priority",
        description: "Priority is assigned with a supporting reason.",
        required: true,
        validationKind: "manual",
      },
    ],
    permissionScope: {
      allowedToolIds: ["tool:crm-search"],
      allowedSystemIds: ["system:crm"],
      dataDomainIds: ["data:customer"],
      riskLevel: "medium",
    },
    authorityScope: {
      requiredAuthorityRuleIds: [],
      approvalRequired: false,
    },
    failureReportRequired: true,
    delegationPath: ["node:nobie", "node:intake"],
    createdAt: now,
  })

  return {
    ...order,
    ...overrides,
  }
}

function runtimeEnvelope(input: {
  topology?: EnterpriseTopology
  compiled?: CompiledTopologySnapshot
  workOrder?: WorkOrder
} = {}): {
  topology: EnterpriseTopology
  compiled: CompiledTopologySnapshot
  workOrder: WorkOrder
  envelope: WorkOrderRuntimeEnvelope
} {
  const topology = input.topology ?? topologyFixture()
  const compiled = input.compiled ?? compiledFixture(topology)
  const workOrder = input.workOrder ?? workOrderFixture()
  const result = createWorkOrderRuntimeEnvelope({
    workOrder,
    nodeContractSnapshot: nodeById(topology, workOrder.to.id),
    compiledTopologySnapshot: compiled,
    commandRequestId: "command:task014",
    subSessionId: "sub-session:task014",
    now: () => now,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("expected runtime envelope")
  return { topology, compiled, workOrder, envelope: result.envelope }
}

function migratedDb(): SqliteDatabase {
  const db = new BetterSqlite3(":memory:")
  db.pragma("foreign_keys = ON")
  runMigrations(coreDb(db))
  return db
}

function coreDb(db: SqliteDatabase): Parameters<typeof runMigrations>[0] {
  return db as Parameters<typeof runMigrations>[0]
}

function toolContext(): ToolContext {
  return {
    sessionId: "session:task014",
    runId: "run:task014",
    requestGroupId: "group:task014",
    workDir: process.cwd(),
    userMessage: "run topology trace",
    source: "webui",
    allowWebAccess: false,
    onProgress: () => undefined,
    signal: new AbortController().signal,
  }
}

function dispatcher(result: ToolResult): {
  dispatch(name: string, params: Record<string, unknown>): Promise<ToolResult>
} {
  return {
    async dispatch() {
      return result
    },
  }
}

function failedSelfExecution() {
  return {
    status: "failed_candidate" as const,
    outputs: [] satisfies NodeResultOutput[],
    risksOrGaps: ["missing account context"],
    reasonCode: "self_execution_failed_candidate",
  }
}

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task014-topology-trace-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function rootRunFixture(id: string): RootRun {
  return {
    id,
    sessionId: "session:task014",
    requestGroupId: "group:task014",
    lineageRootRunId: id,
    runScope: "root",
    title: "Task014 trace run",
    prompt: "inspect topology trace",
    source: "webui",
    status: "completed",
    taskProfile: "coding",
    contextMode: "full",
    orchestrationMode: "single_nobie",
    delegationTurnCount: 0,
    maxDelegationTurns: 0,
    currentStepKey: "done",
    currentStepIndex: 0,
    totalSteps: 1,
    summary: "done",
    canCancel: false,
    createdAt: now,
    updatedAt: now,
    steps: [],
    recentEvents: [],
  }
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

describe("task014 topology trace store and observability API", () => {
  it("adds trace, metrics, observed edge, and gap finding tables through migration rehearsal", () => {
    const db = migratedDb()
    try {
      const report = verifyMigrationState(coreDb(db))
      expect(report.ok).toBe(true)
      expect(report.schemaVersion).toBeGreaterThanOrEqual(42)
      expect(report.requiredTables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "topology_runs",
          "topology_node_runs",
          "topology_work_orders",
          "topology_result_reports",
          "topology_failure_reports",
          "topology_trace_events",
          "topology_tool_calls",
          "topology_metrics_daily",
          "observed_topology_edges",
          "topology_gap_findings",
        ]),
      )
    } finally {
      db.close()
    }
  })

  it("records delegation paths, child work order parent linkage, and observed edge seeds", async () => {
    const db = migratedDb()
    try {
      const topology = topologyFixture()
      const compiled = compiledFixture(topology)
      const { envelope } = runtimeEnvelope({ topology, compiled })

      const result = await runNodeRuntime({
        envelope,
        compiledTopologySnapshot: compiled,
        nodeRunId: "node-run:parent",
        now: () => now,
        childDelegation: {
          enabled: true,
          childNodeContractsById: nodeContractsById(topology),
        },
      })

      const persisted = recordTopologyRuntimeExecution({
        db: coreDb(db),
        result,
        topologyVersion: 14,
        rootRunId: "run:task014",
        now: () => now,
      })
      const projection = getTopologyRunTraceProjection(
        persisted.topologyRunId,
        { db: coreDb(db) },
      )

      expect(projection?.run).toMatchObject({
        topologyRunId: "topology-run:task014",
        topologyVersion: 14,
        rootRunId: "run:task014",
      })
      expect(projection?.workOrders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workOrderId: "work-order:intake:child:node:triage",
            parentWorkOrderId: "work-order:intake",
            delegationPath: ["node:nobie", "node:intake", "node:triage"],
          }),
        ]),
      )
      expect(projection?.traceEvents.map((event) => event.delegationPath)).toContainEqual([
        "node:nobie",
        "node:intake",
        "node:triage",
      ])
      expect(listObservedTopologyEdges({
        db: coreDb(db),
        topologyRunId: "topology-run:task014",
      })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fromNodeId: "node:nobie", toNodeId: "node:intake" }),
          expect.objectContaining({ fromNodeId: "node:intake", toNodeId: "node:triage" }),
        ]),
      )
    } finally {
      db.close()
    }
  })

  it("records final failure phase and refreshes daily metrics projection", async () => {
    const db = migratedDb()
    try {
      const { compiled, envelope } = runtimeEnvelope({
        workOrder: workOrderFixture({ topologyRunId: "topology-run:task014-failure" }),
      })
      const result = await runNodeRuntime({
        envelope,
        compiledTopologySnapshot: compiled,
        nodeRunId: "node-run:failure",
        now: () => now,
        selfExecute: failedSelfExecution,
        recovery: {
          enabled: true,
          childDelegationAttempted: true,
          toolExecutionAttempted: true,
          retryAttempted: true,
          fallbackAttempted: true,
          partialSuccessChecked: true,
          parentRecoveryPossibleChecked: true,
          recommendedAction: "Escalate with the failed WorkOrder trace.",
        },
      })

      recordTopologyRuntimeExecution({
        db: coreDb(db),
        result,
        topologyVersion: 14,
        now: () => now,
      })
      const projection = getTopologyRunTraceProjection(
        "topology-run:task014-failure",
        { db: coreDb(db) },
      )
      const metrics = listTopologyMetricsDaily({
        db: coreDb(db),
        topologyId: result.profileSnapshot.topologyId,
      })

      expect(result.status).toBe("failed")
      expect(projection?.failureReports).toEqual([
        expect.objectContaining({
          failureReportId: "failure:work-order:intake",
          failurePhase: "exhaustion",
        }),
      ])
      expect(projection?.traceEvents.map((event) => event.phase)).toContain("exhaustion")
      expect(metrics[0]).toMatchObject({
        metricDate: "2026-04-29",
        topologyVersion: 14,
        topologyRunCount: 1,
        nodeRunCount: 1,
        failedCount: 1,
        failureCount: 1,
      })
    } finally {
      db.close()
    }
  })

  it("records tool call traces and exposes topology run projection through API and Runtime Inspector", async () => {
    useTempState()
    const topology = topologyFixture()
    const compiled = compiledFixture(topology)
    const { envelope } = runtimeEnvelope({
      topology,
      compiled,
      workOrder: workOrderFixture({ topologyRunId: "topology-run:task014-api" }),
    })
    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:tool",
      now: () => now,
      toolExecution: {
        enabled: true,
        dispatcher: dispatcher({ success: true, output: "crm account found" }),
        baseToolContext: toolContext(),
        toolRequests: [{ toolId: "tool:crm-search" }],
      },
    })

    recordTopologyRuntimeExecution({
      result,
      topologyVersion: 14,
      rootRunId: "run:task014-api",
      now: () => now,
    })

    const app = Fastify({ logger: false })
    registerTopologyRunRoutes(app)
    await app.ready()
    try {
      const detail = await app.inject({
        method: "GET",
        url: "/api/topology-runs/topology-run:task014-api",
        remoteAddress: "127.0.0.1",
      })
      const trace = await app.inject({
        method: "GET",
        url: "/api/topology-runs/topology-run:task014-api/trace",
        remoteAddress: "127.0.0.1",
      })
      const toolCalls = await app.inject({
        method: "GET",
        url: "/api/topology-runs/topology-run:task014-api/tool-calls",
        remoteAddress: "127.0.0.1",
      })
      const inspector = buildRunRuntimeInspectorProjection(rootRunFixture("run:task014-api"), {
        now,
      })

      expect(detail.statusCode).toBe(200)
      expect(trace.statusCode).toBe(200)
      expect(toolCalls.statusCode).toBe(200)
      expect((detail.json().topologyRun as { toolCalls: unknown[] }).toolCalls).toHaveLength(1)
      expect((toolCalls.json().toolCalls as Array<{ toolId: string; status: string }>)[0]).toMatchObject({
        toolId: "tool:crm-search",
        status: "succeeded",
      })
      expect((trace.json().traceEvents as Array<{ phase: string }>).map((event) => event.phase)).toContain("tool_execution")
      expect(inspector.topologyRuns).toEqual([
        expect.objectContaining({
          topologyRunId: "topology-run:task014-api",
          toolCallCount: 1,
          traceEventCount: result.traceEvents.length,
        }),
      ])
    } finally {
      await app.close()
    }
  })
})
