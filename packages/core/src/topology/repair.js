import { EXECUTOR_PROFILE_METADATA_KEY, buildExecutorProfileFromNode, } from "./executor-profile.js";
const STRUCTURED_FROM_NODE_KEYS = [
    "fromNodeId",
    "sourceNodeId",
    "fromExecutorId",
    "sourceExecutorId",
    "fromId",
    "sourceId",
];
const STRUCTURED_TO_NODE_KEYS = [
    "toNodeId",
    "targetNodeId",
    "toExecutorId",
    "targetExecutorId",
    "toId",
    "targetId",
];
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function metadataRecord(value) {
    return isRecord(value) ? value : undefined;
}
function filterResourceHintArray(value, toolIds, systemIds) {
    if (!Array.isArray(value))
        return { value, removed: [] };
    const removed = [];
    const next = value.filter((item) => {
        if (typeof item !== "string")
            return true;
        if (item.startsWith("tool:") && !toolIds.has(item)) {
            removed.push(item);
            return false;
        }
        if (item.startsWith("system:") && !systemIds.has(item)) {
            removed.push(item);
            return false;
        }
        return true;
    });
    return { value: next, removed };
}
function nodeRef(value, nodeIds) {
    if (!isRecord(value))
        return undefined;
    if (value.entityType !== "node")
        return undefined;
    const id = nonEmptyString(value.id);
    if (!id || !nodeIds.has(id))
        return undefined;
    return { entityType: "node", id };
}
function structuredNodeId(relation, nodeIds, keys) {
    const containers = [
        relation,
        metadataRecord(relation.metadata),
        metadataRecord(metadataRecord(relation.metadata)?.executorGraph),
    ].filter((value) => Boolean(value));
    for (const container of containers) {
        for (const key of keys) {
            const id = nonEmptyString(container[key]);
            if (id && nodeIds.has(id))
                return id;
        }
    }
    return undefined;
}
function relationCandidate(relation) {
    return relation;
}
function repairDelegationRelationEndpoints(input) {
    if (input.relation.relationType !== "delegates_to")
        return;
    const record = relationCandidate(input.relation);
    const from = nodeRef(record.from, input.nodeIds);
    const to = nodeRef(record.to, input.nodeIds);
    if (from && to)
        return;
    const recoveredFromId = from?.id ?? structuredNodeId(record, input.nodeIds, STRUCTURED_FROM_NODE_KEYS);
    const recoveredToId = to?.id ?? structuredNodeId(record, input.nodeIds, STRUCTURED_TO_NODE_KEYS);
    if (!recoveredFromId || !recoveredToId) {
        input.issues.push({
            code: "topology_relation_endpoint_unrepairable",
            severity: "invalid",
            message: `Relation ${input.relation.id} is missing structured node from/to endpoints and was not repaired from id or name text.`,
            topologyId: input.topologyId,
            relationId: input.relation.id,
        });
        return;
    }
    input.relation.from = { entityType: "node", id: recoveredFromId };
    input.relation.to = { entityType: "node", id: recoveredToId };
    input.relation.metadata = {
        ...(input.relation.metadata ?? {}),
        endpointRepair: {
            repairedBy: "topology_persistence_repair",
            source: "structured_endpoint_fields",
        },
    };
    input.issues.push({
        code: "topology_relation_endpoint_repaired",
        severity: "warning",
        message: `Relation ${input.relation.id} was repaired from structured endpoint fields.`,
        topologyId: input.topologyId,
        relationId: input.relation.id,
    });
}
function activeRelation(relation) {
    return relation.status !== "archived" && relation.status !== "inactive";
}
function removeMissingResourceReferences(input) {
    const toolIds = new Set(input.topology.tools.filter((tool) => tool.status !== "archived").map((tool) => tool.id));
    const systemIds = new Set(input.topology.systems.filter((system) => system.status !== "archived").map((system) => system.id));
    for (const node of input.topology.nodes) {
        const previousToolIds = [...node.allowedToolIds];
        const previousSystemIds = [...node.allowedSystemIds];
        node.allowedToolIds = previousToolIds.filter((toolId) => toolIds.has(toolId));
        node.allowedSystemIds = previousSystemIds.filter((systemId) => systemIds.has(systemId));
        for (const toolId of previousToolIds) {
            if (toolIds.has(toolId))
                continue;
            input.issues.push({
                code: "topology_missing_tool_reference_removed",
                severity: "warning",
                message: `Node ${node.id} referenced missing tool ${toolId}; the stale permission was removed.`,
                topologyId: input.topology.id,
                nodeId: node.id,
            });
        }
        for (const systemId of previousSystemIds) {
            if (systemIds.has(systemId))
                continue;
            input.issues.push({
                code: "topology_missing_system_reference_removed",
                severity: "warning",
                message: `Node ${node.id} referenced missing system ${systemId}; the stale permission was removed.`,
                topologyId: input.topology.id,
                nodeId: node.id,
            });
        }
        const executorGraphMetadata = metadataRecord(node.metadata?.executorGraph);
        if (executorGraphMetadata) {
            const filtered = filterResourceHintArray(executorGraphMetadata.inferredTools, toolIds, systemIds);
            executorGraphMetadata.inferredTools = filtered.value;
            for (const refId of filtered.removed) {
                input.issues.push({
                    code: "topology_missing_resource_hint_removed",
                    severity: "warning",
                    message: `Node ${node.id} metadata referenced missing resource ${refId}; the stale hint was removed.`,
                    topologyId: input.topology.id,
                    nodeId: node.id,
                });
            }
        }
    }
    const topologyExecutorGraphMetadata = metadataRecord(input.topology.metadata?.executorGraph);
    const workspace = metadataRecord(topologyExecutorGraphMetadata?.workspace);
    const workspaceExecutors = Array.isArray(workspace?.executors) ? workspace.executors : [];
    for (const executor of workspaceExecutors) {
        const record = metadataRecord(executor);
        if (!record)
            continue;
        const filtered = filterResourceHintArray(record.inferredTools, toolIds, systemIds);
        record.inferredTools = filtered.value;
        const executorId = nonEmptyString(record.id);
        for (const refId of filtered.removed) {
            input.issues.push({
                code: "topology_missing_resource_hint_removed",
                severity: "warning",
                message: `Workspace executor ${executorId ?? "unknown"} metadata referenced missing resource ${refId}; the stale hint was removed.`,
                topologyId: input.topology.id,
                ...(executorId !== undefined ? { nodeId: executorId } : {}),
            });
        }
    }
    input.topology.relations = input.topology.relations.filter((relation) => {
        if (relation.to.entityType === "enterprise_tool" && !toolIds.has(relation.to.id)) {
            input.issues.push({
                code: "topology_missing_tool_relation_removed",
                severity: "warning",
                message: `Relation ${relation.id} referenced missing tool ${relation.to.id}; the stale relation was removed.`,
                topologyId: input.topology.id,
                relationId: relation.id,
            });
            return false;
        }
        if (relation.to.entityType === "enterprise_system" && !systemIds.has(relation.to.id)) {
            input.issues.push({
                code: "topology_missing_system_relation_removed",
                severity: "warning",
                message: `Relation ${relation.id} referenced missing system ${relation.to.id}; the stale relation was removed.`,
                topologyId: input.topology.id,
                relationId: relation.id,
            });
            return false;
        }
        return true;
    });
}
function syncNodeChildrenFromDelegationRelations(input) {
    const hasDelegationRelation = input.topology.relations.some((relation) => relation.relationType === "delegates_to" && relation.status !== "archived");
    if (!hasDelegationRelation)
        return;
    const childrenByNodeId = new Map();
    for (const relation of input.topology.relations) {
        if (relation.relationType !== "delegates_to" || !activeRelation(relation))
            continue;
        const from = nodeRef(relation.from, input.nodeIds);
        const to = nodeRef(relation.to, input.nodeIds);
        if (!from || !to)
            continue;
        childrenByNodeId.set(from.id, [...(childrenByNodeId.get(from.id) ?? []), to.id]);
    }
    for (const node of input.topology.nodes) {
        const nextChildren = [...new Set(childrenByNodeId.get(node.id) ?? [])];
        const previousChildren = [...node.children];
        node.children = nextChildren;
        if (previousChildren.length === nextChildren.length && previousChildren.every((value, index) => value === nextChildren[index])) {
            continue;
        }
        input.issues.push({
            code: "topology_node_children_reprojected",
            severity: "warning",
            message: `Node ${node.id} children were reprojected from delegates_to relations.`,
            topologyId: input.topology.id,
            nodeId: node.id,
        });
    }
}
function executorProfileMetadataValue(node) {
    const graphMetadata = metadataRecord(node.metadata?.executorGraph);
    return (node.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
        node.template?.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
        graphMetadata?.[EXECUTOR_PROFILE_METADATA_KEY]);
}
function profileWithRequiredMinimums(node) {
    const profile = buildExecutorProfileFromNode(node);
    const defaultBoundary = "사용자가 명시적으로 허용하지 않은 민감 정보, 외부 전송, 결제, 삭제, 시스템 제어는 실행하지 않습니다.";
    const defaultDecline = "노드 정의, 허용 도구, 위임 범위를 벗어난 요청은 직접 처리하지 않고 상위 실행자에게 되돌립니다.";
    return {
        ...profile,
        does: profile.does.length > 0 ? profile.does : [profile.definition],
        delegationScope: profile.delegationScope.length === 0 ||
            (profile.delegationScope.length === 1 && profile.delegationScope[0] === profile.definition)
            ? [profile.roleName]
            : profile.delegationScope,
        expectedOutputs: profile.expectedOutputs.length > 0 ? profile.expectedOutputs : ["처리 결과"],
        declineCriteria: profile.declineCriteria.length > 0 ? profile.declineCriteria : [defaultDecline],
        riskBoundary: profile.riskBoundary.length > 0 ? profile.riskBoundary : [defaultBoundary],
    };
}
function ensureExecutorProfile(input) {
    if (executorProfileMetadataValue(input.node) !== undefined)
        return;
    const profile = profileWithRequiredMinimums(input.node);
    input.node.metadata = {
        ...(input.node.metadata ?? {}),
        [EXECUTOR_PROFILE_METADATA_KEY]: profile,
    };
    input.issues.push({
        code: "topology_executor_profile_created",
        severity: "info",
        message: `Node ${input.node.id} received a minimal executorProfile.`,
        topologyId: input.topologyId,
        nodeId: input.node.id,
    });
}
export function repairTopologyForPersistence(topology) {
    const repaired = structuredClone(topology);
    const issues = [];
    const nodeIds = new Set(repaired.nodes.map((node) => node.id));
    for (const relation of repaired.relations) {
        repairDelegationRelationEndpoints({
            topologyId: repaired.id,
            relation,
            nodeIds,
            issues,
        });
    }
    removeMissingResourceReferences({ topology: repaired, issues });
    syncNodeChildrenFromDelegationRelations({ topology: repaired, nodeIds, issues });
    for (const node of repaired.nodes) {
        if (node.status === "archived")
            continue;
        ensureExecutorProfile({ topologyId: repaired.id, node, issues });
    }
    return { topology: repaired, issues };
}
//# sourceMappingURL=repair.js.map
