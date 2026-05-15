import { ENTERPRISE_TOPOLOGY_SCHEMA_VERSION, } from "../contracts/enterprise-topology.js";
import { applyEnterpriseTopologyGuiCommands, createEnterpriseTopologyGuiDraft, ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION, } from "./gui-operations.js";
import { enterpriseRelationTypeToExecutorConnectionRelation, executorConnectionLabel, executorConnectionToSafeEnterpriseRelationType, } from "./executor-relation-inference.js";
import { EXECUTOR_PROFILE_METADATA_KEY, buildExecutorProfileFromNode, normalizeExecutorProfile, } from "./executor-profile.js";
export const EXECUTOR_GRAPH_SCHEMA_VERSION = 1;
export const EXECUTOR_GRAPH_METADATA_KEY = "executorGraph";
export const EXECUTOR_GRAPH_SOURCE_OF_TRUTH = {
    editableProjection: "executor_graph",
    runtimeSourceOfTruth: "executor_topology_v2",
    nodeContractBoundary: "compatibility_projection",
    workOrderBoundary: "runtime_adapter",
    agentConfigRole: "compatibility_import",
    projectionOnly: true,
};
function cloneTopology(topology) {
    return structuredClone(topology);
}
function compactStrings(values) {
    return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}
function metadataStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function metadataNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function metadataBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function metadataString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function metadataPosition(value) {
    const record = metadataRecord(value);
    if (!record)
        return undefined;
    const x = record.x;
    const y = record.y;
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
        ? { x, y }
        : undefined;
}
function metadataRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function sourceNodeMetadata(node) {
    return metadataRecord(node.metadata?.[EXECUTOR_GRAPH_METADATA_KEY]);
}
function sourceRelationMetadata(relation) {
    return metadataRecord(relation.metadata?.[EXECUTOR_GRAPH_METADATA_KEY]);
}
function metadataInferenceEvidence(value) {
    const record = metadataRecord(value);
    if (!record || record.schemaVersion !== 1)
        return undefined;
    if (typeof record.evidenceId !== "string" || typeof record.executorId !== "string")
        return undefined;
    if (record.understandingState !== "draft" && record.understandingState !== "confirmed")
        return undefined;
    return record;
}
function averageConfidence(executors, connections) {
    const values = [
        ...executors.map((executor) => executor.confidence),
        ...connections.map((connection) => connection.confidence),
    ].filter((value) => Number.isFinite(value));
    if (values.length === 0)
        return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}
