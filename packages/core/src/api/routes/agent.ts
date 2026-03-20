import type { FastifyInstance } from "fastify"
import { getDb } from "../../db/index.js"
import { authMiddleware } from "../middleware/auth.js"
import { startLocalRun } from "./runs.js"

export function registerAgentRoutes(app: FastifyInstance): void {
  // POST /api/agent/run — start agent run (streams via WebSocket)
  app.post<{
    Body: { message: string; sessionId?: string; model?: string }
  }>("/api/agent/run", { preHandler: authMiddleware }, async (req, reply) => {
    const { message, sessionId, model } = req.body
    if (!message?.trim()) {
      return reply.status(400).send({ error: "message is required" })
    }
    return startLocalRun({
      message,
      sessionId,
      model,
      source: "webui",
    })
  })

  // GET /api/agent/sessions
  app.get("/api/agent/sessions", { preHandler: authMiddleware }, async () => {
    const rows = getDb()
      .prepare("SELECT id, source, created_at, updated_at, summary FROM sessions ORDER BY updated_at DESC LIMIT 50")
      .all()
    return { sessions: rows }
  })

  // GET /api/agent/sessions/:id/messages
  app.get<{ Params: { id: string } }>(
    "/api/agent/sessions/:id/messages",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { id } = req.params
      const session = getDb().prepare("SELECT id FROM sessions WHERE id = ?").get(id)
      if (!session) return reply.status(404).send({ error: "Session not found" })

      const messages = getDb()
        .prepare("SELECT role, content, created_at FROM messages WHERE session_id = ? AND tool_calls IS NULL ORDER BY created_at ASC")
        .all(id)
      return { sessionId: id, messages }
    },
  )
}
