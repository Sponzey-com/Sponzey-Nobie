import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import {
  listMemoryWritebackReviewItems,
  reviewMemoryWritebackCandidate,
  type MemoryWritebackReviewAction,
} from "../../memory/writeback.js"
import { buildMemoryQualitySnapshot } from "../../memory/quality.js"
import {
  buildMemoryInspectorSnapshot,
  runMemoryInspectorControl,
  type MemoryInspectorControlAction,
} from "../../memory/inspector.js"
import type { MemoryWritebackStatus } from "../../db/index.js"

const ALLOWED_STATUSES = new Set<MemoryWritebackStatus | "all">(["pending", "writing", "failed", "completed", "discarded", "all"])
const ALLOWED_ACTIONS = new Set<MemoryWritebackReviewAction>(["approve_long_term", "approve_edited", "keep_session", "discard"])
const ALLOWED_OWNER_TYPES = new Set(["main_agent", "sub_agent"])
const ALLOWED_INSPECTOR_ACTIONS = new Set<MemoryInspectorControlAction>([
  "dry_run_compaction",
  "latest_capsule_inspect",
  "rollup_inspect",
  "safe_restore",
  "force_compaction",
  "capsule_invalidate",
])

function normalizeStatus(value: unknown): MemoryWritebackStatus | "all" {
  return typeof value === "string" && ALLOWED_STATUSES.has(value as MemoryWritebackStatus | "all")
    ? value as MemoryWritebackStatus | "all"
    : "pending"
}

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : 100
}

function normalizeOwnerType(value: unknown): "main_agent" | "sub_agent" | undefined {
  return typeof value === "string" && ALLOWED_OWNER_TYPES.has(value)
    ? value as "main_agent" | "sub_agent"
    : undefined
}

export function registerMemoryRoute(app: FastifyInstance): void {
  app.get("/api/memory/quality", { preHandler: authMiddleware }, async () => {
    return { snapshot: buildMemoryQualitySnapshot() }
  })

  app.get<{
    Querystring: {
      ownerType?: string
      ownerId?: string
      sessionId?: string
      requestGroupId?: string
      limit?: string
    }
  }>("/api/memory/inspector", { preHandler: authMiddleware }, async (req) => {
    const ownerType = normalizeOwnerType(req.query.ownerType)
    return {
      snapshot: buildMemoryInspectorSnapshot({
        ...(ownerType ? { ownerType } : {}),
        ...(typeof req.query.ownerId === "string" && req.query.ownerId.trim()
          ? { ownerId: req.query.ownerId.trim() }
          : {}),
        ...(typeof req.query.sessionId === "string" && req.query.sessionId.trim()
          ? { sessionId: req.query.sessionId.trim() }
          : {}),
        ...(typeof req.query.requestGroupId === "string" && req.query.requestGroupId.trim()
          ? { requestGroupId: req.query.requestGroupId.trim() }
          : {}),
        limit: normalizeLimit(req.query.limit),
      }),
    }
  })

  app.post<{
    Body: {
      action?: string
      ownerType?: string
      ownerId?: string
      sessionId?: string
      requestGroupId?: string
      limit?: number
    }
  }>("/api/memory/inspector/control", { preHandler: authMiddleware }, async (req, reply) => {
    const action = req.body?.action
    if (typeof action !== "string" || !ALLOWED_INSPECTOR_ACTIONS.has(action as MemoryInspectorControlAction)) {
      return reply.status(400).send({ error: "invalid memory inspector action" })
    }
    const ownerType = normalizeOwnerType(req.body?.ownerType)
    return {
      result: await runMemoryInspectorControl({
        action: action as MemoryInspectorControlAction,
        ...(ownerType ? { ownerType } : {}),
        ...(typeof req.body?.ownerId === "string" && req.body.ownerId.trim()
          ? { ownerId: req.body.ownerId.trim() }
          : {}),
        ...(typeof req.body?.sessionId === "string" && req.body.sessionId.trim()
          ? { sessionId: req.body.sessionId.trim() }
          : {}),
        ...(typeof req.body?.requestGroupId === "string" && req.body.requestGroupId.trim()
          ? { requestGroupId: req.body.requestGroupId.trim() }
          : {}),
        ...(typeof req.body?.limit === "number" ? { limit: req.body.limit } : {}),
      }),
    }
  })

  app.get<{
    Querystring: { status?: string; limit?: string }
  }>("/api/memory/writeback", { preHandler: authMiddleware }, async (req) => {
    return {
      candidates: listMemoryWritebackReviewItems({
        status: normalizeStatus(req.query.status),
        limit: normalizeLimit(req.query.limit),
      }),
    }
  })

  app.post<{
    Params: { id: string }
    Body: { action?: string; editedContent?: string; reviewerId?: string }
  }>("/api/memory/writeback/:id/review", { preHandler: authMiddleware }, async (req, reply) => {
    const action = req.body?.action
    if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action as MemoryWritebackReviewAction)) {
      return reply.status(400).send({ error: "invalid review action" })
    }
    try {
      const result = await reviewMemoryWritebackCandidate({
        id: req.params.id,
        action: action as MemoryWritebackReviewAction,
        ...(typeof req.body?.editedContent === "string" ? { editedContent: req.body.editedContent } : {}),
        ...(typeof req.body?.reviewerId === "string" ? { reviewerId: req.body.reviewerId } : {}),
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = /not found/i.test(message) ? 404 : 400
      return reply.status(status).send({ error: message })
    }
  })
}
