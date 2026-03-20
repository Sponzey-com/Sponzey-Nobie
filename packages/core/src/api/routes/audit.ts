import type { FastifyInstance } from "fastify"
import { getDb } from "../../db/index.js"
import { authMiddleware } from "../middleware/auth.js"

const SENSITIVE_KEYS = /api[_-]?key|token|password|secret|credential/i

function maskParams(raw: string | null): string {
  if (!raw) return "{}"
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (SENSITIVE_KEYS.test(key)) obj[key] = "***"
    }
    return JSON.stringify(obj)
  } catch {
    return raw
  }
}

export function registerAuditRoute(app: FastifyInstance): void {
  app.get<{
    Querystring: {
      page?: string
      limit?: string
      toolName?: string
      result?: string
      from?: string
      to?: string
      sessionId?: string
    }
  }>("/api/audit", { preHandler: authMiddleware }, async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200)
    const page = Math.max(parseInt(req.query.page ?? "1", 10), 1)
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const bindings: unknown[] = []

    if (req.query.toolName) {
      conditions.push("tool_name LIKE ?")
      bindings.push(`%${req.query.toolName}%`)
    }
    if (req.query.result) {
      conditions.push("result = ?")
      bindings.push(req.query.result)
    }
    if (req.query.sessionId) {
      conditions.push("session_id = ?")
      bindings.push(req.query.sessionId)
    }
    if (req.query.from) {
      conditions.push("timestamp >= ?")
      bindings.push(new Date(req.query.from).getTime())
    }
    if (req.query.to) {
      conditions.push("timestamp <= ?")
      bindings.push(new Date(req.query.to).getTime())
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    const total = (
      getDb().prepare(`SELECT COUNT(*) as n FROM audit_logs ${where}`).get(...bindings) as { n: number }
    ).n

    const rows = getDb()
      .prepare(
        `SELECT timestamp, session_id, tool_name, params, output, result, duration_ms, approval_required, approved_by
         FROM audit_logs ${where}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...bindings, limit, offset) as Array<{
        timestamp: number
        session_id: string
        tool_name: string
        params: string | null
        output: string | null
        result: string
        duration_ms: number
        approval_required: number
        approved_by: string | null
      }>

    const items = rows.map((r) => ({ ...r, params: maskParams(r.params) }))

    return { items, total, page, pages: Math.ceil(total / limit), limit }
  })
}
