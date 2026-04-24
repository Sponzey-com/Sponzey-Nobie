import crypto from "node:crypto"
import type { FastifyInstance } from "fastify"
import {
  type ControlExportAudience,
  type ControlExportFormat,
  exportRetrievalEvidenceTimeline,
  getRetrievalEvidenceTimeline,
} from "../../control-plane/timeline.js"
import { listMemoryAccessTraceForRun, listTaskContinuityForLineages } from "../../db/index.js"
import { buildActiveRunProjections } from "../../runs/active-run-projection.js"
import { startIngressRun } from "../../runs/ingress.js"
import { recordMessageLedgerEvent } from "../../runs/message-ledger.js"
import { DEFAULT_STALE_RUN_MS, buildOperationsSummary } from "../../runs/operations.js"
import { createInboundMessageRecord } from "../../runs/request-isolation.js"
import { buildRunRuntimeInspectorProjection } from "../../runs/runtime-inspector-projection.js"
import {
  resolveFocusBinding,
  type FocusResolveSuccess,
} from "../../orchestration/command-workspace.js"
import {
  cancelRootRun,
  cleanupStaleRunStates,
  clearHistoricalRunHistory,
  deleteRunHistory,
  getRootRun,
  listActiveRootRuns,
  listRootRuns,
  listRunsForRecentRequestGroups,
} from "../../runs/store.js"
import { buildTaskModels } from "../../runs/task-model.js"
import { authMiddleware } from "../middleware/auth.js"
import { createWebUiChunkDeliveryHandler } from "../ws/chunk-delivery.js"

function parseTimelineLimit(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(parsed, 2_000)
}

function parseTimelineAudience(value: string | undefined): ControlExportAudience {
  return value === "developer" ? "developer" : "user"
}

function parseTimelineFormat(value: string | undefined): ControlExportFormat {
  return value === "json" ? "json" : "markdown"
}

export async function startLocalRun(params: {
  message: string
  sessionId: string | undefined
  model: string | undefined
  source: "webui" | "cli" | "telegram" | "slack"
  focusResolution?: FocusResolveSuccess | undefined
}) {
  const runId = crypto.randomUUID()
  const sessionId = params.sessionId ?? crypto.randomUUID()
  const { started, receipt, requestId, source } = startIngressRun({
    ...params,
    runId,
    sessionId,
    inboundMessage: createInboundMessageRecord({
      source: params.source,
      sessionId,
      channelEventId: runId,
      externalChatId: sessionId,
      externalThreadId: sessionId,
      externalMessageId: runId,
      rawText: params.message,
    }),
    ...(params.focusResolution
      ? { orchestrationPlannerIntent: params.focusResolution.plannerIntent }
      : {}),
    ...(params.source === "webui"
      ? { onChunk: createWebUiChunkDeliveryHandler({ sessionId, runId }) }
      : {}),
  })
  if (receipt.text.trim()) {
    const startedRun = getRootRun(started.runId)
    recordMessageLedgerEvent({
      runId: started.runId,
      requestGroupId: startedRun?.requestGroupId ?? started.runId,
      sessionKey: sessionId,
      threadKey: sessionId,
      channel: params.source,
      eventKind: "fast_receipt_sent",
      deliveryKey: `${params.source}:receipt:${sessionId}:${started.runId}`,
      idempotencyKey: `${params.source}:receipt:${started.runId}`,
      status: "sent",
      summary: `${params.source} 접수 메시지를 전송했습니다.`,
      detail: { receiptLength: receipt.text.length },
    })
  }
  return {
    requestId,
    runId: started.runId,
    sessionId,
    source,
    status: started.status,
    receipt: receipt.text,
    ...(params.focusResolution
      ? {
          focus: {
            binding: params.focusResolution.binding,
            plannerTarget: params.focusResolution.plannerTarget,
            enforcement: params.focusResolution.enforcement,
          },
        }
      : {}),
  }
}

