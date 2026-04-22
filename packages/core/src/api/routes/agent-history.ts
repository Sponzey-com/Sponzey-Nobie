import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import {
  approveLearningEvent,
  dryRunRestoreHistoryVersion,
  listAgentLearningEvents,
  listHistoryVersions,
  listRestoreEvents,
  restoreHistoryVersion,
} from "../../agent/learning.js"
import type { HistoryVersion, OwnerScope, RestoreEvent } from "../../contracts/sub-agent-orchestration.js"

const TARGET_TYPES = new Set<HistoryVersion["targetEntityType"]>(["agent", "team", "memory"])

function normalizeTargetType(value: string): HistoryVersion["targetEntityType"] | null {
  return TARGET_TYPES.has(value as HistoryVersion["targetEntityType"])
    ? value as HistoryVersion["targetEntityType"]
    : null
}

function normalizeOwner(value: unknown, fallbackId: string): OwnerScope {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<OwnerScope>
    : {}
  const ownerType = raw.ownerType === "nobie" || raw.ownerType === "sub_agent" || raw.ownerType === "team" || raw.ownerType === "system"
    ? raw.ownerType
    : "system"
  const ownerId = typeof raw.ownerId === "string" && raw.ownerId.trim() ? raw.ownerId.trim() : fallbackId
  return { ownerType, ownerId }
}

export function registerAgentHistoryRoute(app: FastifyInstance): void {
  app.get<{
    Params: { agentId: string }
  }>("/api/agents/:agentId/learning", { preHandler: authMiddleware }, async (req) => {
    return { events: listAgentLearningEvents(req.params.agentId) }
  })

  app.post<{
    Params: { agentId: string; learningEventId: string }
    Body: { owner?: OwnerScope; auditCorrelationId?: string }
  }>("/api/agents/:agentId/learning/:learningEventId/approve", { preHandler: authMiddleware }, async (req) => {
    return approveLearningEvent({
      agentId: req.params.agentId,
      learningEventId: req.params.learningEventId,
      owner: normalizeOwner(req.body?.owner, req.params.agentId),
      ...(typeof req.body?.auditCorrelationId === "string" ? { auditCorrelationId: req.body.auditCorrelationId } : {}),
    })
  })

  app.get<{
    Params: { targetType: string; targetId: string }
  }>("/api/history/:targetType/:targetId", { preHandler: authMiddleware }, async (req, reply) => {
    const targetType = normalizeTargetType(req.params.targetType)
    if (!targetType) return reply.status(400).send({ error: "invalid target type" })
    return {
      history: listHistoryVersions(targetType, req.params.targetId),
      restoreEvents: listRestoreEvents(targetType, req.params.targetId as RestoreEvent["targetEntityId"]),
    }
  })

  app.post<{
    Params: { targetType: string; targetId: string }
    Body: { restoredHistoryVersionId?: string }
  }>("/api/history/:targetType/:targetId/restore-dry-run", { preHandler: authMiddleware }, async (req, reply) => {
    const targetType = normalizeTargetType(req.params.targetType)
    if (!targetType) return reply.status(400).send({ error: "invalid target type" })
    if (typeof req.body?.restoredHistoryVersionId !== "string" || !req.body.restoredHistoryVersionId.trim()) {
      return reply.status(400).send({ error: "restoredHistoryVersionId is required" })
    }
    return dryRunRestoreHistoryVersion({
      targetEntityType: targetType,
      targetEntityId: req.params.targetId,
      restoredHistoryVersionId: req.body.restoredHistoryVersionId,
    })
  })

  app.post<{
    Params: { targetType: string; targetId: string }
    Body: { restoredHistoryVersionId?: string; dryRun?: boolean; apply?: boolean; owner?: OwnerScope; auditCorrelationId?: string }
  }>("/api/history/:targetType/:targetId/restore", { preHandler: authMiddleware }, async (req, reply) => {
    const targetType = normalizeTargetType(req.params.targetType)
    if (!targetType) return reply.status(400).send({ error: "invalid target type" })
    if (typeof req.body?.restoredHistoryVersionId !== "string" || !req.body.restoredHistoryVersionId.trim()) {
      return reply.status(400).send({ error: "restoredHistoryVersionId is required" })
    }
    return restoreHistoryVersion({
      targetEntityType: targetType,
      targetEntityId: req.params.targetId,
      restoredHistoryVersionId: req.body.restoredHistoryVersionId,
      owner: normalizeOwner(req.body.owner, req.params.targetId),
      dryRun: req.body.dryRun !== false,
      apply: req.body.apply === true,
      ...(typeof req.body.auditCorrelationId === "string" ? { auditCorrelationId: req.body.auditCorrelationId } : {}),
    })
  })
}
