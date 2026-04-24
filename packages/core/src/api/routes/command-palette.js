import { AGENT_TEMPLATES, TEAM_TEMPLATES, clearFocusBinding, createOneClickBackgroundTask, executeWorkspaceCommand, getFocusBinding, importExternalAgentProfileDraft, instantiateAgentTemplate, instantiateTeamTemplate, lintAgentDescription, resolveFocusBinding, searchCommandPalette, setFocusBinding, } from "../../orchestration/command-workspace.js";
import { authMiddleware } from "../middleware/auth.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function asNumber(value) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function focusTargetFromBody(body) {
    const record = isRecord(body) ? body : {};
    const target = isRecord(record.target) ? record.target : record;
    const kind = asString(target.kind);
    const id = asString(target.id);
    if ((kind === "agent" || kind === "team" || kind === "sub_session") && id) {
        const label = asString(target.label);
        return {
            kind,
            id,
            ...(label ? { label } : {}),
        };
    }
    return undefined;
}
function sendCommandFailure(reply, failure) {
    return reply.status(failure.statusCode ?? 400).send({
        ok: false,
        error: failure.reasonCode,
        reasonCode: failure.reasonCode,
        ...(failure.details !== undefined ? { details: failure.details } : {}),
    });
}
function commandPaletteScope(value) {
    if (value === "agent" ||
        value === "team" ||
        value === "sub_session" ||
        value === "command" ||
        value === "agent_template" ||
        value === "team_template") {
        return value;
    }
    return "all";
}
export function registerCommandPaletteRoutes(app) {
    app.get("/api/command-palette/search", { preHandler: authMiddleware }, async (req) => {
        const limit = asNumber(req.query.limit);
        return searchCommandPalette({
            ...(req.query.q ? { query: req.query.q } : {}),
            scope: commandPaletteScope(req.query.scope),
            ...(limit !== undefined ? { limit } : {}),
        });
    });
    app.post("/api/commands/execute", { preHandler: authMiddleware }, async (req, reply) => {
        const record = isRecord(req.body) ? req.body : {};
        const command = asString(record.command);
        if (!command) {
            return sendCommandFailure(reply, {
                reasonCode: "command_required",
                statusCode: 400,
            });
        }
        const threadId = asString(record.threadId);
        const parentAgentId = asString(record.parentAgentId);
        const result = executeWorkspaceCommand({
            command,
            ...(threadId ? { threadId } : {}),
            ...(parentAgentId ? { parentAgentId } : {}),
            payload: record.payload,
        });
        const statusCode = result.statusCode ?? (result.ok ? 200 : 400);
        return reply.status(statusCode).send(result);
    });
    app.get("/api/focus/:threadId", { preHandler: authMiddleware }, async (req) => {
        return {
            ok: true,
            threadId: req.params.threadId,
            binding: getFocusBinding(req.params.threadId) ?? null,
        };
    });
    app.put("/api/focus/:threadId", { preHandler: authMiddleware }, async (req, reply) => {
        const target = focusTargetFromBody(req.body);
        if (!target) {
            return sendCommandFailure(reply, {
                reasonCode: "focus_target_required",
                statusCode: 400,
            });
        }
        const record = isRecord(req.body) ? req.body : {};
        const parentAgentId = asString(record.parentAgentId);
        const result = setFocusBinding({
            threadId: req.params.threadId,
            ...(parentAgentId ? { parentAgentId } : {}),
            target,
            source: "api",
        });
        if (!result.ok)
            return sendCommandFailure(reply, result);
        return { ok: true, focus: result };
    });
    app.delete("/api/focus/:threadId", { preHandler: authMiddleware }, async (req) => {
        return clearFocusBinding(req.params.threadId);
    });
    app.post("/api/focus/:threadId/resolve", { preHandler: authMiddleware }, async (req, reply) => {
        const record = isRecord(req.body) ? req.body : {};
        const parentAgentId = asString(record.parentAgentId);
        const result = resolveFocusBinding({
            threadId: req.params.threadId,
            ...(parentAgentId ? { parentAgentId } : {}),
        });
        if (!result.ok)
            return sendCommandFailure(reply, result);
        return { ok: true, focus: result };
    });
    app.get("/api/templates/agents", { preHandler: authMiddleware }, async () => {
        return { ok: true, templates: AGENT_TEMPLATES };
    });
    app.post("/api/templates/agents/:templateId/instantiate", { preHandler: authMiddleware }, async (req, reply) => {
        const record = isRecord(req.body) ? req.body : {};
        const result = instantiateAgentTemplate({
            templateId: req.params.templateId,
            overrides: record.overrides,
            persist: record.persist !== false,
        });
        if (!result.ok) {
            return sendCommandFailure(reply, {
                reasonCode: result.reasonCode,
                statusCode: result.reasonCode === "agent_template_not_found" ? 404 : 400,
                details: result.issues,
            });
        }
        return result;
    });
    app.get("/api/templates/teams", { preHandler: authMiddleware }, async () => {
        return { ok: true, templates: TEAM_TEMPLATES };
    });
    app.post("/api/templates/teams/:templateId/instantiate", { preHandler: authMiddleware }, async (req, reply) => {
        const record = isRecord(req.body) ? req.body : {};
        const result = instantiateTeamTemplate({
            templateId: req.params.templateId,
            overrides: record.overrides,
            persist: record.persist !== false,
        });
        if (!result.ok) {
            return sendCommandFailure(reply, {
                reasonCode: result.reasonCode,
                statusCode: result.reasonCode === "team_template_not_found" ? 404 : 400,
                details: result.issues,
            });
        }
        return result;
    });
    app.post("/api/import/agents/draft", { preHandler: authMiddleware }, async (req, reply) => {
        const record = isRecord(req.body) ? req.body : {};
        const source = asString(record.source);
        const result = importExternalAgentProfileDraft({
            profile: record.profile ?? record,
            ...(source ? { source } : {}),
            overrides: record.overrides,
            persist: record.persist !== false,
        });
        if (!result.ok) {
            return sendCommandFailure(reply, {
                reasonCode: result.reasonCode,
                statusCode: 400,
                details: result.issues,
            });
        }
        return result;
    });
    app.post("/api/agent-description/lint", { preHandler: authMiddleware }, async (req, reply) => {
        const record = isRecord(req.body) ? req.body : {};
        const description = asString(record.description);
        if (!description) {
            return sendCommandFailure(reply, {
                reasonCode: "description_required",
                statusCode: 400,
            });
        }
        return lintAgentDescription(description);
    });
    app.post("/api/background-task", { preHandler: authMiddleware }, async (req, reply) => {
        const record = isRecord(req.body) ? req.body : {};
        const message = asString(record.message);
        const sessionId = asString(record.sessionId);
        const parentRunId = asString(record.parentRunId);
        const targetAgentId = asString(record.targetAgentId);
        const result = createOneClickBackgroundTask({
            ...(message ? { message } : {}),
            ...(sessionId ? { sessionId } : {}),
            ...(parentRunId ? { parentRunId } : {}),
            ...(targetAgentId ? { targetAgentId } : {}),
            dryRun: record.dryRun !== false,
        });
        if (!result.ok)
            return sendCommandFailure(reply, result);
        return result;
    });
}
//# sourceMappingURL=command-palette.js.map