export function registerRunsRoute(app: FastifyInstance): void {
  function listTaskSnapshot() {
    const runs = listRunsForRecentRequestGroups()
    const continuity = listTaskContinuityForLineages(
      runs.map((run) => run.lineageRootRunId || run.requestGroupId || run.id),
    )
    const tasks = buildTaskModels(runs, continuity)
    return { runs, tasks }
  }

  app.get("/api/runs", { preHandler: authMiddleware }, async () => {
    const runs = listRootRuns()
    return {
      runs,
      activeRunProjections: buildActiveRunProjections(
        runs.filter(
          (run) =>
            run.status === "queued" ||
            run.status === "running" ||
            run.status === "awaiting_approval" ||
            run.status === "awaiting_user",
        ),
      ),
    }
  })

  app.get("/api/runs/active", { preHandler: authMiddleware }, async () => {
    const runs = listActiveRootRuns()
    return { runs, activeRunProjections: buildActiveRunProjections(runs) }
  })

  app.get("/api/tasks", { preHandler: authMiddleware }, async () => {
    return { tasks: listTaskSnapshot().tasks }
  })

  app.get<{ Querystring: { staleMs?: string } }>(
    "/api/runs/operations/summary",
    { preHandler: authMiddleware },
    async (req) => {
      const staleMs = Number.parseInt(req.query.staleMs ?? "", 10)
      const snapshot = listTaskSnapshot()
      return {
        summary: buildOperationsSummary({
          ...snapshot,
          staleThresholdMs:
            Number.isFinite(staleMs) && staleMs > 0 ? staleMs : DEFAULT_STALE_RUN_MS,
        }),
      }
    },
  )

  app.post<{ Body: { staleMs?: number } }>(
    "/api/runs/operations/stale-cleanup",
    { preHandler: authMiddleware },
    async (req) => {
      const staleMs =
        typeof req.body?.staleMs === "number" && Number.isFinite(req.body.staleMs)
          ? req.body.staleMs
          : undefined
      const cleanup = cleanupStaleRunStates({ ...(staleMs ? { staleMs } : {}) })
      const snapshot = listTaskSnapshot()
      return {
        ok: true,
        cleanup,
        summary: buildOperationsSummary({
          ...snapshot,
          staleThresholdMs: cleanup.thresholdMs,
        }),
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = getRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found" })
      return { run }
    },
  )

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/steps",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = getRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found" })
      return { steps: run.steps }
    },
  )

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/timeline",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = getRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found" })
      return { events: run.recentEvents }
    },
  )

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/runtime-inspector",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = getRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found" })
      return { projection: buildRunRuntimeInspectorProjection(run) }
    },
  )

  app.get<{ Params: { id: string }; Querystring: { audience?: string; limit?: string } }>(
    "/api/runs/:id/retrieval-timeline",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = getRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found" })
      const limit = parseTimelineLimit(req.query.limit)
      return {
        timeline: getRetrievalEvidenceTimeline(
          {
            requestGroupId: run.requestGroupId || run.id,
            ...(limit !== undefined ? { limit } : {}),
          },
          parseTimelineAudience(req.query.audience),
        ),
      }
    },
  )

  app.get<{
    Params: { id: string }
    Querystring: { audience?: string; format?: string; limit?: string }
  }>(
    "/api/runs/:id/retrieval-timeline/export",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = getRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found" })
      const limit = parseTimelineLimit(req.query.limit)
      return {
        export: exportRetrievalEvidenceTimeline({
          requestGroupId: run.requestGroupId || run.id,
          audience: parseTimelineAudience(req.query.audience),
          format: parseTimelineFormat(req.query.format),
          ...(limit !== undefined ? { limit } : {}),
        }),
      }
    },
  )

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/runs/:id/memory-trace",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = getRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found" })
      const parsedLimit = Number.parseInt(req.query.limit ?? "", 10)
      return {
        traces: listMemoryAccessTraceForRun(
          req.params.id,
          Number.isFinite(parsedLimit) ? parsedLimit : 100,
        ),
      }
    },
  )

  app.post<{
    Body: { message: string; sessionId?: string; model?: string; focusThreadId?: string; parentAgentId?: string }
  }>("/api/runs", { preHandler: authMiddleware }, async (req, reply) => {
    const message = req.body?.message?.trim()
    if (!message) return reply.status(400).send({ error: "message is required" })
    const focusThreadId = req.body.focusThreadId?.trim()
    const parentAgentId = req.body.parentAgentId?.trim()
    const focusResolution = focusThreadId
      ? resolveFocusBinding({
          threadId: focusThreadId,
          ...(parentAgentId ? { parentAgentId } : {}),
        })
      : undefined
    if (focusResolution && !focusResolution.ok) {
      return reply.status(focusResolution.statusCode).send({
        ok: false,
        error: focusResolution.reasonCode,
        reasonCode: focusResolution.reasonCode,
        ...(focusResolution.binding ? { binding: focusResolution.binding } : {}),
        ...(focusResolution.details ? { details: focusResolution.details } : {}),
      })
    }
    return startLocalRun({
      message,
      sessionId: req.body.sessionId,
      model: req.body.model,
      source: "webui",
      ...(focusResolution ? { focusResolution } : {}),
    })
  })

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/cancel",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const run = cancelRootRun(req.params.id)
      if (!run) return reply.status(404).send({ error: "Run not found or not cancellable" })
      return { run }
    },
  )

  app.delete("/api/runs/history/inactive", { preHandler: authMiddleware }, async () => {
    const result = clearHistoricalRunHistory()
    return { ok: true, deletedRunCount: result.deletedRunCount }
  })

  app.delete<{ Params: { id: string } }>(
    "/api/runs/:id",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const result = deleteRunHistory(req.params.id)
      if (!result) return reply.status(404).send({ error: "Run not found" })
      if (result.blockedRunCount && result.blockedRunCount > 0) {
        return reply.status(409).send({
          error: "Active run history cannot be deleted",
          blockedRunCount: result.blockedRunCount,
        })
      }
      return { ok: true, deletedRunCount: result.deletedRunCount }
    },
  )
}
