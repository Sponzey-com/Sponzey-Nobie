import crypto from "node:crypto";
import { authMiddleware } from "../middleware/auth.js";
import { listTaskContinuityForLineages, listMemoryAccessTraceForRun, } from "../../db/index.js";
import { cancelRootRun, cleanupStaleRunStates, clearHistoricalRunHistory, deleteRunHistory, getRootRun, listActiveRootRuns, listRootRuns, listRunsForRecentRequestGroups, } from "../../runs/store.js";
import { buildActiveRunProjections } from "../../runs/active-run-projection.js";
import { startIngressRun } from "../../runs/ingress.js";
import { recordMessageLedgerEvent } from "../../runs/message-ledger.js";
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
    if (receipt.text.trim()) {
        const startedRun = getRootRun(started.runId);
        recordMessageLedgerEvent({
            runId: started.runId,
            requestGroupId: startedRun?.requestGroupId ?? started.runId,
            sessionKey: sessionId,
            threadKey: sessionId,
            channel: params.source,
            eventKind: "fast_receipt_sent",
            deliveryKey: `${params.source}:receipt:${sessionId}:${started.runId}`,
            idempotencyKey: `${params.source}:receipt:${started.runId}`,
            status: "sent",
            summary: `${params.source} 접수 메시지를 전송했습니다.`,
            detail: { receiptLength: receipt.text.length },
        });
    }
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
        const runs = listRootRuns();
        return {
            runs,
            activeRunProjections: buildActiveRunProjections(runs.filter((run) => (run.status === "queued"
                || run.status === "running"
                || run.status === "awaiting_approval"
                || run.status === "awaiting_user"))),
        };
    });
    app.get("/api/runs/active", { preHandler: authMiddleware }, async () => {
        const runs = listActiveRootRuns();
        return { runs, activeRunProjections: buildActiveRunProjections(runs) };
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
    app.get("/api/runs/:id/memory-trace", { preHandler: authMiddleware }, async (req, reply) => {
        const run = getRootRun(req.params.id);
        if (!run)
            return reply.status(404).send({ error: "Run not found" });
        const parsedLimit = Number.parseInt(req.query.limit ?? "", 10);
        return { traces: listMemoryAccessTraceForRun(req.params.id, Number.isFinite(parsedLimit) ? parsedLimit : 100) };
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