import type { FastifyInstance, FastifyReply } from "fastify"
import {
  type SubSessionControlAction,
  controlSubSession,
  getSubSessionInfo,
  killAllSubSessionsForRun,
  listSubSessionLogs,
  spawnSubSessionAck,
} from "../../orchestration/sub-session-control.js"
import { authMiddleware } from "../middleware/auth.js"

function sendControlFailure(
  reply: FastifyReply,
  result: { statusCode?: number; reasonCode: string },
): FastifyReply {
  return reply.status(result.statusCode ?? 400).send({
    ok: false,
    error: result.reasonCode,
    reasonCode: result.reasonCode,
  })
}

function parentRunIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const raw = (value as Record<string, unknown>).parentRunId
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
}

function registerControlAction(app: FastifyInstance, action: SubSessionControlAction): void {
  app.post<{
    Params: { subSessionId: string }
    Body: unknown
  }>(
    `/api/subsessions/:subSessionId/${action}`,
    { preHandler: authMiddleware },
    async (req, reply) => {
      const parentRunId = parentRunIdFrom(req.body)
      const result = controlSubSession({
        subSessionId: req.params.subSessionId,
        action,
        body: req.body,
        ...(parentRunId ? { parentRunId } : {}),
      })
      if (!result.ok && "statusCode" in result) return sendControlFailure(reply, result)
      const statusCode = result.ok ? 202 : 409
      return reply.status(statusCode).send(result)
    },
  )
}

export function registerSubSessionRoutes(app: FastifyInstance): void {
  app.post<{ Body: unknown }>(
    "/api/subsessions/spawn",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const ack = spawnSubSessionAck(req.body)
      const statusCode =
        ack.status === "rejected" ? 400 : ack.status === "blocked_by_approval" ? 202 : 202
      return reply.status(statusCode).send({ ack })
    },
  )

  app.get<{
    Params: { subSessionId: string }
    Querystring: { parentRunId?: string }
  }>("/api/subsessions/:subSessionId/info", { preHandler: authMiddleware }, async (req, reply) => {
    const result = getSubSessionInfo(req.params.subSessionId, req.query.parentRunId)
    if (!result.ok) return sendControlFailure(reply, result)
    return { info: result.info }
  })

  app.get<{
    Params: { subSessionId: string }
    Querystring: { parentRunId?: string; limit?: string }
  }>("/api/subsessions/:subSessionId/logs", { preHandler: authMiddleware }, async (req, reply) => {
    const result = listSubSessionLogs({
      subSessionId: req.params.subSessionId,
      ...(req.query.parentRunId ? { parentRunId: req.query.parentRunId } : {}),
      ...(req.query.limit ? { limit: req.query.limit } : {}),
    })
    if (!result.ok) return sendControlFailure(reply, result)
    return { logs: result.logs }
  })

  registerControlAction(app, "send")
  registerControlAction(app, "steer")
  registerControlAction(app, "retry")
  registerControlAction(app, "feedback")
  registerControlAction(app, "redelegate")
  registerControlAction(app, "cancel")
  registerControlAction(app, "kill")

  app.post<{
    Params: { runId: string }
    Body: unknown
  }>(
    "/api/runs/:runId/subsessions/kill-all",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const result = killAllSubSessionsForRun({
        parentRunId: req.params.runId,
        body: req.body,
      })
      return reply.status(202).send(result)
    },
  )
}
