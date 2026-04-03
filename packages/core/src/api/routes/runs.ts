import crypto from "node:crypto"
import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import {
  cancelRootRun,
  getRootRun,
  listRootRuns,
  listRunsForRecentRequestGroups,
} from "../../runs/store.js"
import { startIngressRun } from "../../runs/ingress.js"
import { buildTaskModels } from "../../runs/task-model.js"
import { createWebUiChunkDeliveryHandler } from "../ws/chunk-delivery.js"

export async function startLocalRun(params: {
  message: string
  sessionId: string | undefined
  model: string | undefined
  source: "webui" | "cli" | "telegram"
}) {
  const runId = crypto.randomUUID()
  const sessionId = params.sessionId ?? crypto.randomUUID()
  const { started, receipt, requestId, source } = startIngressRun({
    ...params,
    runId,
    sessionId,
    ...(params.source === "webui"
      ? { onChunk: createWebUiChunkDeliveryHandler({ sessionId, runId }) }
      : {}),
  })
  return {
    requestId,
    runId: started.runId,
    sessionId,
    source,
    status: started.status,
    receipt: receipt.text,
  }
}

export function registerRunsRoute(app: FastifyInstance): void {
  app.get("/api/runs", { preHandler: authMiddleware }, async () => {
    return { runs: listRootRuns() }
  })

  app.get("/api/tasks", { preHandler: authMiddleware }, async () => {
    return { tasks: buildTaskModels(listRunsForRecentRequestGroups()) }
  })

  app.get<{ Params: { id: string } }>("/api/runs/:id", { preHandler: authMiddleware }, async (req, reply) => {
    const run = getRootRun(req.params.id)
    if (!run) return reply.status(404).send({ error: "Run not found" })
    return { run }
  })

  app.get<{ Params: { id: string } }>("/api/runs/:id/steps", { preHandler: authMiddleware }, async (req, reply) => {
    const run = getRootRun(req.params.id)
    if (!run) return reply.status(404).send({ error: "Run not found" })
    return { steps: run.steps }
  })

  app.get<{ Params: { id: string } }>("/api/runs/:id/timeline", { preHandler: authMiddleware }, async (req, reply) => {
    const run = getRootRun(req.params.id)
    if (!run) return reply.status(404).send({ error: "Run not found" })
    return { events: run.recentEvents }
  })

  app.post<{
    Body: { message: string; sessionId?: string; model?: string }
  }>("/api/runs", { preHandler: authMiddleware }, async (req, reply) => {
    const message = req.body?.message?.trim()
    if (!message) return reply.status(400).send({ error: "message is required" })
    return startLocalRun({
      message,
      sessionId: req.body.sessionId,
      model: req.body.model,
      source: "webui",
    })
  })

  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", { preHandler: authMiddleware }, async (req, reply) => {
    const run = cancelRootRun(req.params.id)
    if (!run) return reply.status(404).send({ error: "Run not found or not cancellable" })
    return { run }
  })
}
