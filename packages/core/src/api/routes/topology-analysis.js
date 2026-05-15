import { analyzeTopologyGaps, } from "../../topology/gap-analysis.js";
import { listTopologyGapFindings, } from "../../topology/metrics.js";
import { extractObservedTopologyEdges, } from "../../topology/observed.js";
import { createEnterpriseTopologyRegistry, } from "../../topology/registry.js";
import { authMiddleware } from "../middleware/auth.js";
function asPositiveInteger(value) {
    if (value === undefined)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function asLimit(value, fallback) {
    const parsed = asPositiveInteger(value);
    return parsed === undefined ? fallback : parsed;
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function resolveTopology(topologyId, version) {
    const registry = createEnterpriseTopologyRegistry();
    const requestedVersion = asPositiveInteger(version);
    const exported = registry.exportTopology(topologyId, requestedVersion);
    return exported;
}
export function registerTopologyAnalysisRoutes(app) {
    app.get("/api/topologies/:topologyId/observed", { preHandler: authMiddleware }, async (req, reply) => {
        const exported = resolveTopology(req.params.topologyId, req.query.version);
        if (exported === null)
            return reply.status(404).send({ ok: false, error: "topology_not_found" });
        const topologyRunId = nonEmpty(req.query.topologyRunId);
        return {
            ok: true,
            observedEdges: extractObservedTopologyEdges({
                topology: exported.version.topology,
                ...(topologyRunId !== undefined ? { topologyRunId } : {}),
            }).slice(0, asLimit(req.query.limit, 500)),
        };
    });
    app.get("/api/topologies/:topologyId/gaps", { preHandler: authMiddleware }, async (req, reply) => {
        if (resolveTopology(req.params.topologyId, req.query.version) === null) {
            return reply.status(404).send({ ok: false, error: "topology_not_found" });
        }
        const topologyRunId = nonEmpty(req.query.topologyRunId);
        return {
            ok: true,
            findings: listTopologyGapFindings({
                topologyId: req.params.topologyId,
                ...(topologyRunId !== undefined ? { topologyRunId } : {}),
                limit: asLimit(req.query.limit, 500),
            }),
        };
    });
    app.post("/api/topologies/:topologyId/analyze", { preHandler: authMiddleware }, async (req, reply) => {
        const exported = resolveTopology(req.params.topologyId, req.query.version);
        if (exported === null)
            return reply.status(404).send({ ok: false, error: "topology_not_found" });
        const body = isRecord(req.body) ? req.body : {};
        const bodyTopologyRunId = nonEmpty(body.topologyRunId);
        const queryTopologyRunId = nonEmpty(req.query.topologyRunId);
        const topologyRunId = bodyTopologyRunId ?? queryTopologyRunId;
        const persist = body.persist !== false;
        return {
            ok: true,
            analysis: analyzeTopologyGaps({
                topology: exported.version.topology,
                ...(topologyRunId !== undefined ? { topologyRunId } : {}),
                persist,
            }),
        };
    });
}
//# sourceMappingURL=topology-analysis.js.map