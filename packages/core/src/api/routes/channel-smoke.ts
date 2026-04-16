import type { FastifyInstance } from "fastify"
import { getConfig } from "../../config/index.js"
import {
  getChannelSmokeRun,
  listChannelSmokeRuns,
  listChannelSmokeSteps,
  type DbChannelSmokeRun,
  type DbChannelSmokeStep,
} from "../../db/index.js"
import {
  createDryRunChannelSmokeExecutor,
  getDefaultChannelSmokeScenarios,
  runPersistedChannelSmokeScenarios,
  type ChannelSmokeChannel,
  type ChannelSmokeRunMode,
  type ChannelSmokeScenario,
} from "../../channels/smoke-runner.js"
import { authMiddleware } from "../middleware/auth.js"

interface ChannelSmokeRunQuery {
  limit?: string
}

interface ChannelSmokeRunBody {
  mode?: ChannelSmokeRunMode
  channel?: ChannelSmokeChannel
  scenarioIds?: string[]
}

function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 20
  return Math.min(parsed, 100)
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function toRunResponse(row: DbChannelSmokeRun): Record<string, unknown> {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    counts: {
      total: row.scenario_count,
      passed: row.passed_count,
      failed: row.failed_count,
      skipped: row.skipped_count,
    },
    initiatedBy: row.initiated_by,
    summary: row.summary,
    metadata: safeParseJson(row.metadata_json),
  }
}

function toStepResponse(row: DbChannelSmokeStep): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.run_id,
    scenarioId: row.scenario_id,
    channel: row.channel,
    scenarioKind: row.scenario_kind,
    status: row.status,
    reason: row.reason,
    failures: safeParseJson(row.failures_json) ?? [],
    trace: safeParseJson(row.trace_json),
    auditLogId: row.audit_log_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

function resolveScenarios(body: ChannelSmokeRunBody): ChannelSmokeScenario[] {
  const scenarios = getDefaultChannelSmokeScenarios()
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
  if (Array.isArray(body.scenarioIds) && body.scenarioIds.length > 0) {
    const resolved = body.scenarioIds.map((id) => byId.get(id)).filter((item): item is ChannelSmokeScenario => Boolean(item))
    if (resolved.length !== body.scenarioIds.length) {
      const unknown = body.scenarioIds.filter((id) => !byId.has(id))
      throw new Error(`unknown smoke scenario: ${unknown.join(", ")}`)
    }
    return resolved
  }
  return body.channel ? scenarios.filter((scenario) => scenario.channel === body.channel) : scenarios
}

export function registerChannelSmokeRoute(app: FastifyInstance): void {
  app.get<{ Querystring: ChannelSmokeRunQuery }>("/api/channel-smoke/runs", { preHandler: authMiddleware }, async (req) => {
    return { runs: listChannelSmokeRuns(parseLimit(req.query.limit)).map(toRunResponse) }
  })

  app.get<{ Params: { id: string } }>("/api/channel-smoke/runs/:id", { preHandler: authMiddleware }, async (req, reply) => {
    const run = getChannelSmokeRun(req.params.id)
    if (!run) return reply.status(404).send({ error: "Channel smoke run not found" })
    return {
      run: toRunResponse(run),
      steps: listChannelSmokeSteps(req.params.id).map(toStepResponse),
    }
  })

  app.post<{ Body: ChannelSmokeRunBody }>("/api/channel-smoke/runs", { preHandler: authMiddleware }, async (req, reply) => {
    const mode = req.body?.mode ?? "dry-run"
    if (mode !== "dry-run" && mode !== "live-run") return reply.status(400).send({ error: "invalid smoke mode" })
    if (mode === "live-run" && process.env["NOBIE_CHANNEL_SMOKE_LIVE"] !== "1") {
      return reply.status(400).send({ error: "live channel smoke requires NOBIE_CHANNEL_SMOKE_LIVE=1" })
    }
    if (mode === "live-run") {
      return reply.status(501).send({ error: "live channel smoke executor is not configured in this build" })
    }

    let scenarios: ChannelSmokeScenario[]
    try {
      scenarios = resolveScenarios(req.body ?? {})
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) })
    }

    const result = await runPersistedChannelSmokeScenarios({
      config: getConfig(),
      mode,
      scenarios,
      initiatedBy: "webui",
      metadata: { route: "/api/channel-smoke/runs" },
      executeScenario: createDryRunChannelSmokeExecutor(),
    })
    return {
      ok: result.status !== "failed",
      runId: result.runId,
      status: result.status,
      counts: result.counts,
      summary: result.summary,
      results: result.results.map((item) => ({
        scenarioId: item.scenario.id,
        channel: item.scenario.channel,
        kind: item.scenario.kind,
        status: item.status,
        reason: item.reason,
        failures: item.failures,
        auditLogId: item.auditLogId,
      })),
    }
  })
}
