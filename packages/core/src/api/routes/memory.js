import { authMiddleware } from "../middleware/auth.js";
import { listMemoryWritebackReviewItems, reviewMemoryWritebackCandidate, } from "../../memory/writeback.js";
const ALLOWED_STATUSES = new Set(["pending", "writing", "failed", "completed", "discarded", "all"]);
const ALLOWED_ACTIONS = new Set(["approve_long_term", "approve_edited", "keep_session", "discard"]);
function normalizeStatus(value) {
    return typeof value === "string" && ALLOWED_STATUSES.has(value)
        ? value
        : "pending";
}
function normalizeLimit(value) {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : 100;
}
export function registerMemoryRoute(app) {
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