import { authMiddleware } from "../middleware/auth.js";
import { listMemoryWritebackReviewItems, reviewMemoryWritebackCandidate, } from "../../memory/writeback.js";
import { buildMemoryQualitySnapshot } from "../../memory/quality.js";
import { buildMemoryInspectorSnapshot, runMemoryInspectorControl, } from "../../memory/inspector.js";
const ALLOWED_STATUSES = new Set(["pending", "writing", "failed", "completed", "discarded", "all"]);
const ALLOWED_ACTIONS = new Set(["approve_long_term", "approve_edited", "keep_session", "discard"]);
const ALLOWED_OWNER_TYPES = new Set(["main_agent", "sub_agent"]);
const ALLOWED_INSPECTOR_ACTIONS = new Set([
    "dry_run_compaction",
    "latest_capsule_inspect",
    "rollup_inspect",
    "safe_restore",
    "force_compaction",
    "capsule_invalidate",
]);
function normalizeStatus(value) {
    return typeof value === "string" && ALLOWED_STATUSES.has(value)
        ? value
        : "pending";
}
function normalizeLimit(value) {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : 100;
}
function normalizeOwnerType(value) {
    return typeof value === "string" && ALLOWED_OWNER_TYPES.has(value)
        ? value
        : undefined;
}
export function registerMemoryRoute(app) {
    app.get("/api/memory/quality", { preHandler: authMiddleware }, async () => {
        return { snapshot: buildMemoryQualitySnapshot() };
    });
    app.get("/api/memory/inspector", { preHandler: authMiddleware }, async (req) => {
        const ownerType = normalizeOwnerType(req.query.ownerType);
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
        };
    });
    app.post("/api/memory/inspector/control", { preHandler: authMiddleware }, async (req, reply) => {
        const action = req.body?.action;
        if (typeof action !== "string" || !ALLOWED_INSPECTOR_ACTIONS.has(action)) {
            return reply.status(400).send({ error: "invalid memory inspector action" });
        }
        const ownerType = normalizeOwnerType(req.body?.ownerType);
        return {
            result: await runMemoryInspectorControl({
                action: action,
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
        };
    });
    app.get("/api/memory/writeback", { preHandler: authMiddleware }, async (req) => {
        return {
            candidates: listMemoryWritebackReviewItems({
                status: normalizeStatus(req.query.status),
                limit: normalizeLimit(req.query.limit),
            }),
        };
    });
    app.post("/api/memory/writeback/:id/review", { preHandler: authMiddleware }, async (req, reply) => {
        const action = req.body?.action;
        if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
            return reply.status(400).send({ error: "invalid review action" });
        }
        try {
            const result = await reviewMemoryWritebackCandidate({
                id: req.params.id,
                action: action,
                ...(typeof req.body?.editedContent === "string" ? { editedContent: req.body.editedContent } : {}),
                ...(typeof req.body?.reviewerId === "string" ? { reviewerId: req.body.reviewerId } : {}),
            });
            return result;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const status = /not found/i.test(message) ? 404 : 400;
            return reply.status(status).send({ error: message });
        }
    });
}
//# sourceMappingURL=memory.js.map