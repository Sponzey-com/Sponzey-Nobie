import type { FastifyInstance, FastifyReply } from "fastify"
import { eventBus } from "../../events/index.js"
import {
  ORCHESTRATION_EVENT_KINDS,
  type OrchestrationEvent,
  type OrchestrationEventKind,
  type OrchestrationEventQuery,
  buildOrchestrationMonitoringSnapshot,
  buildRestartResumeProjection,
  formatOrchestrationEventSse,
  listOrchestrationEventLedger,
  openOrchestrationEventRawPayload,
  parseOrchestrationReplayCursor,
} from "../../orchestration/event-ledger.js"
import { authMiddleware } from "../middleware/auth.js"

interface OrchestrationEventQuerystring {
  runId?: string
  requestGroupId?: string
  subSessionId?: string
  agentId?: string
  teamId?: string
  exchangeId?: string
  approvalId?: string
  correlationId?: string
  eventKind?: string
  after?: string
  afterCursor?: string
  limit?: string
  once?: string
  admin?: string
}

function parseLimit(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(parsed, 2_000)
}

function parseEventKind(value: string | undefined): OrchestrationEventKind | undefined {
  return ORCHESTRATION_EVENT_KINDS.includes(value as OrchestrationEventKind)
    ? (value as OrchestrationEventKind)
    : undefined
}

function eventQuery(query: OrchestrationEventQuerystring): OrchestrationEventQuery {
  const eventKind = parseEventKind(query.eventKind)
  const afterCursor = query.afterCursor ?? query.after
  const limit = parseLimit(query.limit)
  return {
    ...(query.runId ? { runId: query.runId } : {}),
    ...(query.requestGroupId ? { requestGroupId: query.requestGroupId } : {}),
    ...(query.subSessionId ? { subSessionId: query.subSessionId } : {}),
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.exchangeId ? { exchangeId: query.exchangeId } : {}),
    ...(query.approvalId ? { approvalId: query.approvalId } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...(eventKind ? { eventKind } : {}),
    ...(afterCursor ? { afterCursor } : {}),
    ...(limit ? { limit } : {}),
  }
}

function writeSseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  })
}

function eventMatches(event: OrchestrationEvent, query: OrchestrationEventQuery): boolean {
  if (query.runId && event.runId !== query.runId) return false
  if (query.requestGroupId && event.requestGroupId !== query.requestGroupId) return false
  if (query.subSessionId && event.subSessionId !== query.subSessionId) return false
  if (query.agentId && event.agentId !== query.agentId) return false
  if (query.teamId && event.teamId !== query.teamId) return false
  if (query.exchangeId && event.exchangeId !== query.exchangeId) return false
  if (query.approvalId && event.approvalId !== query.approvalId) return false
  if (query.correlationId && event.correlationId !== query.correlationId) return false
  if (query.eventKind && event.eventKind !== query.eventKind) return false
  return event.sequence > parseOrchestrationReplayCursor(query.afterCursor)
}

export function registerOrchestrationEventsRoute(app: FastifyInstance): void {
  app.get<{ Querystring: OrchestrationEventQuerystring }>(
    "/api/orchestration/events",
    { preHandler: authMiddleware },
    async (req) => {
      const events = listOrchestrationEventLedger(eventQuery(req.query))
      return {
        ok: true,
        events,
        nextCursor:
          events[events.length - 1]?.cursor ?? req.query.afterCursor ?? req.query.after ?? null,
      }
    },
  )

  app.get<{ Querystring: OrchestrationEventQuerystring }>(
    "/api/orchestration/monitoring",
    { preHandler: authMiddleware },
    async (req) => ({
      ok: true,
      snapshot: buildOrchestrationMonitoringSnapshot(eventQuery(req.query)),
    }),
  )

  app.get<{ Querystring: OrchestrationEventQuerystring }>(
    "/api/orchestration/restart-resume",
    { preHandler: authMiddleware },
    async (req) => ({
      ok: true,
      projection: buildRestartResumeProjection(eventQuery(req.query)),
    }),
  )

  app.get<{ Querystring: OrchestrationEventQuerystring }>(
    "/api/orchestration/events/stream",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const lastEventId = req.headers["last-event-id"]
      const headerCursor = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId
      const queryInput: OrchestrationEventQuerystring = { ...req.query }
      const afterCursor = req.query.afterCursor ?? req.query.after ?? headerCursor
      if (afterCursor) queryInput.afterCursor = afterCursor
      const query = eventQuery(queryInput)
      writeSseHeaders(reply)
      for (const event of listOrchestrationEventLedger(query)) {
        reply.raw.write(formatOrchestrationEventSse(event))
      }
      if (req.query.once === "true" || req.query.once === "1") {
        reply.raw.end()
        return reply
      }
      const unsubscribe = eventBus.on("orchestration.event", (event) => {
        if (eventMatches(event as OrchestrationEvent, query)) {
          reply.raw.write(formatOrchestrationEventSse(event as OrchestrationEvent))
        }
      })
      req.raw.on("close", unsubscribe)
      return reply
    },
  )

  app.get<{
    Params: { eventId: string }
    Querystring: OrchestrationEventQuerystring
  }>(
    "/api/orchestration/events/:eventId/raw",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const result = openOrchestrationEventRawPayload({
        eventId: req.params.eventId,
        admin: req.query.admin === "true" || req.query.admin === "1",
        requester: "api",
      })
      if (!result.ok) {
        const status = result.reasonCode === "admin_required" ? 403 : 404
        return reply.status(status).send({ ok: false, reasonCode: result.reasonCode })
      }
      return { ok: true, event: result.event, rawRef: result.rawRef }
    },
  )
}
