import type { FastifyInstance } from "fastify"
import {
  getSchedules, getSchedule, insertSchedule,
  updateSchedule, deleteSchedule,
  getScheduleRuns, countScheduleRuns, getScheduleStats,
  upsertScheduleMemoryEntry,
} from "../../db/index.js"
import { runSchedule } from "../../scheduler/index.js"
import { getNextRunForTimezone, isValidCron, isValidTimeZone, normalizeScheduleTimezone } from "../../scheduler/cron.js"
import { reconcileScheduleExecution, removeManagedScheduleExecution } from "../../scheduler/system-cron.js"
import { authMiddleware } from "../middleware/auth.js"
import { getConfig } from "../../config/index.js"

function syncScheduleMemoryEntry(input: {
  id: string
  name: string
  cronExpression: string
  timezone?: string | null
  prompt: string
  enabled: boolean
  nextRunAt?: number | null
  metadata?: Record<string, unknown>
}): void {
  upsertScheduleMemoryEntry({
    scheduleId: input.id,
    title: input.name,
    prompt: input.prompt,
    cronExpression: input.cronExpression,
    enabled: input.enabled,
    ...(typeof input.nextRunAt === "number" ? { nextRunAt: input.nextRunAt } : {}),
    metadata: { ...(input.metadata ?? {}), ...(input.timezone ? { timezone: input.timezone } : {}) },
  })
}

function resolveDefaultScheduleTimezone(): string {
  const config = getConfig()
  return normalizeScheduleTimezone(config.scheduler.timezone, config.profile.timezone)
}

function resolveBodyTimezone(input: string | undefined): string {
  const timezone = input?.trim() || resolveDefaultScheduleTimezone()
  if (!isValidTimeZone(timezone)) throw new Error(`invalid timezone: ${timezone}`)
  return normalizeScheduleTimezone(timezone)
}

function resolveNextRunAt(cron: string, baseMs: number, timezone?: string | null): number | null {
  try {
    return getNextRunForTimezone(cron, new Date(baseMs), timezone).getTime()
  } catch {
    return null
  }
}

