import { listObservedTopologyEdges, listTopologyMetricsDaily, } from "../../topology/metrics.js";
import { getTopologyRun, getTopologyRunTraceProjection, listTopologyFailureReports, listTopologyNodeRuns, listTopologyRuns, listTopologyToolCalls, listTopologyTraceEvents, listTopologyWorkOrders, } from "../../topology-runtime/trace.js";
import { WORK_ORDER_TEMPLATE_CATALOG } from "../../topology-runtime/work-order-templates.js";
import { authMiddleware } from "../middleware/auth.js";
function asLimit(value, fallback) {
    if (value === undefined)
        return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0)
        return fallback;
    return parsed;
}
function nonEmpty(value) {
    return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}
export function registerTopologyRunRoutes(app) {
    app.get("/api/work-order-templates", { preHandler: authMiddleware }, async () => {
        return {
            ok: true,
            catalog: WORK_ORDER_TEMPLATE_CATALOG,
            templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        };
    });
    app.get("/api/topology-runs", { preHandler: authMiddleware }, async (req) => {
        const topologyId = nonEmpty(req.query.topologyId);
        const rootRunId = nonEmpty(req.query.rootRunId);
        const status = nonEmpty(req.query.status);
        return {
            ok: true,
            topologyRuns: listTopologyRuns({
                ...(topologyId !== undefined ? { topologyId } : {}),
                ...(rootRunId !== undefined ? { rootRunId } : {}),
                ...(status !== undefined ? { status } : {}),
                limit: asLimit(req.query.limit, 100),
            }),
        };
    });
    app.get("/api/topology-runs/:topologyRunId", { preHandler: authMiddleware }, async (req, reply) => {
        const projection = getTopologyRunTraceProjection(req.params.topologyRunId, {
            limit: asLimit(req.query.limit, 500),
        });
        if (projection === null)
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        return { ok: true, topologyRun: projection };
    });
    app.get("/api/topology-runs/:topologyRunId/nodes", { preHandler: authMiddleware }, async (req, reply) => {
        if (getTopologyRun(req.params.topologyRunId) === null) {
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        }
        return {
            ok: true,
            nodeRuns: listTopologyNodeRuns(req.params.topologyRunId, {
                limit: asLimit(req.query.limit, 200),
            }),
        };
    });
    app.get("/api/topology-runs/:topologyRunId/work-orders", { preHandler: authMiddleware }, async (req, reply) => {
        if (getTopologyRun(req.params.topologyRunId) === null) {
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        }
        return {
            ok: true,
            workOrders: listTopologyWorkOrders(req.params.topologyRunId, {
                limit: asLimit(req.query.limit, 200),
            }),
        };
    });
    app.get("/api/topology-runs/:topologyRunId/trace", { preHandler: authMiddleware }, async (req, reply) => {
        if (getTopologyRun(req.params.topologyRunId) === null) {
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        }
        return {
            ok: true,
            traceEvents: listTopologyTraceEvents(req.params.topologyRunId, {
                limit: asLimit(req.query.limit, 500),
            }),
        };
    });
    app.get("/api/topology-runs/:topologyRunId/tool-calls", { preHandler: authMiddleware }, async (req, reply) => {
        if (getTopologyRun(req.params.topologyRunId) === null) {
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        }
        return {
            ok: true,
            toolCalls: listTopologyToolCalls(req.params.topologyRunId, {
                limit: asLimit(req.query.limit, 200),
            }),
        };
    });
    app.get("/api/topology-runs/:topologyRunId/failure-reports", { preHandler: authMiddleware }, async (req, reply) => {
        if (getTopologyRun(req.params.topologyRunId) === null) {
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        }
        return {
            ok: true,
            failureReports: listTopologyFailureReports(req.params.topologyRunId, {
                limit: asLimit(req.query.limit, 200),
            }),
        };
    });
    app.get("/api/topology-runs/:topologyRunId/metrics", { preHandler: authMiddleware }, async (req, reply) => {
        const run = getTopologyRun(req.params.topologyRunId);
        if (run === null)
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        return {
            ok: true,
            metrics: listTopologyMetricsDaily({
                topologyId: run.topologyId,
                limit: asLimit(req.query.limit, 90),
            }),
        };
    });
    app.get("/api/topology-runs/:topologyRunId/observed-edges", { preHandler: authMiddleware }, async (req, reply) => {
        if (getTopologyRun(req.params.topologyRunId) === null) {
            return reply.status(404).send({ ok: false, error: "topology_run_not_found" });
        }
        return {
            ok: true,
            observedEdges: listObservedTopologyEdges({
                topologyRunId: req.params.topologyRunId,
                limit: asLimit(req.query.limit, 200),
            }),
        };
    });
}
//# sourceMappingURL=topology-runs.js.map