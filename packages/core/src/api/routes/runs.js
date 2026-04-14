import crypto from "node:crypto";
import { authMiddleware } from "../middleware/auth.js";
import { listTaskContinuityForLineages, } from "../../db/index.js";
import { cancelRootRun, cleanupStaleRunStates, clearHistoricalRunHistory, deleteRunHistory, getRootRun, listRootRuns, listRunsForRecentRequestGroups, } from "../../runs/store.js";
import { startIngressRun } from "../../runs/ingress.js";
import { buildTaskModels } from "../../runs/task-model.js";
import { buildOperationsSummary, DEFAULT_STALE_RUN_MS } from "../../runs/operations.js";
import { createWebUiChunkDeliveryHandler } from "../ws/chunk-delivery.js";
export async function startLocalRun(params) {
    const runId = crypto.randomUUID();
    const sessionId = params.sessionId ?? crypto.randomUUID();
    const { started, receipt, requestId, source } = startIngressRun({
        ...params,
        runId,
        sessionId,
        ...(params.source === "webui"
            ? { onChunk: createWebUiChunkDeliveryHandler({ sessionId, runId }) }
            : {}),
    });
    return {
        requestId,
        runId: started.runId,
        sessionId,
        source,
        status: started.status,
        receipt: receipt.text,
    };
}
export function registerRunsRoute(app) {
    function listTaskSnapshot() {
        const runs = listRunsForRecentRequestGroups();
        const continuity = listTaskContinuityForLineages(runs.map((run) => run.lineageRootRunId || run.requestGroupId || run.id));
        const tasks = buildTaskModels(runs, continuity);
        return { runs, tasks };
    }
    app.get("/api/runs", { preHandler: authMiddleware }, async () => {
        return { runs: listRootRuns() };
    });
    app.get("/api/tasks", { preHandler: authMiddleware }, async () => {
        return { tasks: listTaskSnapshot().tasks };
    });
    app.get("/api/runs/operations/summary", { preHandler: authMiddleware }, async (req) => {
        const staleMs = Number.parseInt(req.query.staleMs ?? "", 10);
        const snapshot = listTaskSnapshot();
        return {
            summary: buildOperationsSummary({
                ...snapshot,
                staleThresholdMs: Number.isFinite(staleMs) && staleMs > 0 ? staleMs : DEFAULT_STALE_RUN_MS,
            }),
        };
    });
    app.post("/api/runs/operations/stale-cleanup", { preHandler: authMiddleware }, async (req) => {
        const staleMs = typeof req.body?.staleMs === "number" && Number.isFinite(req.body.staleMs) ? req.body.staleMs : undefined;
        const cleanup = cleanupStaleRunStates({ ...(staleMs ? { staleMs } : {}) });
        const snapshot = listTaskSnapshot();
        return {
            ok: true,
            cleanup,
            summary: buildOperationsSummary({
                ...snapshot,
                staleThresholdMs: cleanup.thresholdMs,
            }),
        };
    });
    app.get("/api/runs/:id", { preHandler: authMiddleware }, async (req, reply) => {
        const run = getRootRun(req.params.id);
        if (!run)
            return reply.status(404).send({ error: "Run not found" });
        return { run };
    });
    app.get("/api/runs/:id/steps", { preHandler: authMiddleware }, async (req, reply) => {
        const run = getRootRun(req.params.id);
        if (!run)
            return reply.status(404).send({ error: "Run not found" });
        return { steps: run.steps };
    });
    app.get("/api/runs/:id/timeline", { preHandler: authMiddleware }, async (req, reply) => {
        const run = getRootRun(req.params.id);
        if (!run)
            return reply.status(404).send({ error: "Run not found" });
        return { events: run.recentEvents };
    });
    app.post("/api/runs", { preHandler: authMiddleware }, async (req, reply) => {
        const message = req.body?.message?.trim();
        if (!message)
            return reply.status(400).send({ error: "message is required" });
        return startLocalRun({
            message,
            sessionId: req.body.sessionId,
            model: req.body.model,
            source: "webui",
        });
    });
    app.post("/api/runs/:id/cancel", { preHandler: authMiddleware }, async (req, reply) => {
        const run = cancelRootRun(req.params.id);
        if (!run)
            return reply.status(404).send({ error: "Run not found or not cancellable" });
        return { run };
    });
    app.delete("/api/runs/history/inactive", { preHandler: authMiddleware }, async () => {
        const result = clearHistoricalRunHistory();
        return { ok: true, deletedRunCount: result.deletedRunCount };
    });
    app.delete("/api/runs/:id", { preHandler: authMiddleware }, async (req, reply) => {
        const result = deleteRunHistory(req.params.id);
        if (!result)
            return reply.status(404).send({ error: "Run not found" });
        if (result.blockedRunCount && result.blockedRunCount > 0) {
            return reply.status(409).send({ error: "Active run history cannot be deleted", blockedRunCount: result.blockedRunCount });
        }
        return { ok: true, deletedRunCount: result.deletedRunCount };
    });
}
//# sourceMappingURL=runs.js.map