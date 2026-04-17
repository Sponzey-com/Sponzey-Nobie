import { exportControlTimeline, getControlTimeline, } from "../../control-plane/timeline.js";
import { authMiddleware } from "../middleware/auth.js";
function parseLimit(value) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return Math.min(parsed, 2_000);
}
function parseSeverity(value) {
    return value === "debug" || value === "info" || value === "warning" || value === "error" ? value : undefined;
}
function parseAudience(value) {
    return value === "developer" ? "developer" : "user";
}
function parseFormat(value) {
    return value === "json" ? "json" : "markdown";
}
function toTimelineQuery(query) {
    const severity = parseSeverity(query.severity);
    const limit = parseLimit(query.limit);
    return {
        ...(query.runId ? { runId: query.runId } : {}),
        ...(query.requestGroupId ? { requestGroupId: query.requestGroupId } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {}),
        ...(query.eventType ? { eventType: query.eventType } : {}),
        ...(query.component ? { component: query.component } : {}),
        ...(severity ? { severity } : {}),
        ...(limit ? { limit } : {}),
    };
}
export function registerControlTimelineRoute(app) {
    app.get("/api/control/timeline", { preHandler: authMiddleware }, async (req) => ({
        timeline: getControlTimeline(toTimelineQuery(req.query), parseAudience(req.query.audience)),
    }));
    app.get("/api/control/timeline/export", { preHandler: authMiddleware }, async (req) => ({
        export: exportControlTimeline({
            ...toTimelineQuery(req.query),
            audience: parseAudience(req.query.audience),
            format: parseFormat(req.query.format),
        }),
    }));
}
//# sourceMappingURL=control-timeline.js.map