import type { FastifyInstance } from "fastify"
import {
  getSchedules, getSchedule, insertSchedule,
  updateSchedule, deleteSchedule,
  getScheduleRuns, countScheduleRuns, getScheduleStats,
} from "../../db/index.js"
import { runSchedule } from "../../scheduler/index.js"
import { isValidCron, getNextRun } from "../../scheduler/cron.js"
import { authMiddleware } from "../middleware/auth.js"

export function registerSchedulesRoute(app: FastifyInstance): void {
  // GET /api/schedules
  app.get("/api/schedules", { preHandler: authMiddleware }, async () => {
    const rows = getSchedules()
    return {
      schedules: rows.map((s) => ({
        ...s,
        enabled: Boolean(s.enabled),
        next_run_at: (() => {
          try { return getNextRun(s.cron_expression, new Date(s.last_run_at ?? s.created_at)).getTime() } catch { return null }
        })(),
      })),
    }
  })

  // POST /api/schedules
  app.post<{
    Body: { name: string; cron: string; prompt: string; model?: string; enabled?: boolean }
  }>("/api/schedules", { preHandler: authMiddleware }, async (req, reply) => {
    const { name, cron, prompt, model, enabled = true } = req.body
    if (!name?.trim()) return reply.status(400).send({ error: "name is required" })
    if (!prompt?.trim()) return reply.status(400).send({ error: "prompt is required" })
    if (!cron?.trim() || !isValidCron(cron)) return reply.status(400).send({ error: "invalid cron expression" })

    const now = Date.now()
    const id = crypto.randomUUID()
    insertSchedule({
      id, name, cron_expression: cron, prompt,
      enabled: enabled ? 1 : 0,
      target_channel: "agent",
      model: model ?? null,
      max_retries: 3,
      timeout_sec: 300,
      created_at: now,
      updated_at: now,
    })
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
    Body: { name?: string; cron?: string; prompt?: string; model?: string; enabled?: boolean }
  }>("/api/schedules/:id", { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params
    const s = getSchedule(id)
    if (!s) return reply.status(404).send({ error: "Not found" })
    const { name, cron, prompt, model, enabled } = req.body
    if (cron && !isValidCron(cron)) return reply.status(400).send({ error: "invalid cron expression" })
    updateSchedule(id, {
      ...(name !== undefined && { name }),
      ...(cron !== undefined && { cron_expression: cron }),
      ...(prompt !== undefined && { prompt }),
      ...(model !== undefined && { model }),
      ...(enabled !== undefined && { enabled: enabled ? 1 : 0 }),
    })
    return { ok: true }
  })

  // DELETE /api/schedules/:id
  app.delete<{ Params: { id: string } }>("/api/schedules/:id", { preHandler: authMiddleware }, async (req, reply) => {
    const s = getSchedule(req.params.id)
    if (!s) return reply.status(404).send({ error: "Not found" })
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
    updateSchedule(req.params.id, { enabled: s.enabled ? 0 : 1 })
    return { ok: true, enabled: !s.enabled }
  })

  // GET /api/schedules/:id/stats
  app.get<{ Params: { id: string } }>("/api/schedules/:id/stats", { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params
    if (!getSchedule(id)) return reply.status(404).send({ error: "Not found" })
    return getScheduleStats(id)
  })
}