function runtimeModeForNode(node) {
    const metadata = sourceNodeMetadata(node);
    const metadataMode = metadataString(metadata?.inferredRuntimeMode);
    if (metadataMode && isExecutorRuntimeMode(metadataMode))
        return metadataMode;
    if (node.nodeType === "approval_node")
        return "approval";
    if (node.nodeType === "review_node" || node.nodeType === "decision_node")
        return "human_check";
    if (node.nodeType === "automation_node" || node.nodeType === "system_interface_node")
        return "tool_execution";
    if (node.nodeType === "external_node")
        return "external";
    return "auto";
}
function nodeTypeForRuntimeMode(executor) {
    if (executor.advancedMapping?.nodeType)
        return executor.advancedMapping.nodeType;
    if (executor.inferredRuntimeMode === "approval")
        return "approval_node";
    if (executor.inferredRuntimeMode === "human_check")
        return "review_node";
    if (executor.inferredRuntimeMode === "tool_execution")
        return "automation_node";
    if (executor.inferredRuntimeMode === "external")
        return "external_node";
    return "function";
}
function executorKindForRuntimeMode(mode) {
    if (mode === "approval" || mode === "human_check")
        return "manual_approval";
    if (mode === "tool_execution")
        return "tool";
    if (mode === "external")
        return "external";
    return "nobie";
}
function successCriteriaForNode(node) {
    const criteria = metadataStringArray(node.template?.metadata?.successCriteria);
    if (criteria.length > 0)
        return criteria;
    return compactStrings(node.tags.length > 0 ? node.tags.map((tag) => `${tag} 처리`) : ["결과 요약"]);
}
function outputsForNode(node) {
    const outputs = metadataStringArray(node.template?.metadata?.outputs);
    if (outputs.length > 0)
        return outputs;
    const outputPreset = metadataString(node.template?.metadata?.outputPreset);
    return outputPreset ? [outputPreset] : ["처리 결과"];
}
function executorProfileForExecutor(executor) {
    return normalizeExecutorProfile(executor.executorProfile, {
        executorId: executor.id,
        displayName: executor.name,
        roleName: executor.executorProfile?.roleName ?? executor.advancedMapping?.executorKind ?? "executor",
        definition: executor.description,
        does: executor.definitionQuickChips?.length ? executor.definitionQuickChips : [executor.description],
        delegationScope: executor.inferredCapabilities,
        expectedOutputs: executor.inferredOutputs,
        handoffStyle: executor.executorProfile?.handoffStyle ?? "structured_handoff",
        declineCriteria: executor.executorProfile?.declineCriteria ?? [],
        riskBoundary: executor.executorProfile?.riskBoundary ?? [],
    });
}
function executorForNode(node) {
    const metadata = sourceNodeMetadata(node);
    const mode = runtimeModeForNode(node);
    const confidence = metadataNumber(metadata?.confidence, node.metadata?.importedFromAgentConfigId ? 0.55 : 0.72);
    const userConfirmed = metadataBoolean(metadata?.userConfirmed, false);
    const confirmedUnderstandingVersion = metadataString(metadata?.confirmedUnderstandingVersion);
    const executorResourceId = metadataString(metadata?.executorResourceId);
    const inferenceEvidence = metadataInferenceEvidence(metadata?.inferenceEvidence);
    const position = metadataPosition(metadata?.position);
    const definitionQuickChips = metadataStringArray(metadata?.definitionQuickChips);
    const name = node.displayName?.trim() || node.name;
    const executorProfile = buildExecutorProfileFromNode(node, { executorId: node.id, displayName: name });
    return {
        id: metadataString(metadata?.executorId) ?? node.id,
        name,
        description: node.description !== undefined
            ? node.description
            : node.instruction?.trim() || node.nodeType,
        ...(definitionQuickChips.length > 0 ? { definitionQuickChips } : {}),
        ...(position ? { position } : {}),
        inferredRuntimeMode: mode,
        inferredCapabilities: compactStrings([...node.tags, ...metadataStringArray(metadata?.inferredCapabilities)]),
        inferredTools: compactStrings([...node.allowedToolIds, ...metadataStringArray(metadata?.inferredTools)]),
        inferredOutputs: outputsForNode(node),
        inferredSuccessCriteria: successCriteriaForNode(node),
        executorProfile,
        confidence,
        ...(userConfirmed ? { userConfirmed } : {}),
        ...(confirmedUnderstandingVersion ? { confirmedUnderstandingVersion } : {}),
        sourceNodeId: node.id,
        ...(inferenceEvidence ? { inferenceEvidence } : {}),
        advancedMapping: {
            nodeType: node.nodeType,
            executorKind: executorKindForRuntimeMode(mode),
            ...(executorResourceId ? { executorId: executorResourceId } : {}),
            allowedToolIds: [...node.allowedToolIds],
            allowedSystemIds: [...node.allowedSystemIds],
        },
    };
}
function inferredRelationForEnterpriseRelation(relation, targetNode) {
    const metadata = sourceRelationMetadata(relation);
    const metadataRelation = metadataString(metadata?.inferredRelation);
    if (metadataRelation && isExecutorConnectionRelation(metadataRelation))
        return metadataRelation;
    if (relation.relationType === "delegates_to") {
        return targetNode?.nodeType === "approval_node" ? "approval_request" : "handoff";
    }
    return enterpriseRelationTypeToExecutorConnectionRelation(relation.relationType);
}
function connectionForRelation(relation, nodeById) {
    if (relation.status === "archived")
        return null;
    if (relation.from.entityType !== "node" || relation.to.entityType !== "node")
        return null;
    const targetNode = nodeById.get(relation.to.id);
    const inferredRelation = inferredRelationForEnterpriseRelation(relation, targetNode);
    if (!inferredRelation)
        return null;
    const metadata = sourceRelationMetadata(relation);
    const confidence = metadataNumber(metadata?.confidence, 0.72);
    const userConfirmed = metadataBoolean(metadata?.userConfirmed, false);
    return {
        id: metadataString(metadata?.connectionId) ?? relation.id,
        fromExecutorId: relation.from.id,
        toExecutorId: relation.to.id,
        inferredRelation,
        label: executorConnectionLabel(inferredRelation),
        confidence,
        userConfirmed,
        sourceRelationId: relation.id,
        advancedRelationType: relation.relationType,
    };
}
function sectionForTeam(team) {
    return {
        id: team.id,
        name: team.displayName?.trim() || team.name,
        description: team.purpose ?? "실행자 영역",
        executorIds: [...team.nodeIds],
        sourceTeamId: team.id,
        collapsed: Boolean(team.metadata?.collapsed),
    };
}
function defaultGraphId(topologyId) {
    return `executor-graph:${topologyId}`;
}
export function buildExecutorGraphFromEnterpriseTopology(topology, options = {}) {
    const metadata = readExecutorGraphMetadata(topology);
    const activeNodes = topology.nodes.filter((node) => node.status !== "archived");
    const nodeById = new Map(activeNodes.map((node) => [node.id, node]));
    const executors = activeNodes.map((node) => executorForNode(node));
    const sections = topology.teams
        .filter((team) => team.status !== "archived")
        .map((team) => sectionForTeam(team));
    const connections = topology.relations
        .map((relation) => connectionForRelation(relation, nodeById))
        .filter((connection) => Boolean(connection));
    const issues = validateExecutorGraphDraft({ executors, connections });
    const confidence = averageConfidence(executors, connections);
    return {
        schemaVersion: EXECUTOR_GRAPH_SCHEMA_VERSION,
        graphId: metadata?.graphId ?? defaultGraphId(topology.id),
        topologyId: topology.id,
        name: topology.name,
        mode: options.mode ?? metadata?.mode ?? "simple",
        executors,
        sections,
        connections,
        selectedId: null,
        inference: {
            source: "enterprise_topology_projection",
            confidence,
            executorCount: executors.length,
            connectionCount: connections.length,
            issueCount: issues.length,
            ...(options.now ? { generatedAt: options.now } : {}),
        },
        compiledPreview: null,
        latestRun: null,
        issues,
        sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
    };
}
function isExecutorRuntimeMode(value) {
    return value === "auto" ||
        value === "human_check" ||
        value === "approval" ||
        value === "tool_execution" ||
        value === "external" ||
        value === "unknown";
}
function isExecutorConnectionRelation(value) {
    return value === "handoff" ||
        value === "approval_request" ||
        value === "report" ||
        value === "collaboration" ||
        value === "exception" ||
        value === "reference";
}
function relationIdForConnection(connection) {
    if (connection.sourceRelationId)
        return connection.sourceRelationId;
    if (connection.id.startsWith("relation:"))
        return connection.id;
    return `relation:${connection.id}`;
}
function defaultTopologyForGraph(graph, now) {
    return {
        schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
        entityType: "topology",
        id: graph.topologyId || graph.graphId.replace(/^executor-graph:/, "topology:"),
        name: graph.name || "Executor graph topology",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        nodes: [],
        teams: [],
        orgUnits: [],
        positions: [],
        persons: [],
        memberships: [],
        authorityRules: [],
        responsibilities: [],
        systems: [],
        tools: [],
        processes: [],
        relations: [],
    };
}
function operationId(prefix, id, at) {
    return `executor-graph:${prefix}:${id}:${String(at)}`;
}
export function buildExecutorGraphGuiOperations(graph, baseTopology, options = {}) {
    const at = options.now ?? Date.now();
    const existingNodeIds = new Set(baseTopology?.nodes.map((node) => node.id) ?? []);
    const existingRelationIds = new Set(baseTopology?.relations.map((relation) => relation.id) ?? []);
    const executorById = new Map(graph.executors.map((executor) => [executor.id, executor]));
    const operations = [];
    for (const executor of graph.executors) {
        const nodeId = executor.sourceNodeId ?? executor.id;
        const nodeType = nodeTypeForRuntimeMode(executor);
        const executorProfile = executorProfileForExecutor(executor);
        const template = {
            templateId: `executor-graph:${executor.id}`,
            source: "user_preset",
            fixedRoleCatalog: false,
            metadata: {
                successCriteria: executor.inferredSuccessCriteria,
                outputs: executor.inferredOutputs,
                roleName: executorProfile.roleName,
                definition: executorProfile.definition,
                does: executorProfile.does,
                delegationScope: executorProfile.delegationScope,
                expectedOutputs: executorProfile.expectedOutputs,
                handoffStyle: executorProfile.handoffStyle,
                declineCriteria: executorProfile.declineCriteria,
                riskBoundary: executorProfile.riskBoundary,
                [EXECUTOR_PROFILE_METADATA_KEY]: executorProfile,
                executorGraphId: graph.graphId,
            },
        };
        if (!existingNodeIds.has(nodeId)) {
            operations.push({
                schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
                operationId: operationId("create-node", nodeId, at),
                op: "createNode",
                at,
                nodeId,
                name: executor.name,
                nodeType,
                templateId: template.templateId,
                label: `Create executor ${executor.name}`,
            });
        }
        operations.push({
            schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
            operationId: operationId("update-node", nodeId, at),
            op: "updateNode",
            at,
            nodeId,
            label: `Update executor ${executor.name}`,
            patch: {
                name: executor.name,
                description: executor.description,
                nodeType,
                tags: executor.inferredCapabilities,
                template,
                allowedToolIds: [],
                allowedSystemIds: [],
            },
        });
    }
    for (const connection of graph.connections) {
        const relationId = relationIdForConnection(connection);
        const relationType = executorConnectionToSafeEnterpriseRelationType({
            connection,
            source: executorById.get(connection.fromExecutorId) ?? null,
            target: executorById.get(connection.toExecutorId) ?? null,
        });
        const from = { entityType: "node", id: connection.fromExecutorId };
        const to = { entityType: "node", id: connection.toExecutorId };
        if (!existingRelationIds.has(relationId)) {
            operations.push({
                schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
                operationId: operationId("create-relation", relationId, at),
                op: "createRelation",
                at,
                relationId,
                relationType,
                from,
                to,
                label: connection.label,
                name: `${connection.fromExecutorId} ${connection.label} ${connection.toExecutorId}`,
            });
            continue;
        }
        operations.push({
            schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
            operationId: operationId("update-relation", relationId, at),
            op: "updateRelation",
            at,
            relationId,
            label: `Update executor connection ${relationId}`,
            patch: {
                relationType,
                from,
                to,
                label: connection.label,
            },
        });
    }
    return operations;
}
function validateExecutorGraphDraft(input) {
    const issues = [];
    const executorIds = new Set();
    const connectionIds = new Set();
    for (const executor of input.executors) {
        if (executorIds.has(executor.id)) {
            issues.push({
                severity: "error",
                code: "duplicate_executor_id",
                message: `Duplicate executor id: ${executor.id}`,
                targetId: executor.id,
            });
        }
        executorIds.add(executor.id);
        if (!executor.name.trim()) {
            issues.push({
                severity: "warning",
                code: "blank_executor_name",
                message: `Executor requires a name: ${executor.id}`,
                targetId: executor.id,
            });
        }
    }
    for (const connection of input.connections) {
        if (connectionIds.has(connection.id)) {
            issues.push({
                severity: "error",
                code: "duplicate_connection_id",
                message: `Duplicate connection id: ${connection.id}`,
                targetId: connection.id,
            });
        }
        connectionIds.add(connection.id);
        if (!executorIds.has(connection.fromExecutorId) || !executorIds.has(connection.toExecutorId)) {
            issues.push({
                severity: "error",
                code: "missing_connection_endpoint",
                message: `Connection endpoint is missing: ${connection.id}`,
                targetId: connection.id,
            });
        }
        if (connection.fromExecutorId === connection.toExecutorId) {
            issues.push({
                severity: "error",
                code: "self_loop_connection",
                message: `Connection cannot delegate to itself: ${connection.id}`,
                targetId: connection.id,
            });
        }
    }
    return issues;
}
function executorNodeMetadata(graph, executor) {
    const executorProfile = executorProfileForExecutor(executor);
    return {
        executorId: executor.id,
        graphId: graph.graphId,
        inferredRuntimeMode: executor.inferredRuntimeMode,
        inferredCapabilities: executor.inferredCapabilities,
        inferredTools: executor.inferredTools,
        inferredOutputs: executor.inferredOutputs,
        [EXECUTOR_PROFILE_METADATA_KEY]: executorProfile,
        ...(executor.definitionQuickChips?.length
            ? { definitionQuickChips: [...executor.definitionQuickChips] }
            : {}),
        confidence: executor.confidence,
        userConfirmed: executor.userConfirmed ?? false,
        ...(executor.confirmedUnderstandingVersion
            ? { confirmedUnderstandingVersion: executor.confirmedUnderstandingVersion }
            : {}),
        ...(executor.position ? { position: { x: executor.position.x, y: executor.position.y } } : {}),
        ...(executor.inferenceEvidence
            ? { inferenceEvidence: executor.inferenceEvidence }
            : {}),
        sourceOfTruth: "executor_topology_v2",
        projectionOnly: true,
    };
}
function connectionRelationMetadata(graph, connection) {
    return {
        connectionId: connection.id,
        graphId: graph.graphId,
        inferredRelation: connection.inferredRelation,
        confidence: connection.confidence,
        userConfirmed: connection.userConfirmed,
        sourceOfTruth: "executor_topology_v2",
        projectionOnly: true,
    };
}
function attachNodeAndRelationMetadata(topology, graph) {
    const executorByNodeId = new Map(graph.executors.map((executor) => [executor.sourceNodeId ?? executor.id, executor]));
    const connectionByRelationId = new Map(graph.connections.map((connection) => [relationIdForConnection(connection), connection]));
    return {
        ...topology,
        nodes: topology.nodes.map((node) => {
            const executor = executorByNodeId.get(node.id);
            if (!executor)
                return node;
            return {
                ...node,
                metadata: {
                    ...(node.metadata ?? {}),
                    [EXECUTOR_GRAPH_METADATA_KEY]: executorNodeMetadata(graph, executor),
                },
            };
        }),
        relations: topology.relations.map((relation) => {
            const connection = connectionByRelationId.get(relation.id);
            if (!connection)
                return relation;
            return {
                ...relation,
                metadata: {
                    ...(relation.metadata ?? {}),
                    [EXECUTOR_GRAPH_METADATA_KEY]: connectionRelationMetadata(graph, connection),
                },
            };
        }),
    };
}
export function buildExecutorGraphTopologyMetadata(graph, options = {}) {
    const updatedAt = options.now ?? Date.now();
    return {
        schemaVersion: EXECUTOR_GRAPH_SCHEMA_VERSION,
        graphId: graph.graphId,
        topologyId: graph.topologyId,
        mode: graph.mode,
        source: "executor_graph",
        sourceOfTruth: "executor_topology_v2",
        projectionOnly: true,
        executorIds: graph.executors.map((executor) => executor.id),
        connectionIds: graph.connections.map((connection) => connection.id),
        sectionIds: graph.sections.map((section) => section.id),
        confirmedExecutorIds: graph.executors.filter((executor) => executor.userConfirmed).map((executor) => executor.id),
        confidence: averageConfidence(graph.executors, graph.connections),
        updatedAt,
        workspace: {
            executors: graph.executors.map((executor) => ({
                id: executor.id,
                name: executor.name,
                description: executor.description,
                ...(executor.definitionQuickChips?.length
                    ? { definitionQuickChips: [...executor.definitionQuickChips] }
                    : {}),
                inferredRuntimeMode: executor.inferredRuntimeMode,
                inferredCapabilities: [...executor.inferredCapabilities],
                inferredTools: [...executor.inferredTools],
                inferredOutputs: [...executor.inferredOutputs],
                inferredSuccessCriteria: [...executor.inferredSuccessCriteria],
                executorProfile: executorProfileForExecutor(executor),
                confidence: executor.confidence,
                ...(executor.userConfirmed !== undefined ? { userConfirmed: executor.userConfirmed } : {}),
                ...(executor.confirmedUnderstandingVersion
                    ? { confirmedUnderstandingVersion: executor.confirmedUnderstandingVersion }
                    : {}),
                ...(executor.position ? { position: { x: executor.position.x, y: executor.position.y } } : {}),
                ...(executor.sourceNodeId ? { sourceNodeId: executor.sourceNodeId } : {}),
                ...(executor.inferenceEvidence ? { inferenceEvidence: structuredClone(executor.inferenceEvidence) } : {}),
            })),
            connections: graph.connections.map((connection) => ({
                id: connection.id,
                fromExecutorId: connection.fromExecutorId,
                toExecutorId: connection.toExecutorId,
                inferredRelation: connection.inferredRelation,
                label: connection.label,
                confidence: connection.confidence,
                userConfirmed: connection.userConfirmed,
                ...(connection.sourceRelationId ? { sourceRelationId: connection.sourceRelationId } : {}),
                ...(connection.advancedRelationType ? { advancedRelationType: connection.advancedRelationType } : {}),
            })),
            sections: graph.sections.map((section) => ({ ...section, executorIds: [...section.executorIds] })),
        },
    };
}
export function attachExecutorGraphMetadata(topology, graph, options = {}) {
    const metadata = buildExecutorGraphTopologyMetadata(graph, options);
    return {
        ...cloneTopology(topology),
        metadata: {
            ...(topology.metadata ?? {}),
            [EXECUTOR_GRAPH_METADATA_KEY]: metadata,
        },
    };
}
export function readExecutorGraphMetadata(topology) {
    const value = topology.metadata?.[EXECUTOR_GRAPH_METADATA_KEY];
    const record = metadataRecord(value);
    if (!record || record.schemaVersion !== EXECUTOR_GRAPH_SCHEMA_VERSION)
        return null;
    if (typeof record.graphId !== "string" || typeof record.topologyId !== "string")
        return null;
    if (record.mode !== "simple" && record.mode !== "advanced")
        return null;
    if (record.source !== "executor_graph")
        return null;
    if (record.sourceOfTruth !== "executor_topology_v2" && record.sourceOfTruth !== "enterprise_topology")
        return null;
    if (record.projectionOnly !== true)
        return null;
    const workspace = metadataRecord(record.workspace);
    if (!workspace)
        return null;
    return {
        ...record,
        sourceOfTruth: "executor_topology_v2",
    };
}
export function compileExecutorGraphToEnterpriseTopology(graph, options = {}) {
    const now = options.now ?? Date.now();
    const baseTopology = options.baseTopology
        ? cloneTopology(options.baseTopology)
        : defaultTopologyForGraph(graph, now);
    const issues = validateExecutorGraphDraft(graph);
    if (issues.some((issue) => issue.severity === "error")) {
        return {
            ok: false,
            topology: baseTopology,
            operations: [],
            metadata: null,
            issues,
        };
    }
    const operations = buildExecutorGraphGuiOperations(graph, baseTopology, { now });
    const draft = createEnterpriseTopologyGuiDraft({ topology: baseTopology, now });
    const applied = applyEnterpriseTopologyGuiCommands(draft, operations, { now });
    const withNodeMetadata = attachNodeAndRelationMetadata(applied.draft.topology, graph);
    const metadata = buildExecutorGraphTopologyMetadata(graph, { now });
    const topology = {
        ...withNodeMetadata,
        metadata: {
            ...(withNodeMetadata.metadata ?? {}),
            [EXECUTOR_GRAPH_METADATA_KEY]: metadata,
        },
        updatedAt: now,
    };
    return {
        ok: true,
        topology,
        operations,
        metadata,
        issues: [],
    };
}
export function buildExecutorGraphRollbackEvidence(input) {
    const metadata = readExecutorGraphMetadata(input.restoredTopology);
    const projection = buildExecutorGraphFromEnterpriseTopology(input.restoredTopology, { mode: "simple" });
    const metadataExecutorIds = sorted(metadata?.executorIds ?? []);
    const projectionExecutorIds = sorted(projection.executors.map((executor) => executor.id));
    const metadataConnectionIds = sorted(metadata?.connectionIds ?? []);
    const projectionConnectionIds = sorted(projection.connections.map((connection) => connection.id));
    const expectedConfirmedIds = sorted(metadata?.confirmedExecutorIds ?? []);
    const projectionConfirmedIds = sorted(projection.executors.filter((executor) => executor.userConfirmed).map((executor) => executor.id));
    const blockingFailures = [];
    const expectedTopologyId = input.expectedTopologyId ?? input.restoredTopology.id;
    if (!metadata)
        blockingFailures.push("executor_graph_metadata_missing");
    if (input.restoredTopology.id !== expectedTopologyId)
        blockingFailures.push("topology_id_mismatch");
    if (input.expectedTopologyVersion !== undefined && input.actualTopologyVersion !== input.expectedTopologyVersion) {
        blockingFailures.push("topology_version_mismatch");
    }
    if (input.expectedTopologyVersionId !== undefined && input.actualTopologyVersionId !== input.expectedTopologyVersionId) {
        blockingFailures.push("topology_version_id_mismatch");
    }
    if (!sameStrings(metadataExecutorIds, projectionExecutorIds))
        blockingFailures.push("executor_projection_mismatch");
    if (!sameStrings(metadataConnectionIds, projectionConnectionIds))
        blockingFailures.push("connection_projection_mismatch");
    if (!sameStrings(expectedConfirmedIds, projectionConfirmedIds))
        blockingFailures.push("confirmed_understanding_mismatch");
    if (metadata?.sourceOfTruth !== "executor_topology_v2" ||
        metadata?.projectionOnly !== true ||
        projection.sourceOfTruth.runtimeSourceOfTruth !== "executor_topology_v2" ||
        projection.sourceOfTruth.projectionOnly !== true) {
        blockingFailures.push("source_of_truth_boundary_mismatch");
    }
    return {
        kind: "nobie.executor_graph.rollback_projection",
        status: blockingFailures.length === 0 ? "passed" : "failed",
        topologyId: input.restoredTopology.id,
        expectedTopologyId,
        ...(input.expectedTopologyVersion !== undefined ? { expectedTopologyVersion: input.expectedTopologyVersion } : {}),
        ...(input.expectedTopologyVersionId !== undefined ? { expectedTopologyVersionId: input.expectedTopologyVersionId } : {}),
        ...(input.actualTopologyVersion !== undefined ? { actualTopologyVersion: input.actualTopologyVersion } : {}),
        ...(input.actualTopologyVersionId !== undefined ? { actualTopologyVersionId: input.actualTopologyVersionId } : {}),
        metadataProjectionRestored: metadata !== null,
        executorIdsMatch: sameStrings(metadataExecutorIds, projectionExecutorIds),
        connectionIdsMatch: sameStrings(metadataConnectionIds, projectionConnectionIds),
        confirmedUnderstandingRestored: sameStrings(expectedConfirmedIds, projectionConfirmedIds),
        sourceOfTruthPreserved: !blockingFailures.includes("source_of_truth_boundary_mismatch"),
        blockingFailures,
    };
}
function sorted(values) {
    return [...values].sort((left, right) => left.localeCompare(right));
}
function sameStrings(left, right) {
    if (left.length !== right.length)
        return false;
    return left.every((value, index) => value === right[index]);
}
//# sourceMappingURL=executor-graph.js.map