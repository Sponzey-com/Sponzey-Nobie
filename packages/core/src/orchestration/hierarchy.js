import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS, getConfig } from "../config/index.js";
import { validateAgentRelationship, } from "../contracts/sub-agent-orchestration.js";
import { getAgentRelationship, listAgentRelationships, upsertAgentRelationship, } from "../db/index.js";
import { createAgentRegistryService } from "./registry.js";
const DEFAULT_ROOT_AGENT_ID = "agent:nobie";
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_CHILD_COUNT = 10;
const LAYOUT_SCHEMA_VERSION = 1;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function asFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function asStatus(value) {
    return value === "active" || value === "disabled" || value === "archived" ? value : undefined;
}
function defaultEdgeId(parentAgentId, childAgentId) {
    return `relationship:${parentAgentId}->${childAgentId}`;
}
function nodeIdForAgent(agentId) {
    return `agent:${agentId}`;
}
function relationshipFromRow(row) {
    return {
        edgeId: row.edge_id,
        parentAgentId: row.parent_agent_id,
        childAgentId: row.child_agent_id,
        relationshipType: row.relationship_type,
        status: row.status,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function normalizeRelationshipInput(input, now, nextSortOrder) {
    const value = isRecord(input) ? input : {};
    const parentAgentId = asString(value.parentAgentId) ?? "";
    const childAgentId = asString(value.childAgentId) ?? "";
    const sortOrder = "sortOrder" in value ? value.sortOrder : nextSortOrder;
    return {
        edgeId: asString(value.edgeId) ??
            (parentAgentId && childAgentId ? defaultEdgeId(parentAgentId, childAgentId) : ""),
        parentAgentId,
        childAgentId,
        relationshipType: "relationshipType" in value ? value.relationshipType : "parent_child",
        status: asStatus(value.status) ??
            ("status" in value ? value.status : "active"),
        sortOrder: typeof sortOrder === "number" ? sortOrder : sortOrder,
        createdAt: asFiniteNumber(value.createdAt) ?? now,
        updatedAt: asFiniteNumber(value.updatedAt) ?? now,
    };
}
function contractIssueDiagnostic(issue, relationship) {
    let reasonCode = "invalid_relationship_contract";
    if (issue.path === "$.childAgentId" && issue.message.includes("different")) {
        reasonCode = "self_parent_blocked";
    }
    else if (issue.path === "$.status") {
        reasonCode = "invalid_relationship_status";
    }
    return {
        reasonCode,
        severity: "blocked",
        message: issue.message,
        path: issue.path,
        ...(relationship?.edgeId ? { edgeId: relationship.edgeId } : {}),
        ...(relationship?.parentAgentId ? { parentAgentId: relationship.parentAgentId } : {}),
        ...(relationship?.childAgentId ? { childAgentId: relationship.childAgentId } : {}),
    };
}
function relationshipSort(left, right) {
    return (left.parentAgentId.localeCompare(right.parentAgentId) ||
        left.sortOrder - right.sortOrder ||
        left.edgeId.localeCompare(right.edgeId));
}
function agentFromConfig(config, source) {
    return {
        agentId: config.agentId,
        agentType: config.agentType,
        displayName: config.displayName,
        ...(config.nickname ? { nickname: config.nickname } : {}),
        status: config.status,
        source,
    };
}
function agentMetadata(input) {
    return {
        agentType: input.agent.agentType,
        source: input.agent.source,
        root: input.agent.agentId === input.rootAgentId,
        topLevel: input.topLevel,
        depth: input.depth,
        executionCandidate: input.executionCandidate,
        ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
    };
}
function layoutPath(dependencies) {
    return dependencies.layoutPath ?? join(PATHS.stateDir, "agent-tree-layout.json");
}
function defaultLayoutPreference() {
    return {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        layout: "tree",
        nodes: {},
        updatedAt: null,
    };
}
function normalizeLayoutPreference(value, updatedAt) {
    const input = isRecord(value) ? value : {};
    const nodesInput = isRecord(input.nodes) ? input.nodes : {};
    const nodes = {};
    for (const [nodeId, rawNode] of Object.entries(nodesInput)) {
        if (!isRecord(rawNode))
            continue;
        const x = asFiniteNumber(rawNode.x);
        const y = asFiniteNumber(rawNode.y);
        if (x === undefined || y === undefined)
            continue;
        nodes[nodeId] = {
            x,
            y,
            ...(typeof rawNode.collapsed === "boolean" ? { collapsed: rawNode.collapsed } : {}),
        };
    }
    const viewportInput = isRecord(input.viewport) ? input.viewport : undefined;
    const viewportX = viewportInput ? asFiniteNumber(viewportInput.x) : undefined;
    const viewportY = viewportInput ? asFiniteNumber(viewportInput.y) : undefined;
    const viewportZoom = viewportInput ? asFiniteNumber(viewportInput.zoom) : undefined;
    return {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        layout: asString(input.layout) ?? "tree",
        nodes,
        ...(viewportX !== undefined && viewportY !== undefined && viewportZoom !== undefined
            ? { viewport: { x: viewportX, y: viewportY, zoom: viewportZoom } }
            : {}),
        updatedAt,
    };
}
function activeRelationships() {
    return listAgentRelationships({ status: "active" })
        .map(relationshipFromRow)
        .sort(relationshipSort);
}
function parentByChild(relationships) {
    const result = new Map();
    for (const relationship of relationships) {
        if (relationship.status === "active")
            result.set(relationship.childAgentId, relationship);
    }
    return result;
}
function childrenByParent(relationships) {
    const result = new Map();
    for (const relationship of relationships) {
        if (relationship.status !== "active")
            continue;
        const children = result.get(relationship.parentAgentId) ?? [];
        children.push(relationship);
        result.set(relationship.parentAgentId, children);
    }
    for (const children of result.values())
        children.sort(relationshipSort);
    return result;
}
function descendantAgentIds(agentId, relationships) {
    const byParent = childrenByParent(relationships);
    const descendants = [];
    const visited = new Set();
    const stack = [...(byParent.get(agentId) ?? [])].reverse();
    while (stack.length > 0) {
        const relationship = stack.pop();
        if (!relationship || visited.has(relationship.childAgentId))
            continue;
        visited.add(relationship.childAgentId);
        descendants.push(relationship.childAgentId);
        stack.push(...[...(byParent.get(relationship.childAgentId) ?? [])].reverse());
    }
    return descendants;
}
function hasPath(fromAgentId, toAgentId, relationships) {
    return descendantAgentIds(fromAgentId, relationships).includes(toAgentId);
}
function depthOf(agentId, rootAgentId, byChild) {
    if (agentId === rootAgentId)
        return 0;
    let depth = 1;
    let cursor = agentId;
    const seen = new Set([agentId]);
    while (true) {
        const relationship = byChild.get(cursor);
        if (!relationship)
            return depth;
        if (relationship.parentAgentId === rootAgentId)
            return depth;
        if (seen.has(relationship.parentAgentId))
            return Number.POSITIVE_INFINITY;
        seen.add(relationship.parentAgentId);
        cursor = relationship.parentAgentId;
        depth += 1;
    }
}
function inactiveReasonFor(agentId, rootAgentId, agents, relationships) {
    const agent = agents.get(agentId);
    if (!agent)
        return "missing_agent";
    if (agent.status !== "enabled")
        return `agent_${agent.status}`;
    const byChild = parentByChild(relationships);
    let cursor = agentId;
    const seen = new Set();
    while (cursor !== rootAgentId) {
        if (seen.has(cursor))
            return "cycle_detected";
        seen.add(cursor);
        const relationship = byChild.get(cursor);
        if (!relationship)
            return undefined;
        const parent = agents.get(relationship.parentAgentId);
        if (!parent)
            return "missing_ancestor";
        if (parent.agentId !== rootAgentId && parent.status !== "enabled")
            return `ancestor_${parent.status}`;
        cursor = parent.agentId;
    }
    return undefined;
}
function configFromDependencies(dependencies) {
    return dependencies.getConfig?.() ?? getConfig();
}
export function createAgentHierarchyService(dependencies = {}) {
    const now = () => dependencies.now?.() ?? Date.now();
    const config = () => configFromDependencies(dependencies);
    const rootAgentId = () => dependencies.rootAgentId ?? config().orchestration.nobie?.agentId ?? DEFAULT_ROOT_AGENT_ID;
    const maxDepth = () => dependencies.maxDepth ?? config().orchestration.maxDelegationTurns ?? DEFAULT_MAX_DEPTH;
    const maxChildCount = () => dependencies.maxChildCount ?? DEFAULT_MAX_CHILD_COUNT;
    const registry = () => createAgentRegistryService(dependencies);
    function agentSummaries() {
        const result = new Map();
        const snapshot = registry().snapshot();
        for (const entry of snapshot.agents)
            result.set(entry.agentId, agentFromConfig(entry.config, entry.source));
        for (const agent of registry().list())
            result.set(agent.agentId, agentFromConfig(agent, "db"));
        const root = config().orchestration.nobie;
        const resolvedRootAgentId = rootAgentId();
        if (root)
            result.set(root.agentId, agentFromConfig(root, "config"));
        if (!result.has(resolvedRootAgentId)) {
            result.set(resolvedRootAgentId, {
                agentId: resolvedRootAgentId,
                agentType: "nobie",
                displayName: "Nobie",
                nickname: "Nobie",
                status: "enabled",
                source: "synthetic",
            });
        }
        return result;
    }
    function relationshipWithDefaults(input) {
        const parentAgentId = isRecord(input) ? asString(input.parentAgentId) : undefined;
        const nextSortOrder = parentAgentId
            ? activeRelationships().filter((relationship) => relationship.parentAgentId === parentAgentId)
                .length
            : 0;
        return normalizeRelationshipInput(input, now(), nextSortOrder);
    }
    function validateRelationship(input) {
        const relationship = relationshipWithDefaults(input);
        const validation = validateAgentRelationship(relationship);
        const diagnostics = validation.ok
            ? []
            : validation.issues.map((issue) => contractIssueDiagnostic(issue, relationship));
        if (!validation.ok)
            return { ok: false, relationship, diagnostics };
        const resolvedRootAgentId = rootAgentId();
        const agents = agentSummaries();
        if (relationship.childAgentId === resolvedRootAgentId) {
            diagnostics.push({
                reasonCode: "nobie_parent_forbidden",
                severity: "blocked",
                message: "Nobie must remain the parentless root and cannot be a child.",
                edgeId: relationship.edgeId,
                parentAgentId: relationship.parentAgentId,
                childAgentId: relationship.childAgentId,
            });
        }
        if (!agents.has(relationship.parentAgentId)) {
            diagnostics.push({
                reasonCode: "unknown_parent_agent",
                severity: "blocked",
                message: `Parent agent ${relationship.parentAgentId} is not defined.`,
                edgeId: relationship.edgeId,
                parentAgentId: relationship.parentAgentId,
                childAgentId: relationship.childAgentId,
            });
        }
        if (!agents.has(relationship.childAgentId)) {
            diagnostics.push({
                reasonCode: "unknown_child_agent",
                severity: "blocked",
                message: `Child agent ${relationship.childAgentId} is not defined.`,
                edgeId: relationship.edgeId,
                parentAgentId: relationship.parentAgentId,
                childAgentId: relationship.childAgentId,
            });
        }
        if (relationship.status === "active") {
            const active = activeRelationships().filter((candidate) => candidate.edgeId !== relationship.edgeId);
            const duplicateRelationship = active.find((candidate) => candidate.parentAgentId === relationship.parentAgentId &&
                candidate.childAgentId === relationship.childAgentId);
            if (duplicateRelationship) {
                diagnostics.push({
                    reasonCode: "duplicate_relationship_blocked",
                    severity: "blocked",
                    message: `${relationship.parentAgentId} already has ${relationship.childAgentId} as a direct child.`,
                    edgeId: relationship.edgeId,
                    parentAgentId: relationship.parentAgentId,
                    childAgentId: relationship.childAgentId,
                });
            }
            const existingParent = active.find((candidate) => candidate.childAgentId === relationship.childAgentId);
            if (existingParent && existingParent.parentAgentId !== relationship.parentAgentId) {
                diagnostics.push({
                    reasonCode: "child_multi_parent_blocked",
                    severity: "blocked",
                    message: `${relationship.childAgentId} already has parent ${existingParent.parentAgentId}.`,
                    edgeId: relationship.edgeId,
                    parentAgentId: relationship.parentAgentId,
                    childAgentId: relationship.childAgentId,
                });
            }
            const nextChildCount = new Set(active
                .filter((candidate) => candidate.parentAgentId === relationship.parentAgentId)
                .map((candidate) => candidate.childAgentId));
            nextChildCount.add(relationship.childAgentId);
            if (nextChildCount.size > maxChildCount()) {
                diagnostics.push({
                    reasonCode: "max_child_count_exceeded",
                    severity: "blocked",
                    message: `${relationship.parentAgentId} would have ${nextChildCount.size} direct children.`,
                    edgeId: relationship.edgeId,
                    parentAgentId: relationship.parentAgentId,
                    childAgentId: relationship.childAgentId,
                    limit: maxChildCount(),
                    value: nextChildCount.size,
                });
            }
            if (hasPath(relationship.childAgentId, relationship.parentAgentId, active)) {
                diagnostics.push({
                    reasonCode: "cycle_detected",
                    severity: "blocked",
                    message: "Adding this relationship would create a cycle.",
                    edgeId: relationship.edgeId,
                    parentAgentId: relationship.parentAgentId,
                    childAgentId: relationship.childAgentId,
                });
            }
            const future = [...active, relationship].sort(relationshipSort);
            const byChild = parentByChild(future);
            const affectedAgentIds = [
                relationship.childAgentId,
                ...descendantAgentIds(relationship.childAgentId, future),
            ];
            for (const agentId of affectedAgentIds) {
                const depth = depthOf(agentId, resolvedRootAgentId, byChild);
                if (depth > maxDepth()) {
                    diagnostics.push({
                        reasonCode: "max_depth_exceeded",
                        severity: "blocked",
                        message: `${agentId} would be at hierarchy depth ${depth}.`,
                        edgeId: relationship.edgeId,
                        parentAgentId: relationship.parentAgentId,
                        childAgentId: relationship.childAgentId,
                        limit: maxDepth(),
                        value: depth,
                    });
                    break;
                }
            }
        }
        return {
            ok: diagnostics.every((diagnostic) => diagnostic.severity !== "blocked"),
            relationship,
            diagnostics,
        };
    }
    function createRelationship(input, options = {}) {
        const result = validateRelationship(input);
        if (!result.ok || !result.relationship)
            return result;
        upsertAgentRelationship(result.relationship, { auditId: options.auditId ?? null, now: now() });
        const stored = getAgentRelationship(result.relationship.edgeId);
        return {
            ok: true,
            relationship: stored ? relationshipFromRow(stored) : result.relationship,
            diagnostics: result.diagnostics,
        };
    }
    function disableRelationship(edgeId, options = {}) {
        const row = getAgentRelationship(edgeId);
        if (!row)
            return undefined;
        const relationship = {
            ...relationshipFromRow(row),
            status: "disabled",
            updatedAt: now(),
        };
        upsertAgentRelationship(relationship, {
            auditId: options.auditId ?? row.audit_id ?? null,
            now: relationship.updatedAt,
        });
        const stored = getAgentRelationship(edgeId);
        return stored ? relationshipFromRow(stored) : relationship;
    }
    function relationships() {
        return listAgentRelationships().map(relationshipFromRow).sort(relationshipSort);
    }
    function directChildren(parentAgentId) {
        const agents = agentSummaries();
        const active = activeRelationships();
        return active
            .filter((relationship) => relationship.parentAgentId === parentAgentId)
            .sort(relationshipSort)
            .map((relationship) => {
            const blockedReason = inactiveReasonFor(relationship.childAgentId, rootAgentId(), agents, active);
            const agent = agents.get(relationship.childAgentId);
            return {
                relationship,
                ...(agent ? { agent } : {}),
                isExecutionCandidate: blockedReason === undefined,
                ...(blockedReason ? { blockedReason } : {}),
            };
        });
    }
    function ancestors(agentId) {
        const agents = agentSummaries();
        const byChild = parentByChild(activeRelationships());
        const result = [];
        let cursor = agentId;
        const seen = new Set();
        while (true) {
            if (seen.has(cursor))
                break;
            seen.add(cursor);
            const relationship = byChild.get(cursor);
            if (!relationship)
                break;
            const parent = agents.get(relationship.parentAgentId);
            if (parent)
                result.push(parent);
            cursor = relationship.parentAgentId;
        }
        return result;
    }
    function descendants(agentId) {
        const agents = agentSummaries();
        return descendantAgentIds(agentId, activeRelationships())
            .map((descendantId) => agents.get(descendantId))
            .filter((agent) => agent != null);
    }
    function topLevelSubAgents() {
        const agents = agentSummaries();
        const active = activeRelationships();
        const diagnostics = [];
        if (active.length === 0) {
            diagnostics.push({
                reasonCode: "hierarchy_fallback_enabled_sub_agents",
                severity: "info",
                message: "No hierarchy rows exist; enabled sub-agents are projected as Nobie top-level candidates.",
                parentAgentId: rootAgentId(),
            });
            return {
                agents: [...agents.values()]
                    .filter((agent) => agent.agentType === "sub_agent" && agent.status === "enabled")
                    .sort((left, right) => left.agentId.localeCompare(right.agentId)),
                fallbackActive: true,
                diagnostics,
            };
        }
        return {
            agents: active
                .filter((relationship) => relationship.parentAgentId === rootAgentId())
                .map((relationship) => agents.get(relationship.childAgentId))
                .filter((agent) => agent?.agentType === "sub_agent")
                .sort((left, right) => left.agentId.localeCompare(right.agentId)),
            fallbackActive: false,
            diagnostics,
        };
    }
    function buildProjection() {
        const generatedAt = now();
        const resolvedRootAgentId = rootAgentId();
        const agents = agentSummaries();
        const active = activeRelationships();
        const byChild = parentByChild(active);
        const topLevel = topLevelSubAgents();
        const topLevelIds = new Set(topLevel.agents.map((agent) => agent.agentId));
        const projectionEdges = active.length > 0
            ? active.map((relationship) => ({
                edgeId: relationship.edgeId,
                edgeType: "parent_child",
                fromNodeId: nodeIdForAgent(relationship.parentAgentId),
                toNodeId: nodeIdForAgent(relationship.childAgentId),
                label: "parent child",
                metadata: {
                    source: "hierarchy",
                    status: relationship.status,
                    sortOrder: relationship.sortOrder,
                },
            }))
            : topLevel.agents.map((agent, index) => ({
                edgeId: `fallback:${resolvedRootAgentId}->${agent.agentId}`,
                edgeType: "parent_child",
                fromNodeId: nodeIdForAgent(resolvedRootAgentId),
                toNodeId: nodeIdForAgent(agent.agentId),
                label: "fallback top-level",
                metadata: {
                    source: "fallback",
                    status: "active",
                    sortOrder: index,
                },
            }));
        const projectionAgentIds = new Set([resolvedRootAgentId]);
        for (const agent of agents.values())
            projectionAgentIds.add(agent.agentId);
        for (const relationship of active) {
            projectionAgentIds.add(relationship.parentAgentId);
            projectionAgentIds.add(relationship.childAgentId);
        }
        const nodes = [...projectionAgentIds]
            .map((agentId) => agents.get(agentId) ?? {
            agentId,
            agentType: "sub_agent",
            displayName: agentId,
            status: "disabled",
            source: "synthetic",
        })
            .sort((left, right) => {
            if (left.agentId === resolvedRootAgentId)
                return -1;
            if (right.agentId === resolvedRootAgentId)
                return 1;
            return left.agentId.localeCompare(right.agentId);
        })
            .map((agent) => {
            const blockedReason = inactiveReasonFor(agent.agentId, resolvedRootAgentId, agents, active);
            return {
                nodeId: nodeIdForAgent(agent.agentId),
                entityType: agent.agentType,
                entityId: agent.agentId,
                label: agent.nickname ?? agent.displayName,
                status: agent.status,
                metadata: agentMetadata({
                    agent,
                    rootAgentId: resolvedRootAgentId,
                    topLevel: topLevelIds.has(agent.agentId),
                    depth: active.length > 0 ? depthOf(agent.agentId, resolvedRootAgentId, byChild) : null,
                    executionCandidate: blockedReason === undefined,
                    ...(blockedReason ? { blockedReason } : {}),
                }),
            };
        });
        return {
            rootAgentId: resolvedRootAgentId,
            generatedAt,
            nodes,
            edges: projectionEdges,
            topLevelSubAgents: topLevel.agents,
            topLevelFallbackActive: topLevel.fallbackActive,
            executionCandidateAgentIds: nodes
                .filter((node) => node.entityType === "sub_agent" && node.metadata?.executionCandidate === true)
                .map((node) => node.entityId),
            diagnostics: topLevel.diagnostics,
        };
    }
    function readLayout() {
        try {
            const parsed = JSON.parse(readFileSync(layoutPath(dependencies), "utf-8"));
            if (!isRecord(parsed))
                return defaultLayoutPreference();
            const updatedAt = asFiniteNumber(parsed.updatedAt);
            return normalizeLayoutPreference(parsed, updatedAt ?? now());
        }
        catch {
            return defaultLayoutPreference();
        }
    }
    function writeLayout(input) {
        const preference = normalizeLayoutPreference(input, now());
        const target = layoutPath(dependencies);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, `${JSON.stringify(preference, null, 2)}\n`, "utf-8");
        return preference;
    }
    return {
        rootAgentId: rootAgentId(),
        maxDepth: maxDepth(),
        maxChildCount: maxChildCount(),
        list: relationships,
        get(edgeId) {
            const row = getAgentRelationship(edgeId);
            return row ? relationshipFromRow(row) : undefined;
        },
        validate: validateRelationship,
        create: createRelationship,
        disable: disableRelationship,
        directChildren,
        ancestors,
        descendants,
        topLevelSubAgents,
        buildProjection,
        readLayout,
        writeLayout,
    };
}
//# sourceMappingURL=hierarchy.js.map