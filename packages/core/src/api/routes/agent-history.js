import { authMiddleware } from "../middleware/auth.js";
import { approveLearningEvent, dryRunRestoreHistoryVersion, listAgentLearningEvents, listHistoryVersions, listRestoreEvents, restoreHistoryVersion, } from "../../agent/learning.js";
const TARGET_TYPES = new Set(["agent", "team", "memory"]);
function normalizeTargetType(value) {
    return TARGET_TYPES.has(value)
        ? value
        : null;
}
function normalizeOwner(value, fallbackId) {
    const raw = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const ownerType = raw.ownerType === "nobie" || raw.ownerType === "sub_agent" || raw.ownerType === "team" || raw.ownerType === "system"
        ? raw.ownerType
        : "system";
    const ownerId = typeof raw.ownerId === "string" && raw.ownerId.trim() ? raw.ownerId.trim() : fallbackId;
    return { ownerType, ownerId };
}
export function registerAgentHistoryRoute(app) {
    app.get("/api/agents/:agentId/learning", { preHandler: authMiddleware }, async (req) => {
        return { events: listAgentLearningEvents(req.params.agentId) };
    });
    app.post("/api/agents/:agentId/learning/:learningEventId/approve", { preHandler: authMiddleware }, async (req) => {
        return approveLearningEvent({
            agentId: req.params.agentId,
            learningEventId: req.params.learningEventId,
            owner: normalizeOwner(req.body?.owner, req.params.agentId),
            ...(typeof req.body?.auditCorrelationId === "string" ? { auditCorrelationId: req.body.auditCorrelationId } : {}),
        });
    });
    app.get("/api/history/:targetType/:targetId", { preHandler: authMiddleware }, async (req, reply) => {
        const targetType = normalizeTargetType(req.params.targetType);
        if (!targetType)
            return reply.status(400).send({ error: "invalid target type" });
        return {
            history: listHistoryVersions(targetType, req.params.targetId),
            restoreEvents: listRestoreEvents(targetType, req.params.targetId),
        };
    });
    app.post("/api/history/:targetType/:targetId/restore-dry-run", { preHandler: authMiddleware }, async (req, reply) => {
        const targetType = normalizeTargetType(req.params.targetType);
        if (!targetType)
            return reply.status(400).send({ error: "invalid target type" });
        if (typeof req.body?.restoredHistoryVersionId !== "string" || !req.body.restoredHistoryVersionId.trim()) {
            return reply.status(400).send({ error: "restoredHistoryVersionId is required" });
        }
        return dryRunRestoreHistoryVersion({
            targetEntityType: targetType,
            targetEntityId: req.params.targetId,
            restoredHistoryVersionId: req.body.restoredHistoryVersionId,
        });
    });
    app.post("/api/history/:targetType/:targetId/restore", { preHandler: authMiddleware }, async (req, reply) => {
        const targetType = normalizeTargetType(req.params.targetType);
        if (!targetType)
            return reply.status(400).send({ error: "invalid target type" });
        if (typeof req.body?.restoredHistoryVersionId !== "string" || !req.body.restoredHistoryVersionId.trim()) {
            return reply.status(400).send({ error: "restoredHistoryVersionId is required" });
        }
        return restoreHistoryVersion({
            targetEntityType: targetType,
            targetEntityId: req.params.targetId,
            restoredHistoryVersionId: req.body.restoredHistoryVersionId,
            owner: normalizeOwner(req.body.owner, req.params.targetId),
            dryRun: req.body.dryRun !== false,
            apply: req.body.apply === true,
            ...(typeof req.body.auditCorrelationId === "string" ? { auditCorrelationId: req.body.auditCorrelationId } : {}),
        });
    });
}
//# sourceMappingURL=agent-history.js.map