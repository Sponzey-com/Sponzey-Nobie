import type { FastifyInstance } from "fastify"
import {
  exportControlTimeline,
  getControlTimeline,
  type ControlEventSeverity,
  type ControlExportAudience,
  type ControlExportFormat,
  type ControlTimelineQuery,
} from "../../control-plane/timeline.js"
import { authMiddleware } from "../middleware/auth.js"

interface ControlTimelineQuerystring {
  runId?: string
  requestGroupId?: string
  correlationId?: string
  eventType?: string
  component?: string
  severity?: string
  limit?: string
  audience?: string
  format?: string
}

function parseLimit(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.min(parsed, 2_000)
}

function parseSeverity(value: string | undefined): ControlEventSeverity | undefined {
  return value === "debug" || value === "info" || value === "warning" || value === "error" ? value : undefined
}

function parseAudience(value: string | undefined): ControlExportAudience {
  return value === "developer" ? "developer" : "user"
}

function parseFormat(value: string | undefined): ControlExportFormat {
  return value === "json" ? "json" : "markdown"
}

function toTimelineQuery(query: ControlTimelineQuerystring): ControlTimelineQuery {
  const severity = parseSeverity(query.severity)
  const limit = parseLimit(query.limit)
  return {
    ...(query.runId ? { runId: query.runId } : {}),
    ...(query.requestGroupId ? { requestGroupId: query.requestGroupId } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...(query.eventType ? { eventType: query.eventType } : {}),
    ...(query.component ? { component: query.component } : {}),
    ...(severity ? { severity } : {}),
    ...(limit ? { limit } : {}),
  }
}

export function registerControlTimelineRoute(app: FastifyInstance): void {
  app.get<{ Querystring: ControlTimelineQuerystring }>("/api/control/timeline", { preHandler: authMiddleware }, async (req) => ({
    timeline: getControlTimeline(toTimelineQuery(req.query), parseAudience(req.query.audience)),
  }))

  app.get<{ Querystring: ControlTimelineQuerystring }>("/api/control/timeline/export", { preHandler: authMiddleware }, async (req) => ({
    export: exportControlTimeline({
      ...toTimelineQuery(req.query),
      audience: parseAudience(req.query.audience),
      format: parseFormat(req.query.format),
    }),
  }))
}