export function registerSchedulesRoute(app: FastifyInstance): void {
  // GET /api/schedules
  app.get("/api/schedules", { preHandler: authMiddleware }, async () => {
    const rows = getSchedules()
    return {
      schedules: rows.map((s) => ({
        ...s,
        enabled: Boolean(s.enabled),
        next_run_at: (() => {
          try { return getNextRunForTimezone(s.cron_expression, new Date(s.last_run_at ?? s.created_at), s.timezone).getTime() } catch { return null }
        })(),
      })),
    }
  })

  // POST /api/schedules
  app.post<{
    Body: { name: string; cron: string; prompt: string; model?: string; enabled?: boolean; timezone?: string }
  }>("/api/schedules", { preHandler: authMiddleware }, async (req, reply) => {
    const { name, cron, prompt, model, enabled = true } = req.body
    if (!name?.trim()) return reply.status(400).send({ error: "name is required" })
    if (!prompt?.trim()) return reply.status(400).send({ error: "prompt is required" })
    if (!cron?.trim() || !isValidCron(cron)) return reply.status(400).send({ error: "invalid cron expression" })

    let timezone: string
    try {
      timezone = resolveBodyTimezone(req.body.timezone)
    } catch {
      return reply.status(400).send({ error: "invalid timezone" })
    }

    const now = Date.now()
    const id = crypto.randomUUID()
    insertSchedule({
      id, name, cron_expression: cron, timezone, prompt,
      enabled: enabled ? 1 : 0,
      target_channel: "agent",
      target_session_id: null,
      execution_driver: "internal",
      origin_run_id: null,
      origin_request_group_id: null,
      model: model ?? null,
      max_retries: 3,
      timeout_sec: 300,
      created_at: now,
      updated_at: now,
    })
    syncScheduleMemoryEntry({
      id,
      name,
      cronExpression: cron,
      timezone,
      prompt,
      enabled,
      nextRunAt: resolveNextRunAt(cron, now, timezone),
      metadata: { source: "webui" },
    })
    reconcileScheduleExecution(id)
    return reply.status(201).send({ id })
  })

  // GET /api/schedules/:id
  app.get<{ Params: { id: string } }>("/api/schedules/:id", { preHandler: authMiddleware }, async (req, reply) => {
    const s = getSchedule(req.params.id)
    if (!s) return reply.status(404).send({ error: "Not found" })
    return { ...s, enabled: Boolean(s.enabled) }
  })

  // PUT /api/schedules/:id
  app.put<{
    Params: { id: string }
    Body: { name?: string; cron?: string; prompt?: string; model?: string; enabled?: boolean; timezone?: string }
  }>("/api/schedules/:id", { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params
    const s = getSchedule(id)
    if (!s) return reply.status(404).send({ error: "Not found" })
    const { name, cron, prompt, model, enabled } = req.body
    if (cron && !isValidCron(cron)) return reply.status(400).send({ error: "invalid cron expression" })
    let timezone: string | undefined
    if (req.body.timezone !== undefined) {
      try {
        timezone = resolveBodyTimezone(req.body.timezone)
      } catch {
        return reply.status(400).send({ error: "invalid timezone" })
      }
    }
    updateSchedule(id, {
      ...(name !== undefined && { name }),
      ...(cron !== undefined && { cron_expression: cron }),
      ...(timezone !== undefined && { timezone }),
      ...(prompt !== undefined && { prompt }),
      ...(model !== undefined && { model }),
      ...(enabled !== undefined && { enabled: enabled ? 1 : 0 }),
    })
    const updated = getSchedule(id)
    if (updated) {
      syncScheduleMemoryEntry({
        id,
        name: updated.name,
        cronExpression: updated.cron_expression,
        timezone: updated.timezone,
        prompt: updated.prompt,
        enabled: updated.enabled === 1,
        nextRunAt: resolveNextRunAt(updated.cron_expression, updated.last_run_at ?? updated.created_at, updated.timezone),
        metadata: { source: "webui", updatedBy: "api" },
      })
    }
    reconcileScheduleExecution(id)
    return { ok: true }
  })

  // DELETE /api/schedules/:id
  app.delete<{ Params: { id: string } }>("/api/schedules/:id", { preHandler: authMiddleware }, async (req, reply) => {
    const s = getSchedule(req.params.id)
    if (!s) return reply.status(404).send({ error: "Not found" })
    removeManagedScheduleExecution(req.params.id)
    syncScheduleMemoryEntry({
      id: s.id,
      name: s.name,
      cronExpression: s.cron_expression,
      timezone: s.timezone,
      prompt: s.prompt,
      enabled: false,
      nextRunAt: null,
      metadata: { source: "webui", deletedAt: Date.now() },
    })
    deleteSchedule(req.params.id)
    return { ok: true }
  })

  // GET /api/schedules/:id/runs
  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    "/api/schedules/:id/runs",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { id } = req.params
      if (!getSchedule(id)) return reply.status(404).send({ error: "Not found" })
      const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 100)
      const page = Math.max(parseInt(req.query.page ?? "1", 10), 1)
      const offset = (page - 1) * limit
      const total = countScheduleRuns(id)
      const items = getScheduleRuns(id, limit, offset).map((r) => ({
        ...r, success: r.success === null ? null : Boolean(r.success),
      }))
      return { items, total, page, pages: Math.ceil(total / limit), limit }
    },
  )

  // POST /api/schedules/:id/run — immediate trigger
  app.post<{ Params: { id: string } }>("/api/schedules/:id/run", { preHandler: authMiddleware }, async (req, reply) => {
    const s = getSchedule(req.params.id)
    if (!s) return reply.status(404).send({ error: "Not found" })
    const runId = await runSchedule(req.params.id, "manual")
    return { runId, status: "started" }
  })

  // PATCH /api/schedules/:id/toggle — flip enabled
  app.patch<{ Params: { id: string } }>("/api/schedules/:id/toggle", { preHandler: authMiddleware }, async (req, reply) => {
    const s = getSchedule(req.params.id)
    if (!s) return reply.status(404).send({ error: "Not found" })
    const enabled = !s.enabled
    updateSchedule(req.params.id, { enabled: enabled ? 1 : 0 })
    syncScheduleMemoryEntry({
      id: s.id,
      name: s.name,
      cronExpression: s.cron_expression,
      timezone: s.timezone,
      prompt: s.prompt,
      enabled,
      nextRunAt: enabled ? resolveNextRunAt(s.cron_expression, s.last_run_at ?? s.created_at, s.timezone) : null,
      metadata: { source: "webui", toggledAt: Date.now() },
    })
    reconcileScheduleExecution(req.params.id)
    return { ok: true, enabled }
  })

  // GET /api/schedules/:id/stats
  app.get<{ Params: { id: string } }>("/api/schedules/:id/stats", { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params
    if (!getSchedule(id)) return reply.status(404).send({ error: "Not found" })
    return getScheduleStats(id)
  })
}
