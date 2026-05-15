import { createHash } from "node:crypto";
import { validateTopology, } from "./validator.js";
export const TOPOLOGY_COMPILER_VERSION = "enterprise-topology-compiler.v1";
export function compileTopology(topology, options = {}) {
    const validation = validateTopology(topology, options.validationOptions);
    if (!validation.executable) {
        return {
            ok: false,
            validation,
            issues: validation.issues.filter((issue) => issue.severity === "blocked" || issue.severity === "invalid"),
        };
    }
    const sourceTopologyVersion = normalizeSourceTopologyVersion(topology, options.sourceTopologyVersion);
    const sourceTopologyHash = computeTopologySourceHash(topology);
    const compiledTopologySnapshotId = options.compiledTopologySnapshotId ?? buildCompiledTopologySnapshotId(topology.id, sourceTopologyVersion, sourceTopologyHash);
    const graph = buildDelegationGraph(topology);
    const parentChildTree = buildCompiledDelegationTree(topology, graph);
    const delegationScopeMap = buildDelegationScopeMap(topology, parentChildTree);
    const snapshot = {
        schemaVersion: topology.schemaVersion,
        compilerVersion: TOPOLOGY_COMPILER_VERSION,
        compiledTopologySnapshotId,
        topologyId: topology.id,
        sourceTopologyVersion,
        sourceTopologyHash,
        compiledAt: options.compiledAt ?? Date.now(),
        validation: {
            issueCount: validation.issues.length,
            warningCount: validation.issueCounts.warning,
            infoCount: validation.issueCounts.info,
        },
        nodeIndex: buildNodeIndex(topology, parentChildTree),
        teamIndex: Object.fromEntries(topology.teams.map((team) => [team.id, {
                id: team.id,
                name: team.name,
                nodeIds: [...team.nodeIds],
                tags: [...team.tags],
            }])),
        orgUnitIndex: Object.fromEntries(topology.orgUnits.map((orgUnit) => [orgUnit.id, {
                id: orgUnit.id,
                name: orgUnit.name,
                ...(orgUnit.parentOrgUnitId !== undefined ? { parentOrgUnitId: orgUnit.parentOrgUnitId } : {}),
                positionIds: [...orgUnit.positionIds],
                personIds: [...orgUnit.personIds],
            }])),
        positionIndex: Object.fromEntries(topology.positions.map((position) => [position.id, {
                id: position.id,
                name: position.name,
                orgUnitId: position.orgUnitId,
                ...(position.reportsToPositionId !== undefined ? { reportsToPositionId: position.reportsToPositionId } : {}),
                personIds: [...position.personIds],
                ...(position.approvalLimit !== undefined ? { approvalLimit: position.approvalLimit } : {}),
            }])),
        personIndex: Object.fromEntries(topology.persons.map((person) => [person.id, {
                id: person.id,
                name: person.name,
                positionIds: [...person.positionIds],
                orgUnitIds: [...person.orgUnitIds],
                ...(person.availability !== undefined ? { availability: person.availability } : {}),
            }])),
        toolIndex: Object.fromEntries(topology.tools.map((tool) => [tool.id, {
                id: tool.id,
                name: tool.name,
                toolType: tool.toolType,
                ...(tool.systemId !== undefined ? { systemId: tool.systemId } : {}),
            }])),
        systemIndex: Object.fromEntries(topology.systems.map((system) => [system.id, {
                id: system.id,
                name: system.name,
                systemType: system.systemType,
                dataDomainIds: [...system.dataDomainIds],
                criticality: system.criticality,
            }])),
        processIndex: Object.fromEntries(topology.processes.map((process) => [process.id, {
                id: process.id,
                name: process.name,
                ...(process.ownerNodeId !== undefined ? { ownerNodeId: process.ownerNodeId } : {}),
                stepNodeIds: [...process.stepNodeIds],
                ...(process.accountablePositionId !== undefined ? { accountablePositionId: process.accountablePositionId } : {}),
                ...(process.slaMs !== undefined ? { slaMs: process.slaMs } : {}),
            }])),
        authorityIndex: Object.fromEntries(topology.authorityRules.map((rule) => [rule.id, {
                id: rule.id,
                name: rule.name,
                subject: cloneRef(rule.subject),
                action: rule.action,
                object: cloneRef(rule.object),
                ...(rule.condition !== undefined ? { condition: structuredClone(rule.condition) } : {}),
                delegable: rule.delegable,
                requiresAuditLog: rule.requiresAuditLog,
            }])),
        parentChildTree,
        delegationScopeMap,
        authorityScopeIndex: buildAuthorityScopeIndex(topology),
        toolScopeIndex: buildToolScopeIndex(topology),
        processFlowIndex: buildProcessFlowIndex(topology),
        responsibilityIndex: buildResponsibilityIndex(topology),
        runtimeExecutionContext: {
            topologyId: topology.id,
            entryNodeId: null,
            rootChildNodeIds: [...parentChildTree.rootChildNodeIds],
            exitNodeIds: [...parentChildTree.exitNodeIds],
            nodeCount: topology.nodes.length,
            delegationEdgeCount: Object.values(parentChildTree.edges).reduce((count, children) => count + children.length, 0),
        },
    };
    return { ok: true, snapshot, validation };
}
export function compileTopologyOrThrow(topology, options = {}) {
    const result = compileTopology(topology, options);
    if (result.ok)
        return result.snapshot;
    throw new TopologyCompileError(result.issues, result.validation);
}
export class TopologyCompileError extends Error {
    issues;
    validation;
    constructor(issues, validation) {
        super("Topology compiler rejected a blocked or invalid topology.");
        this.name = "TopologyCompileError";
        this.issues = issues;
        this.validation = validation;
    }
}
export function getCompiledEntryNode(snapshot) {
    const entryNodeId = snapshot.runtimeExecutionContext.entryNodeId;
    return entryNodeId === null ? undefined : snapshot.nodeIndex[entryNodeId];
}
export function getCompiledChildCandidates(snapshot, nodeId) {
    return (snapshot.parentChildTree.edges[nodeId] ?? [])
        .map((childNodeId) => snapshot.nodeIndex[childNodeId])
        .filter((node) => node !== undefined);
}
export function buildCompiledEntityRefKey(reference) {
    return `${reference.entityType}|${reference.id}`;
}
export function normalizeSourceTopologyVersion(topology, sourceTopologyVersion) {
    return String(sourceTopologyVersion ?? topology.updatedAt);
}
export function computeTopologySourceHash(topology) {
    return createHash("sha256").update(stableStringify(topology)).digest("hex");
}
export function buildCompiledTopologySnapshotId(topologyId, sourceTopologyVersion, sourceTopologyHash) {
    return `compiled:${hashText(`${TOPOLOGY_COMPILER_VERSION}|${topologyId}|${sourceTopologyVersion}|${sourceTopologyHash}`).slice(0, 16)}`;
}
function buildNodeIndex(topology, tree) {
    return Object.fromEntries(topology.nodes.map((node) => [node.id, {
            id: node.id,
            name: node.name,
            ...(node.displayName !== undefined ? { displayName: node.displayName } : {}),
            nodeType: node.nodeType,
            ...(node.owner !== undefined ? { owner: cloneRef(node.owner) } : {}),
            parentNodeIds: [...(tree.parents[node.id] ?? [])],
            childNodeIds: [...(tree.edges[node.id] ?? [])],
            allowedToolIds: [...node.allowedToolIds],
            allowedSystemIds: [...node.allowedSystemIds],
            ...(node.failurePolicy !== undefined ? { failurePolicy: structuredClone(node.failurePolicy) } : {}),
            ...(node.recoveryPolicy !== undefined ? { recoveryPolicy: structuredClone(node.recoveryPolicy) } : {}),
            tags: [...node.tags],
        }]));
}
function buildDelegationGraph(topology) {
    const edges = Object.fromEntries(topology.nodes.map((node) => [node.id, []]));
    const parents = Object.fromEntries(topology.nodes.map((node) => [node.id, []]));
    const relationIdsByPair = new Map();
    const delegationRelations = topology.relations.filter((relation) => (relation.relationType === "delegates_to" &&
        relation.from.entityType === "node" &&
        relation.to.entityType === "node"));
    if (delegationRelations.length === 0) {
        topology.nodes.forEach((node) => {
            node.children.forEach((childNodeId) => addDelegationEdge(edges, parents, relationIdsByPair, node.id, childNodeId));
        });
    }
    delegationRelations.forEach((relation) => {
        addDelegationEdge(edges, parents, relationIdsByPair, relation.from.id, relation.to.id, relation.id);
    });
    return { edges, parents, relationIdsByPair };
}
function buildCompiledDelegationTree(topology, graph) {
    const nodeIds = topology.nodes.map((node) => node.id);
    const childIds = new Set(Object.values(graph.edges).flat());
    const rootNodeIds = nodeIds.filter((nodeId) => !childIds.has(nodeId));
    const exitNodeIds = nodeIds.filter((nodeId) => (graph.edges[nodeId] ?? []).length === 0);
    const incomingEdgeCountByNodeId = Object.fromEntries(nodeIds.map((nodeId) => [nodeId, graph.parents[nodeId]?.length ?? 0]));
    return {
        rootNodeIds,
        rootChildNodeIds: [...rootNodeIds],
        entryNodeId: null,
        exitNodeIds,
        edges: graph.edges,
        parents: graph.parents,
        incomingEdgeCountByNodeId,
    };
}
function addDelegationEdge(edges, parents, relationIdsByPair, parentNodeId, childNodeId, relationId) {
    edges[parentNodeId] = addUnique(edges[parentNodeId] ?? [], childNodeId);
    parents[childNodeId] = addUnique(parents[childNodeId] ?? [], parentNodeId);
    if (relationId !== undefined) {
        const pairKey = `${parentNodeId}->${childNodeId}`;
        relationIdsByPair.set(pairKey, addUnique(relationIdsByPair.get(pairKey) ?? [], relationId));
    }
}
function buildDelegationScopeMap(topology, tree) {
    return Object.fromEntries(topology.nodes.map((node) => {
        const directChildNodeIds = tree.edges[node.id] ?? [];
        const { descendantNodeIds, maxDepth } = collectDescendants(node.id, tree.edges);
        return [node.id, {
                nodeId: node.id,
                directChildNodeIds: [...directChildNodeIds],
                descendantNodeIds,
                maxDepth,
            }];
    }));
}
function collectDescendants(nodeId, edges) {
    const descendants = [];
    const visited = new Set();
    let maxDepth = 0;
    const queue = (edges[nodeId] ?? []).map((childNodeId) => ({ nodeId: childNodeId, depth: 1 }));
    for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        if (item === undefined || visited.has(item.nodeId))
            continue;
        visited.add(item.nodeId);
        descendants.push(item.nodeId);
        maxDepth = Math.max(maxDepth, item.depth);
        queue.push(...(edges[item.nodeId] ?? []).map((childNodeId) => ({ nodeId: childNodeId, depth: item.depth + 1 })));
    }
    return { descendantNodeIds: descendants, maxDepth };
}
function buildAuthorityScopeIndex(topology) {
    const index = {};
    topology.relations.forEach((relation) => {
        if (relation.relationType !== "approves")
            return;
        const targetKey = buildCompiledEntityRefKey(relation.to);
        const scope = ensureAuthorityScope(index, relation.to);
        scope.approvalRelationIds = addUnique(scope.approvalRelationIds, relation.id);
        scope.approverRefs = addUniqueRefs(scope.approverRefs, [relation.from]);
        index[targetKey] = scope;
    });
    topology.authorityRules.forEach((rule) => {
        const targetKey = buildCompiledEntityRefKey(rule.object);
        const scope = ensureAuthorityScope(index, rule.object);
        scope.authorityRuleIds = addUnique(scope.authorityRuleIds, rule.id);
        scope.approverRefs = addUniqueRefs(scope.approverRefs, [rule.subject]);
        index[targetKey] = scope;
    });
    return index;
}
function ensureAuthorityScope(index, target) {
    const key = buildCompiledEntityRefKey(target);
    return index[key] ?? {
        target: cloneRef(target),
        authorityRuleIds: [],
        approvalRelationIds: [],
        approverRefs: [],
    };
}
function buildToolScopeIndex(topology) {
    const builders = Object.fromEntries(topology.nodes.map((node) => [node.id, {
            declaredToolIds: new Set(),
            declaredSystemIds: new Set(),
            backingSystemIds: new Set(),
            toolRelationIds: new Set(),
            systemRelationIds: new Set(),
        }]));
    const toolById = new Map(topology.tools.map((tool) => [tool.id, tool]));
    const systemById = new Map(topology.systems.map((system) => [system.id, system]));
    topology.relations.forEach((relation) => {
        if (relation.from.entityType !== "node")
            return;
        const builder = builders[relation.from.id];
        if (builder === undefined)
            return;
        if (relation.relationType === "uses_tool" && relation.to.entityType === "enterprise_tool") {
            builder.declaredToolIds.add(relation.to.id);
            builder.toolRelationIds.add(relation.id);
            const tool = toolById.get(relation.to.id);
            if (tool?.systemId !== undefined)
                builder.backingSystemIds.add(tool.systemId);
        }
        if (relation.relationType === "uses_system" && relation.to.entityType === "enterprise_system") {
            builder.declaredSystemIds.add(relation.to.id);
            builder.systemRelationIds.add(relation.id);
        }
        if (relation.relationType === "has_access_to" && relation.to.entityType === "enterprise_tool") {
            builder.declaredToolIds.add(relation.to.id);
            builder.toolRelationIds.add(relation.id);
        }
        if (relation.relationType === "has_access_to" && relation.to.entityType === "enterprise_system") {
            builder.declaredSystemIds.add(relation.to.id);
            builder.systemRelationIds.add(relation.id);
        }
    });
    return Object.fromEntries(topology.nodes.map((node) => {
        const builder = builders[node.id];
        const declaredToolIds = [...(builder?.declaredToolIds ?? [])];
        const declaredSystemIds = [...(builder?.declaredSystemIds ?? [])];
        const backingSystemIds = [...(builder?.backingSystemIds ?? [])];
        const allDeclaredSystemIds = addUnique([...declaredSystemIds], ...backingSystemIds);
        const effectiveSystemIds = node.allowedSystemIds.filter((systemId) => allDeclaredSystemIds.includes(systemId));
        const declaredDataDomainIds = dataDomainIdsForSystems(systemById, allDeclaredSystemIds);
        const effectiveDataDomainIds = dataDomainIdsForSystems(systemById, effectiveSystemIds);
        return [node.id, {
                nodeId: node.id,
                allowedToolIds: [...node.allowedToolIds],
                declaredToolIds,
                effectiveToolIds: node.allowedToolIds.filter((toolId) => declaredToolIds.includes(toolId)),
                allowedSystemIds: [...node.allowedSystemIds],
                declaredSystemIds,
                backingSystemIds,
                effectiveSystemIds,
                declaredDataDomainIds,
                effectiveDataDomainIds,
                toolRelationIds: [...(builder?.toolRelationIds ?? [])],
                systemRelationIds: [...(builder?.systemRelationIds ?? [])],
            }];
    }));
}
function dataDomainIdsForSystems(systemById, systemIds) {
    const domains = [];
    for (const systemId of systemIds) {
        const system = systemById.get(systemId);
        if (system === undefined)
            continue;
        for (const domainId of system.dataDomainIds) {
            if (!domains.includes(domainId))
                domains.push(domainId);
        }
    }
    return domains;
}
function buildProcessFlowIndex(topology) {
    const index = Object.fromEntries(topology.processes.map((process) => [process.id, {
            processId: process.id,
            ...(process.ownerNodeId !== undefined ? { ownerNodeId: process.ownerNodeId } : {}),
            stepNodeIds: [...process.stepNodeIds],
            ...(process.accountablePositionId !== undefined ? { accountablePositionId: process.accountablePositionId } : {}),
            transitionRelationIds: [],
        }]));
    topology.relations.forEach((relation) => {
        if (relation.relationType !== "depends_on")
            return;
        if (relation.from.entityType === "process_definition") {
            const flow = index[relation.from.id];
            if (flow !== undefined)
                flow.transitionRelationIds = addUnique(flow.transitionRelationIds, relation.id);
        }
        if (relation.to.entityType === "process_definition") {
            const flow = index[relation.to.id];
            if (flow !== undefined)
                flow.transitionRelationIds = addUnique(flow.transitionRelationIds, relation.id);
        }
    });
    return index;
}
function buildResponsibilityIndex(topology) {
    const byScopeKey = {};
    const byResponsibleKey = {};
    topology.responsibilities.forEach((entry) => {
        const scopeKey = buildCompiledEntityRefKey(entry.scope);
        const existing = byScopeKey[scopeKey] ?? {
            scope: cloneRef(entry.scope),
            responsibilityEntryIds: [],
            responsibleRefs: [],
            accountableRefs: [],
            consultedRefs: [],
            informedRefs: [],
        };
        existing.responsibilityEntryIds = addUnique(existing.responsibilityEntryIds, entry.id);
        existing.responsibleRefs = addUniqueRefs(existing.responsibleRefs, [entry.responsible]);
        if (entry.accountable !== undefined)
            existing.accountableRefs = addUniqueRefs(existing.accountableRefs, [entry.accountable]);
        existing.consultedRefs = addUniqueRefs(existing.consultedRefs, entry.consulted);
        existing.informedRefs = addUniqueRefs(existing.informedRefs, entry.informed);
        byScopeKey[scopeKey] = existing;
        const responsibleKey = buildCompiledEntityRefKey(entry.responsible);
        byResponsibleKey[responsibleKey] = addUnique(byResponsibleKey[responsibleKey] ?? [], entry.id);
    });
    return { byScopeKey, byResponsibleKey };
}
function cloneRef(reference) {
    return { entityType: reference.entityType, id: reference.id };
}
function addUnique(values, ...nextValues) {
    const result = [...values];
    for (const nextValue of nextValues) {
        if (!result.includes(nextValue))
            result.push(nextValue);
    }
    return result;
}
function addUniqueRefs(values, nextValues) {
    const result = [...values];
    for (const nextValue of nextValues) {
        if (!result.some((value) => buildCompiledEntityRefKey(value) === buildCompiledEntityRefKey(nextValue))) {
            result.push(cloneRef(nextValue));
        }
    }
    return result;
}
function stableStringify(value) {
    return JSON.stringify(sortJsonValue(value));
}
function sortJsonValue(value) {
    if (Array.isArray(value))
        return value.map(sortJsonValue);
    if (!isRecord(value))
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]));
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hashText(value) {
    return createHash("sha256").update(value).digest("hex");
}
//# sourceMappingURL=compiler.js.map