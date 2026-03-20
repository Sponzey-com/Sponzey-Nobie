import { getDb } from "../../db/index.js";
import { authMiddleware } from "../middleware/auth.js";
const SENSITIVE_KEYS = /api[_-]?key|token|password|secret|credential/i;
function maskParams(raw) {
    if (!raw)
        return "{}";
    try {
        const obj = JSON.parse(raw);
        for (const key of Object.keys(obj)) {
            if (SENSITIVE_KEYS.test(key))
                obj[key] = "***";
        }
        return JSON.stringify(obj);
    }
    catch {
        return raw;
    }
}
export function registerAuditRoute(app) {
    app.get("/api/audit", { preHandler: authMiddleware }, async (req) => {
        const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
        const page = Math.max(parseInt(req.query.page ?? "1", 10), 1);
        const offset = (page - 1) * limit;
        const conditions = [];
        const bindings = [];
        if (req.query.toolName) {
            conditions.push("tool_name LIKE ?");
            bindings.push(`%${req.query.toolName}%`);
        }
        if (req.query.result) {
            conditions.push("result = ?");
            bindings.push(req.query.result);
        }
        if (req.query.sessionId) {
            conditions.push("session_id = ?");
            bindings.push(req.query.sessionId);
        }
        if (req.query.from) {
            conditions.push("timestamp >= ?");
            bindings.push(new Date(req.query.from).getTime());
        }
        if (req.query.to) {
            conditions.push("timestamp <= ?");
            bindings.push(new Date(req.query.to).getTime());
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const total = getDb().prepare(`SELECT COUNT(*) as n FROM audit_logs ${where}`).get(...bindings).n;
        const rows = getDb()
            .prepare(`SELECT timestamp, session_id, tool_name, params, output, result, duration_ms, approval_required, approved_by
         FROM audit_logs ${where}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`)
            .all(...bindings, limit, offset);
        const items = rows.map((r) => ({ ...r, params: maskParams(r.params) }));
        return { items, total, page, pages: Math.ceil(total / limit), limit };
    });
}
//# sourceMappingURL=audit.js.map