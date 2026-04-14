import { authMiddleware } from "../middleware/auth.js";
import { sanitizeUserFacingError } from "../../runs/error-sanitizer.js";
import { buildConfigurationOperationsSnapshot, createDatabaseBackup, dryRunDatabaseMigrations, exportMaskedConfig, exportPromptSources, importDatabaseFromBackup, importPromptSources, recoverPromptSources, } from "../../config/operations.js";
function resolveWorkDir(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : process.cwd();
}
function sendOperationError(reply, error) {
    const sanitized = sanitizeUserFacingError(error instanceof Error ? error.message : String(error));
    return reply.status(400).send({
        ok: false,
        error: sanitized.userMessage,
        kind: sanitized.kind,
        actionHint: sanitized.actionHint,
    });
}
export function registerConfigOperationsRoute(app) {
    app.get("/api/config/operations", { preHandler: authMiddleware }, async (req) => {
        return { snapshot: buildConfigurationOperationsSnapshot(resolveWorkDir(req.query.workDir)) };
    });
    app.get("/api/config/migrations/dry-run", { preHandler: authMiddleware }, async () => {
        return { dryRun: dryRunDatabaseMigrations() };
    });
    app.post("/api/config/db/backup", { preHandler: authMiddleware }, async (_req, reply) => {
        try {
            return { ok: true, backup: createDatabaseBackup("backup"), snapshot: buildConfigurationOperationsSnapshot() };
        }
        catch (error) {
            return sendOperationError(reply, error);
        }
    });
    app.post("/api/config/db/export", { preHandler: authMiddleware }, async (_req, reply) => {
        try {
            return { ok: true, export: createDatabaseBackup("export"), snapshot: buildConfigurationOperationsSnapshot() };
        }
        catch (error) {
            return sendOperationError(reply, error);
        }
    });
    app.post("/api/config/db/import", { preHandler: authMiddleware }, async (req, reply) => {
        if (!req.body?.backupPath)
            return reply.status(400).send({ ok: false, error: "backupPath is required" });
        try {
            return { ok: true, import: importDatabaseFromBackup({ backupPath: req.body.backupPath }), snapshot: buildConfigurationOperationsSnapshot() };
        }
        catch (error) {
            return sendOperationError(reply, error);
        }
    });
    app.post("/api/config/export", { preHandler: authMiddleware }, async (_req, reply) => {
        try {
            return { ok: true, export: exportMaskedConfig() };
        }
        catch (error) {
            return sendOperationError(reply, error);
        }
    });
    app.post("/api/config/prompt-sources/export", { preHandler: authMiddleware }, async (req, reply) => {
        try {
            const workDir = resolveWorkDir(req.body?.workDir);
            return { ok: true, export: exportPromptSources(workDir), snapshot: buildConfigurationOperationsSnapshot(workDir) };
        }
        catch (error) {
            return sendOperationError(reply, error);
        }
    });
    app.post("/api/config/prompt-sources/import", { preHandler: authMiddleware }, async (req, reply) => {
        if (!req.body?.exportPath)
            return reply.status(400).send({ ok: false, error: "exportPath is required" });
        try {
            const workDir = resolveWorkDir(req.body.workDir);
            return {
                ok: true,
                import: importPromptSources({
                    workDir,
                    exportPath: req.body.exportPath,
                    ...(req.body.overwrite !== undefined ? { overwrite: req.body.overwrite } : {}),
                }),
                snapshot: buildConfigurationOperationsSnapshot(workDir),
            };
        }
        catch (error) {
            return sendOperationError(reply, error);
        }
    });
    app.post("/api/config/prompt-sources/recover", { preHandler: authMiddleware }, async (req, reply) => {
        try {
            const workDir = resolveWorkDir(req.body?.workDir);
            return { ok: true, recovery: recoverPromptSources(workDir), snapshot: buildConfigurationOperationsSnapshot(workDir) };
        }
        catch (error) {
            return sendOperationError(reply, error);
        }
    });
}
//# sourceMappingURL=config-operations.js.map