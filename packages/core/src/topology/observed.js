import { createHash } from "node:crypto";
import { getDb } from "../db/index.js";
import { listObservedTopologyEdges } from "./metrics.js";
function parseJson(value) {
    if (value === null || value === undefined || value.trim().length === 0)
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isEntityRef(value) {
    return isRecord(value) && typeof value.entityType === "string" && typeof value.id === "string";
}
function timestampToNumber(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim().length > 0) {
        const numeric = Number(value);
        if (Number.isFinite(numeric))
            return numeric;
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return fallback;
}
function hashText(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
function edgeIdentity(input) {
    return [
        input.topologyId,
        input.topologyRunId ?? "all-runs",
        input.relationType,
        input.from.entityType,
        input.from.id,
        input.to.entityType,
        input.to.id,
        input.source,
    ].join("|");
}
function buildObservedEdge(input) {
    const identity = edgeIdentity({
        topologyId: input.topologyId,
        ...(input.topologyRunId !== undefined ? { topologyRunId: input.topologyRunId } : {}),
        relationType: input.relationType,
        from: input.from,
        to: input.to,
        source: input.source,
    });
    const edge = {
        edgeId: input.edgeId ?? `observed:${hashText(identity)}`,
        topologyId: input.topologyId,
        relationType: input.relationType,
        edgeKind: input.edgeKind,
        from: { ...input.from },
        to: { ...input.to },
        source: input.source,
        confidence: input.confidence,
        firstSeenAt: input.firstSeenAt,
        lastSeenAt: input.lastSeenAt,
        evidence: { ...input.evidence },
    };
    if (input.topologyRunId !== undefined)
        edge.topologyRunId = input.topologyRunId;
    return edge;
}
function dedupeEdges(edges) {
    const byKey = new Map();
    for (const edge of edges) {
        const key = edgeIdentity({
            topologyId: edge.topologyId,
            ...(edge.topologyRunId !== undefined ? { topologyRunId: edge.topologyRunId } : {}),
            relationType: edge.relationType,
            from: edge.from,
            to: edge.to,
            source: edge.source,
        });
        const existing = byKey.get(key);
        if (existing === undefined) {
            byKey.set(key, edge);
            continue;
        }
        byKey.set(key, {
            ...existing,
            confidence: Math.max(existing.confidence, edge.confidence),
            firstSeenAt: Math.min(existing.firstSeenAt, edge.firstSeenAt),
            lastSeenAt: Math.max(existing.lastSeenAt, edge.lastSeenAt),
            evidence: {
                ...existing.evidence,
                ...edge.evidence,
            },
        });
    }
    return [...byKey.values()].sort((left, right) => {
        return left.firstSeenAt - right.firstSeenAt || left.edgeId.localeCompare(right.edgeId);
    });
}
function topologyIdFromOptions(options) {
    const topologyId = options.topologyId ?? options.topology?.id;
    if (topologyId === undefined)
        throw new Error("topologyId or topology is required");
    return topologyId;
}
function listWorkOrderRows(db, input) {
    const params = [input.topologyId];
    const runFilter = input.topologyRunId !== undefined ? "AND wo.topology_run_id = ?" : "";
    if (input.topologyRunId !== undefined)
        params.push(input.topologyRunId);
    return db.prepare(`SELECT wo.*
     FROM topology_work_orders wo
     JOIN topology_runs tr ON tr.topology_run_id = wo.topology_run_id
     WHERE tr.topology_id = ?
     ${runFilter}
     ORDER BY wo.created_at ASC, wo.work_order_id ASC`).all(...params);
}
function listToolCallRows(db, input) {
    const params = [input.topologyId];
    const runFilter = input.topologyRunId !== undefined ? "AND tc.topology_run_id = ?" : "";
    if (input.topologyRunId !== undefined)
        params.push(input.topologyRunId);
    return db.prepare(`SELECT tc.*, nr.node_id
     FROM topology_tool_calls tc
     JOIN topology_runs tr ON tr.topology_run_id = tc.topology_run_id
     JOIN topology_node_runs nr ON nr.node_run_id = tc.node_run_id
     WHERE tr.topology_id = ?
     ${runFilter}
     ORDER BY tc.started_at ASC, tc.tool_call_id ASC`).all(...params);
}
function listFailureRows(db, input) {
    const params = [input.topologyId];
    const runFilter = input.topologyRunId !== undefined ? "AND fr.topology_run_id = ?" : "";
    if (input.topologyRunId !== undefined)
        params.push(input.topologyRunId);
    return db.prepare(`SELECT fr.*
     FROM topology_failure_reports fr
     JOIN topology_runs tr ON tr.topology_run_id = fr.topology_run_id
     WHERE tr.topology_id = ?
     ${runFilter}
     ORDER BY fr.created_at ASC, fr.failure_report_id ASC`).all(...params);
}
function listTraceRows(db, input) {
    const params = [input.topologyId];
    const runFilter = input.topologyRunId !== undefined ? "AND te.topology_run_id = ?" : "";
    if (input.topologyRunId !== undefined)
        params.push(input.topologyRunId);
    return db.prepare(`SELECT te.trace_event_id, te.topology_run_id, te.work_order_id, te.payload_json, te.event_json, te.at
     FROM topology_trace_events te
     JOIN topology_runs tr ON tr.topology_run_id = te.topology_run_id
     WHERE tr.topology_id = ?
     ${runFilter}
     ORDER BY te.at ASC, te.sequence ASC`).all(...params);
}
function workOrderTargetNodeId(workOrder) {
    if (workOrder === undefined)
        return undefined;
    if ("to" in workOrder)
        return workOrder.to.type === "node" ? workOrder.to.id : undefined;
    return workOrder.to_type === "node" ? workOrder.to_id : undefined;
}
function edgesFromDelegationPath(input) {
    const edges = [];
    for (let index = 0; index < input.path.length - 1; index += 1) {
        const fromNodeId = input.path[index];
        const toNodeId = input.path[index + 1];
        if (fromNodeId === undefined || toNodeId === undefined)
            continue;
        edges.push(buildObservedEdge({
            topologyId: input.topologyId,
            topologyRunId: input.topologyRunId,
            relationType: "delegates_to",
            edgeKind: "delegation_path",
            from: { entityType: "node", id: fromNodeId },
            to: { entityType: "node", id: toNodeId },
            source: input.source,
            confidence: 0.95,
            firstSeenAt: input.at,
            lastSeenAt: input.at,
            evidence: input.evidence,
        }));
    }
    return edges;
}
function edgesFromPersistedSeeds(options, topologyId) {
    if (options.db === undefined)
        return [];
    return listObservedTopologyEdges({
        db: options.db,
        topologyId,
        ...(options.topologyRunId !== undefined ? { topologyRunId: options.topologyRunId } : {}),
        limit: 5000,
    }).map((edge) => buildObservedEdge({
        edgeId: edge.edgeId,
        topologyId: edge.topologyId,
        topologyRunId: edge.topologyRunId,
        relationType: "delegates_to",
        edgeKind: "delegation_path",
        from: { entityType: "node", id: edge.fromNodeId },
        to: { entityType: "node", id: edge.toNodeId },
        source: "trace_store",
        confidence: edge.confidence,
        firstSeenAt: edge.firstSeenAt,
        lastSeenAt: edge.lastSeenAt,
        evidence: isRecord(edge.evidence) ? edge.evidence : { rawEvidence: String(edge.evidence) },
    }));
}
function edgesFromWorkOrders(options, topologyId) {
    const edges = [];
    const now = options.now ?? Date.now();
    const workOrders = options.workOrders ?? [];
    for (const workOrder of workOrders) {
        const path = workOrder.delegationPath.length >= 2 ? workOrder.delegationPath : [workOrder.fromNodeId, workOrder.to.id];
        edges.push(...edgesFromDelegationPath({
            topologyId,
            topologyRunId: workOrder.topologyRunId,
            path,
            at: timestampToNumber(workOrder.createdAt, now),
            source: "work_order",
            evidence: { workOrderId: workOrder.workOrderId },
        }));
    }
    if (options.db === undefined)
        return edges;
    for (const row of listWorkOrderRows(options.db, { topologyId, ...(options.topologyRunId !== undefined ? { topologyRunId: options.topologyRunId } : {}) })) {
        const path = parseJson(row.delegation_path_json);
        const normalizedPath = Array.isArray(path) && path.every((item) => typeof item === "string")
            ? path
            : [row.from_node_id, row.to_id];
        edges.push(...edgesFromDelegationPath({
            topologyId,
            topologyRunId: row.topology_run_id,
            path: normalizedPath,
            at: row.created_at,
            source: "work_order",
            evidence: { workOrderId: row.work_order_id },
        }));
    }
    return edges;
}
function edgesFromToolCalls(options, topologyId) {
    if (options.db === undefined)
        return [];
    return listToolCallRows(options.db, { topologyId, ...(options.topologyRunId !== undefined ? { topologyRunId: options.topologyRunId } : {}) })
        .map((row) => buildObservedEdge({
        topologyId,
        topologyRunId: row.topology_run_id,
        relationType: "uses_tool",
        edgeKind: "tool_call",
        from: { entityType: "node", id: row.node_id },
        to: { entityType: "enterprise_tool", id: row.tool_id },
        source: "tool_call",
        confidence: row.status === "succeeded" ? 0.98 : 0.85,
        firstSeenAt: row.started_at,
        lastSeenAt: row.completed_at ?? row.started_at,
        evidence: {
            toolCallId: row.tool_call_id,
            nodeRunId: row.node_run_id,
            workOrderId: row.work_order_id,
            dispatcherToolName: row.dispatcher_tool_name,
            status: row.status,
            reasonCode: row.reason_code,
        },
    }));
}
function edgesFromFailures(options, topologyId) {
    const edges = [];
    const now = options.now ?? Date.now();
    const failures = [
        ...(options.failureReports ?? []).map((report) => ({
            topologyRunId: report.topologyRunId,
            failureReportId: report.failureReportId,
            nodeId: report.nodeId,
            report,
            createdAt: timestampToNumber(report.createdAt, now),
        })),
        ...(options.db !== undefined
            ? listFailureRows(options.db, { topologyId, ...(options.topologyRunId !== undefined ? { topologyRunId: options.topologyRunId } : {}) })
                .map((row) => ({
                topologyRunId: row.topology_run_id,
                failureReportId: row.failure_report_id,
                nodeId: row.node_id,
                report: parseJson(row.report_json),
                createdAt: row.created_at,
            }))
            : []),
    ];
    const nodeById = new Map((options.topology?.nodes ?? []).map((node) => [node.id, node]));
    for (const failure of failures) {
        edges.push(buildObservedEdge({
            topologyId,
            topologyRunId: failure.topologyRunId,
            relationType: "runtime_failure",
            edgeKind: "failed_node",
            from: { entityType: "node", id: failure.nodeId },
            to: { entityType: "node", id: failure.nodeId },
            source: "failure_report",
            confidence: 1,
            firstSeenAt: failure.createdAt,
            lastSeenAt: failure.createdAt,
            evidence: {
                failureReportId: failure.failureReportId,
            },
        }));
        const report = isRecord(failure.report) ? failure.report : undefined;
        const attempts = Array.isArray(report?.attempts) ? report.attempts : [];
        const fallbackAttempted = attempts.some((attempt) => {
            return isRecord(attempt) && attempt.kind === "fallback" && attempt.status !== "skipped";
        });
        if (!fallbackAttempted)
            continue;
        for (const fallbackNodeId of nodeById.get(failure.nodeId)?.failurePolicy?.fallbackNodeIds ?? []) {
            edges.push(buildObservedEdge({
                topologyId,
                topologyRunId: failure.topologyRunId,
                relationType: "fallback_route",
                edgeKind: "fallback_route",
                from: { entityType: "node", id: failure.nodeId },
                to: { entityType: "node", id: fallbackNodeId },
                source: "failure_report",
                confidence: 0.8,
                firstSeenAt: failure.createdAt,
                lastSeenAt: failure.createdAt,
                evidence: {
                    failureReportId: failure.failureReportId,
                    reasonCode: "fallback_attempt_recorded",
                },
            }));
        }
    }
    return edges;
}
function ownerRefFromPayload(payload) {
    if (!isRecord(payload))
        return undefined;
    for (const key of ["observedOwnerRef", "observedOwner", "ownerRef"]) {
        const value = payload[key];
        if (isEntityRef(value))
            return value;
    }
    return undefined;
}
function edgesFromTraceOwnerPayloads(options, topologyId) {
    const edges = [];
    const now = options.now ?? Date.now();
    const workOrderById = new Map();
    for (const workOrder of options.workOrders ?? []) {
        workOrderById.set(workOrder.workOrderId, workOrder);
    }
    if (options.db !== undefined) {
        for (const row of listWorkOrderRows(options.db, { topologyId, ...(options.topologyRunId !== undefined ? { topologyRunId: options.topologyRunId } : {}) })) {
            workOrderById.set(row.work_order_id, row);
        }
    }
    const traceItems = [
        ...(options.traceEvents ?? []).map((event) => ({
            traceEventId: event.traceEventId,
            topologyRunId: event.topologyRunId,
            workOrderId: event.workOrderId,
            payload: event.payload,
            at: timestampToNumber(event.at, now),
        })),
        ...(options.db !== undefined
            ? listTraceRows(options.db, { topologyId, ...(options.topologyRunId !== undefined ? { topologyRunId: options.topologyRunId } : {}) })
                .map((row) => ({
                traceEventId: row.trace_event_id,
                topologyRunId: row.topology_run_id,
                workOrderId: row.work_order_id,
                payload: parseJson(row.payload_json) ?? parseJson(row.event_json)?.payload,
                at: row.at,
            }))
            : []),
    ];
    for (const item of traceItems) {
        const owner = ownerRefFromPayload(item.payload);
        if (owner === undefined)
            continue;
        const targetNodeId = workOrderTargetNodeId(workOrderById.get(item.workOrderId));
        if (targetNodeId === undefined)
            continue;
        edges.push(buildObservedEdge({
            topologyId,
            topologyRunId: item.topologyRunId,
            relationType: "owns",
            edgeKind: "observed_owner",
            from: owner,
            to: { entityType: "node", id: targetNodeId },
            source: "trace_event",
            confidence: 0.75,
            firstSeenAt: item.at,
            lastSeenAt: item.at,
            evidence: {
                traceEventId: item.traceEventId,
                workOrderId: item.workOrderId,
                reasonCode: "observed_owner_payload",
            },
        }));
    }
    return edges;
}
export function extractObservedTopologyEdges(options = {}) {
    const topologyId = topologyIdFromOptions(options);
    const db = options.db ?? (options.topologyId !== undefined && options.edges === undefined ? getDb() : undefined);
    const normalizedOptions = db !== undefined ? { ...options, db } : options;
    return dedupeEdges([
        ...(options.edges ?? []),
        ...edgesFromPersistedSeeds(normalizedOptions, topologyId),
        ...edgesFromWorkOrders(normalizedOptions, topologyId),
        ...edgesFromToolCalls(normalizedOptions, topologyId),
        ...edgesFromFailures(normalizedOptions, topologyId),
        ...edgesFromTraceOwnerPayloads(normalizedOptions, topologyId),
    ]);
}
//# sourceMappingURL=observed.js.map