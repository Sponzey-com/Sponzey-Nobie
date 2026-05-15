import { ENTERPRISE_TOPOLOGY_SCHEMA_VERSION } from "../contracts/enterprise-topology.js";
import { buildExecutorProfileFromNode, } from "./executor-profile.js";
export const EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION = 2;
export const NOBIE_ROOT_AGENT_ID = "agent:nobie";
export const EXECUTOR_TOPOLOGY_V2_SOURCE_FIELDS = [
    "node.id",
    "node.name",
    "node.roleName",
    "node.description",
    "node.definitionQuickChips",
    "node.instruction",
    "node.position",
    "node.status",
    "edge.id",
    "edge.sourceNodeId",
    "edge.targetNodeId",
    "edge.type",
    "edge.label",
    "edge.status",
];
export const EXECUTOR_TOPOLOGY_V2_PROJECTION_FIELDS = [
    "node.profile",
    "node.metadata",
    "topology.metadata",
];
const TOPOLOGY_STATUSES = new Set(["draft", "active", "archived"]);
const NODE_STATUSES = new Set(["active", "archived"]);
const EDGE_STATUSES = new Set(["active", "archived"]);
const STALE_TOPOLOGY_FIELDS = [
    "relations",
    "teams",
    "orgUnits",
    "positions",
    "persons",
    "memberships",
    "authorityRules",
    "responsibilities",
    "systems",
    "tools",
    "processes",
    "children",
    "allowedToolIds",
    "allowedSystemIds",
];
const STALE_NODE_FIELDS = ["children", "allowedToolIds", "allowedSystemIds"];
const STALE_METADATA_KEYS = new Set([
    "active_default_workflow_candidate",
    "advancedMapping",
    "aiSuggestionAlternatives",
    "allowedSystemIds",
    "allowedToolIds",
    "children",
    "confirmedUnderstandingVersion",
    "definitionQuickChips",
    "diagnostic",
    "diagnostics",
    "inferenceEvidence",
    "inferredOutputs",
    "inferredRuntimeMode",
    "inferredSuccessCriteria",
    "inferredTools",
    "lastSelectedNodeId",
    "nodeDefinitionAlternatives",
    "nobieUnderstanding",
    "recommendedEntry",
    "runtimeDiagnostic",
    "runtimeDiagnostics",
    "selectedId",
    "selectedNodeId",
    "suggestionAlternatives",
    "understanding",
    "understoodByNobie",
    "workspace",
]);
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function normalizedExecutorNodeName(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    return normalized.length > 0 ? normalized : undefined;
}
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])))];
}
function maybeString(value) {
    return nonEmptyString(value) ? value.trim() : undefined;
}
function recordFromUnknown(value) {
    return isRecord(value) ? value : undefined;
}
function nodeDefinitionQuickChipsFromEnterpriseNode(node) {
    const metadata = recordFromUnknown(node.metadata);
    const executorGraph = recordFromUnknown(metadata?.executorGraph);
    const graph = stringArray(executorGraph?.definitionQuickChips);
    const direct = stringArray(metadata?.definitionQuickChips);
    return graph.length > 0 ? graph : direct;
}
function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function timestampFromEnterprise(value, fallback) {
    return validTimestamp(value) ? value : fallback;
}
function toExecutorNodeStatus(status) {
    return status === "archived" || status === "inactive" ? "archived" : "active";
}
function toExecutorEdgeStatus(status) {
    return status === "archived" || status === "inactive" ? "archived" : "active";
}
function nodeDescription(node) {
    return node.description?.trim() || node.instruction?.trim() || node.displayName?.trim() || node.name.trim() || node.id;
}
function nodeDisplayNameV2(node) {
    return node.displayName?.trim() || node.name.trim() || node.id;
}
function nodePosition(node, index) {
    const metadata = recordFromUnknown(node.metadata);
    const graphMetadata = recordFromUnknown(metadata?.executorGraph);
    const templateMetadata = recordFromUnknown(node.template?.metadata);
    const candidates = [
        metadata?.position,
        graphMetadata?.position,
        templateMetadata?.position,
    ];
    for (const candidate of candidates) {
        const position = recordFromUnknown(candidate);
        const x = finiteNumber(position?.x);
        const y = finiteNumber(position?.y);
        if (x !== undefined && y !== undefined)
            return { x, y };
    }
    return { x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180 };
}
function cloneMetadataValue(value) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => cloneMetadataValue(item))
            .filter((item) => item !== undefined);
    }
    if (!isRecord(value))
        return undefined;
    const entries = Object.entries(value)
        .map(([key, item]) => [key, cloneMetadataValue(item)])
        .filter((entry) => entry[1] !== undefined);
    return Object.fromEntries(entries);
}
function auditRefsFromMetadata(metadata) {
    const record = recordFromUnknown(metadata);
    if (!record)
        return [];
    const refs = [];
    const aiSuggestionState = recordFromUnknown(record.aiSuggestionState);
    const directRunId = maybeString(aiSuggestionState?.suggestionRunId);
    if (directRunId) {
        refs.push({
            kind: "node_definition_suggestion",
            suggestionRunId: directRunId,
            ...(maybeString(aiSuggestionState?.selectedAlternativeId)
                ? { selectedAlternativeId: maybeString(aiSuggestionState?.selectedAlternativeId) }
                : {}),
        });
    }
    const history = Array.isArray(record.suggestionHistory) ? record.suggestionHistory : [];
    for (const item of history) {
        const itemRecord = recordFromUnknown(item);
        const suggestionRunId = maybeString(itemRecord?.suggestionRunId);
        if (!suggestionRunId)
            continue;
        refs.push({
            kind: "node_definition_suggestion",
            suggestionRunId,
            ...(maybeString(itemRecord?.selectedAlternativeId)
                ? { selectedAlternativeId: maybeString(itemRecord?.selectedAlternativeId) }
                : {}),
        });
    }
    return refs;
}
function sanitizeMetadataForV2(value, input) {
    const record = recordFromUnknown(value);
    if (!record)
        return undefined;
    const result = {};
    const auditRefs = auditRefsFromMetadata(record);
    for (const [key, item] of Object.entries(record)) {
        if (STALE_METADATA_KEYS.has(key) || key === "suggestionHistory" || key === "aiSuggestionState") {
            input.issues.push({
                code: "executor_topology_v2_stale_metadata_removed",
                severity: "warning",
                message: `Removed stale metadata ${input.path}.${key} from ExecutorTopologyV2 read model.`,
                topologyId: input.topologyId,
                ...(input.nodeId ? { nodeId: input.nodeId } : {}),
            });
            continue;
        }
        if (key === "executorGraph") {
            const sanitizedGraph = sanitizeMetadataForV2(item, {
                ...input,
                path: `${input.path}.executorGraph`,
            });
            if (sanitizedGraph && Object.keys(sanitizedGraph).length > 0) {
                result.executorGraph = sanitizedGraph;
            }
            continue;
        }
        const cloned = cloneMetadataValue(item);
        if (cloned !== undefined)
            result[key] = cloned;
    }
    if (auditRefs.length > 0)
        result.aiSuggestionAuditRefs = auditRefs;
    return Object.keys(result).length > 0 ? result : undefined;
}
function enterpriseRelationNodeId(relation, endpoint) {
    const ref = relation[endpoint];
    return ref.entityType === "node" && ref.id.trim() ? ref.id : undefined;
}
function relationEdgeId(relation) {
    return relation.id.startsWith("edge:") ? relation.id : `edge:${relation.id}`;
}
function legacyChildEdgeId(sourceNodeId, targetNodeId) {
    return `edge:legacy-child:${sourceNodeId}:${targetNodeId}`;
}
function validTimestamp(value) {
    if (typeof value === "string")
        return value.trim().length > 0;
    return typeof value === "number" && Number.isFinite(value);
}
function issue(issues, input) {
    issues.push({
        severity: input.severity ?? "error",
        code: input.code,
        path: input.path,
        message: input.message,
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        ...(input.edgeId ? { edgeId: input.edgeId } : {}),
    });
}
function validatePosition(issues, value, path, nodeId) {
    if (!isRecord(value)) {
        issue(issues, {
            code: "invalid_node_position",
            path,
            message: "Node position must be an object with finite x and y numbers.",
            ...(nodeId ? { nodeId } : {}),
        });
        return;
    }
    if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
        issue(issues, {
            code: "invalid_node_position_x",
            path: `${path}.x`,
            message: "Node position.x must be a finite number.",
            ...(nodeId ? { nodeId } : {}),
        });
    }
    if (typeof value.y !== "number" || !Number.isFinite(value.y)) {
        issue(issues, {
            code: "invalid_node_position_y",
            path: `${path}.y`,
            message: "Node position.y must be a finite number.",
            ...(nodeId ? { nodeId } : {}),
        });
    }
}
function validateNoStaleMetadataKeys(issues, value, path, owner = {}) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            validateNoStaleMetadataKeys(issues, item, `${path}[${index}]`, owner);
        });
        return;
    }
    if (!isRecord(value))
        return;
    for (const [key, item] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (STALE_METADATA_KEYS.has(key) || key === "suggestionHistory" || key === "aiSuggestionState") {
            issue(issues, {
                code: "stale_metadata_field",
                path: childPath,
                message: `${key} is projection-only metadata and cannot be persisted as ExecutorTopologyV2 source data.`,
                ...(owner.nodeId ? { nodeId: owner.nodeId } : {}),
                ...(owner.edgeId ? { edgeId: owner.edgeId } : {}),
            });
            continue;
        }
        validateNoStaleMetadataKeys(issues, item, childPath, owner);
    }
}
export function migrateEnterpriseTopologyToExecutorTopologyV2(topology) {
    const issues = [];
    const activeNodeIds = new Set(topology.nodes
        .filter((node) => toExecutorNodeStatus(node.status) === "active")
        .map((node) => node.id));
    const nodes = topology.nodes.map((node, index) => {
        const profile = buildExecutorProfileFromNode(node);
        const definitionQuickChips = nodeDefinitionQuickChipsFromEnterpriseNode(node);
        const metadata = sanitizeMetadataForV2(node.metadata, {
            topologyId: topology.id,
            nodeId: node.id,
            issues,
            path: `node(${node.id}).metadata`,
        });
        const compatibility = {
            sourceSchemaVersion: topology.schemaVersion,
            sourceEntityType: node.entityType,
            sourceNodeType: node.nodeType,
            sourceStatus: node.status,
            ...(node.template?.templateId ? { sourceTemplateId: node.template.templateId } : {}),
            ...(node.metadata?.importedFromAgentConfigId
                ? { importedFromAgentConfigId: node.metadata.importedFromAgentConfigId }
                : {}),
        };
        return {
            id: node.id,
            name: nodeDisplayNameV2(node),
            roleName: profile.roleName,
            description: nodeDescription(node),
            ...(definitionQuickChips.length > 0 ? { definitionQuickChips } : {}),
            ...(node.instruction?.trim() ? { instruction: node.instruction.trim() } : {}),
            position: nodePosition(node, index),
            status: toExecutorNodeStatus(node.status),
            profile: profile,
            metadata: {
                ...(metadata ?? {}),
                compatibility,
            },
        };
    });
    const edges = [];
    const seenEdgeIds = new Set();
    const hasDelegatesToRelations = topology.relations.some((relation) => relation.relationType === "delegates_to");
    for (const relation of topology.relations) {
        if (relation.relationType !== "delegates_to")
            continue;
        const sourceNodeId = enterpriseRelationNodeId(relation, "from");
        const targetNodeId = enterpriseRelationNodeId(relation, "to");
        if (!sourceNodeId || !targetNodeId || !activeNodeIds.has(sourceNodeId) || !activeNodeIds.has(targetNodeId)) {
            issues.push({
                code: "executor_topology_v2_relation_skipped",
                severity: "warning",
                message: `Relation ${relation.id} was skipped because it is not a valid delegates_to edge between active nodes.`,
                topologyId: topology.id,
                relationId: relation.id,
            });
            continue;
        }
        const edgeId = relationEdgeId(relation);
        if (seenEdgeIds.has(edgeId)) {
            issues.push({
                code: "executor_topology_v2_duplicate_edge_skipped",
                severity: "warning",
                message: `Duplicate V2 edge id ${edgeId} was skipped.`,
                topologyId: topology.id,
                relationId: relation.id,
                edgeId,
            });
            continue;
        }
        seenEdgeIds.add(edgeId);
        edges.push({
            id: edgeId,
            sourceNodeId,
            targetNodeId,
            type: "delegates_to",
            ...(relation.label?.trim() ? { label: relation.label.trim() } : {}),
            status: toExecutorEdgeStatus(relation.status),
        });
    }
    if (!hasDelegatesToRelations) {
        for (const node of topology.nodes) {
            if (toExecutorNodeStatus(node.status) !== "active")
                continue;
            for (const targetNodeId of [...new Set(node.children ?? [])]) {
                if (!activeNodeIds.has(targetNodeId)) {
                    issues.push({
                        code: "executor_topology_v2_legacy_child_skipped",
                        severity: "warning",
                        message: `Legacy child ${targetNodeId} on node ${node.id} was skipped because the target is not active.`,
                        topologyId: topology.id,
                        nodeId: node.id,
                    });
                    continue;
                }
                const edgeId = legacyChildEdgeId(node.id, targetNodeId);
                if (seenEdgeIds.has(edgeId))
                    continue;
                seenEdgeIds.add(edgeId);
                edges.push({
                    id: edgeId,
                    sourceNodeId: node.id,
                    targetNodeId,
                    type: "delegates_to",
                    status: "active",
                });
            }
        }
    }
    else {
        const hasLegacyChildren = topology.nodes.some((node) => (node.children ?? []).length > 0);
        if (hasLegacyChildren) {
            issues.push({
                code: "executor_topology_v2_legacy_children_ignored",
                severity: "info",
                message: "Legacy node.children values were ignored because delegates_to relations are the source of truth.",
                topologyId: topology.id,
            });
        }
    }
    const migrated = {
        schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
        id: topology.id,
        name: topology.displayName?.trim() || topology.name.trim() || topology.id,
        status: topology.status === "archived" ? "archived" : topology.status === "active" ? "active" : "draft",
        nodes,
        edges,
        metadata: {
            ...(sanitizeMetadataForV2(topology.metadata, {
                topologyId: topology.id,
                issues,
                path: "topology.metadata",
            }) ?? {}),
            compatibility: {
                sourceSchemaVersion: topology.schemaVersion,
                sourceEntityType: topology.entityType,
                sourceStatus: topology.status,
                enterpriseExtensionDataRemoved: true,
            },
        },
        createdAt: timestampFromEnterprise(topology.createdAt, Date.now()),
        updatedAt: timestampFromEnterprise(topology.updatedAt, Date.now()),
    };
    if (Object.keys(migrated.metadata ?? {}).length === 0) {
        delete migrated.metadata;
    }
    const validation = validateExecutorTopologyV2(migrated);
    for (const validationIssue of validation.issues) {
        issues.push({
            code: `executor_topology_v2_validation_${validationIssue.code}`,
            severity: validationIssue.severity === "error" ? "invalid" : "warning",
            message: validationIssue.message,
            topologyId: topology.id,
            ...(validationIssue.nodeId ? { nodeId: validationIssue.nodeId } : {}),
            ...(validationIssue.edgeId ? { edgeId: validationIssue.edgeId } : {}),
        });
    }
    return {
        topology: migrated,
        issues,
    };
}
export function repairExecutorTopologyV2ForPersistence(topology) {
    const issues = [];
    const repaired = structuredClone(topology);
    const topologyRecord = repaired;
    for (const field of STALE_TOPOLOGY_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(topologyRecord, field))
            continue;
        delete topologyRecord[field];
        issues.push({
            code: "executor_topology_v2_stale_topology_field_removed",
            severity: "warning",
            message: `Removed stale topology field ${field} from ExecutorTopologyV2 persistence payload.`,
            topologyId: repaired.id,
        });
    }
    const topologyMetadata = sanitizeMetadataForV2(repaired.metadata, {
        topologyId: repaired.id,
        issues,
        path: "topology.metadata",
    });
    if (topologyMetadata)
        repaired.metadata = topologyMetadata;
    else
        delete repaired.metadata;
    const nodeIds = new Set(repaired.nodes.map((node) => node.id));
    const activeNodeIds = new Set(repaired.nodes.filter((node) => node.status === "active").map((node) => node.id));
    repaired.nodes = repaired.nodes.map((node) => {
        const nodeRecord = node;
        for (const field of STALE_NODE_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(nodeRecord, field))
                continue;
            delete nodeRecord[field];
            issues.push({
                code: "executor_topology_v2_stale_node_field_removed",
                severity: "warning",
                message: `Removed stale node field ${field} from ExecutorTopologyV2 persistence payload.`,
                topologyId: repaired.id,
                nodeId: node.id,
            });
        }
        const metadata = sanitizeMetadataForV2(node.metadata, {
            topologyId: repaired.id,
            nodeId: node.id,
            issues,
            path: `node(${node.id}).metadata`,
        });
        const nextNode = { ...node };
        const definitionQuickChips = stringArray(node.definitionQuickChips);
        if (definitionQuickChips.length > 0)
            nextNode.definitionQuickChips = definitionQuickChips;
        else
            delete nextNode.definitionQuickChips;
        if (metadata)
            nextNode.metadata = metadata;
        else
            delete nextNode.metadata;
        return nextNode;
    });
    repaired.edges = repaired.edges.filter((edge) => {
        const keep = edge.type === "delegates_to" &&
            edge.sourceNodeId !== edge.targetNodeId &&
            nodeIds.has(edge.sourceNodeId) &&
            nodeIds.has(edge.targetNodeId) &&
            activeNodeIds.has(edge.sourceNodeId) &&
            activeNodeIds.has(edge.targetNodeId);
        if (!keep) {
            issues.push({
                code: "executor_topology_v2_invalid_edge_removed",
                severity: "warning",
                message: `Removed invalid edge ${edge.id} from ExecutorTopologyV2 persistence payload.`,
                topologyId: repaired.id,
                edgeId: edge.id,
            });
        }
        return keep;
    });
    return { topology: repaired, issues };
}
export function buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(topology) {
    const migration = migrateEnterpriseTopologyToExecutorTopologyV2(topology);
    const repair = repairExecutorTopologyV2ForPersistence(migration.topology);
    return {
        topology: repair.topology,
        issues: [...migration.issues, ...repair.issues],
    };
}
function enterpriseEntityStatusFromExecutorStatus(status) {
    if (status === "archived")
        return "archived";
    if (status === "draft")
        return "draft";
    return "active";
}
function enterpriseNodeMetadataFromExecutorNodeV2(node) {
    const metadata = {
        roleName: node.roleName ?? "실행자",
        executorTopologyV2: {
            schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
            nodeId: node.id,
        },
        executorGraph: {
            position: node.position,
            ...(node.definitionQuickChips?.length
                ? { definitionQuickChips: node.definitionQuickChips }
                : {}),
        },
    };
    const profile = cloneMetadataValue(node.profile);
    if (profile !== undefined)
        metadata.executorProfile = profile;
    const auditRefs = cloneMetadataValue(node.metadata?.aiSuggestionAuditRefs);
    if (auditRefs !== undefined)
        metadata.aiSuggestionAuditRefs = auditRefs;
    return metadata;
}
function enterpriseNodeFromExecutorNodeV2(node, timestamp) {
    const name = node.name.trim() || node.id;
    const description = node.description.trim() || node.instruction?.trim() || name;
    return {
        schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
        entityType: "node",
        id: node.id,
        name,
        displayName: name,
        status: enterpriseEntityStatusFromExecutorStatus(node.status),
        createdAt: timestamp,
        updatedAt: timestamp,
        nodeType: "function",
        description,
        instruction: node.instruction?.trim() || description,
        tags: [],
        children: [],
        allowedToolIds: [],
        allowedSystemIds: [],
        failurePolicy: {
            failureReportRequired: true,
            allowPartialSuccess: true,
            fallbackNodeIds: [],
        },
        recoveryPolicy: {
            retryAllowed: true,
            redelegationAllowed: true,
            fallbackAllowed: true,
            partialSuccessAllowed: true,
        },
        metadata: enterpriseNodeMetadataFromExecutorNodeV2(node),
    };
}
export function enterpriseTopologyFromExecutorTopologyV2(topology, options = {}) {
    const repair = repairExecutorTopologyV2ForPersistence(topology);
    const repaired = repair.topology;
    const timestamp = options.materializedAt ?? repaired.updatedAt;
    const activeNodeIds = new Set(repaired.nodes.filter((node) => node.status === "active").map((node) => node.id));
    const relations = repaired.edges
        .filter((edge) => edge.status === "active" &&
        activeNodeIds.has(edge.sourceNodeId) &&
        activeNodeIds.has(edge.targetNodeId))
        .map((edge) => {
        const label = edge.label?.trim() || "delegates_to";
        return {
            schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
            entityType: "relation",
            id: edge.id,
            name: label,
            displayName: label,
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
            relationType: "delegates_to",
            from: { entityType: "node", id: edge.sourceNodeId },
            to: { entityType: "node", id: edge.targetNodeId },
            label,
            metadata: {
                executorTopologyV2: {
                    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
                    edgeId: edge.id,
                    ...(options.migrationSource ? { migrationSource: options.migrationSource } : {}),
                },
            },
        };
    });
    return {
        schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
        entityType: "topology",
        id: repaired.id,
        name: repaired.name.trim() || repaired.id,
        displayName: repaired.name.trim() || repaired.id,
        status: enterpriseEntityStatusFromExecutorStatus(repaired.status),
        createdAt: repaired.createdAt,
        updatedAt: timestamp,
        description: "ExecutorTopologyV2 materialized persistence projection.",
        nodes: repaired.nodes.map((node) => enterpriseNodeFromExecutorNodeV2(node, timestamp)),
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
        relations,
        metadata: {
            executorTopologyV2: {
                schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
                sourceOfTruth: "executor_topology_v2",
                migrationSource: options.migrationSource ?? "executor_topology_v2_materialized_read_model",
                ...(options.sourceTopologyVersion !== undefined ? { sourceTopologyVersion: options.sourceTopologyVersion } : {}),
                ...(options.sourceVersionId ? { sourceVersionId: options.sourceVersionId } : {}),
            },
        },
    };
}
export function loadExecutorTopologyV2ReadModelFromRegistry(input) {
    const issues = [];
    let topologyId = input.topologyId;
    let version = input.version;
    if (!topologyId) {
        const activeRecords = input.registry.listTopologies()
            .filter((record) => record.status === "active" && record.activeVersion !== undefined)
            .sort((left, right) => left.topologyId.localeCompare(right.topologyId));
        if (activeRecords.length === 0) {
            return {
                ok: false,
                reasonCode: "active_topology_not_found",
                issues,
            };
        }
        if (activeRecords.length > 1) {
            return {
                ok: false,
                reasonCode: "multiple_active_topologies_without_selection_policy",
                issues,
            };
        }
        topologyId = activeRecords[0]?.topologyId;
        version = activeRecords[0]?.activeVersion;
    }
    if (!topologyId) {
        return {
            ok: false,
            reasonCode: "topology_not_found",
            issues,
        };
    }
    const envelope = input.registry.exportTopology(topologyId, version);
    if (!envelope) {
        return {
            ok: false,
            reasonCode: "topology_export_failed",
            issues,
        };
    }
    const readModel = buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(envelope.version.topology);
    return {
        ok: true,
        topology: readModel.topology,
        envelope,
        issues: [...issues, ...readModel.issues],
    };
}
function summarizeDryRunValue(value) {
    if (Array.isArray(value))
        return `array(${value.length})`;
    if (value === null)
        return "null";
    if (isRecord(value))
        return `object(${Object.keys(value).length})`;
    if (typeof value === "string")
        return value.length > 48 ? `${value.slice(0, 45)}...` : value;
    if (value === undefined)
        return "undefined";
    return String(value);
}
function dryRunChange(input) {
    return {
        ...input,
        destructive: input.destructive ?? false,
        approvalRequiredForPhysicalDelete: input.approvalRequiredForPhysicalDelete ?? true,
    };
}
function collectStaleMetadataDryRunChanges(input) {
    if (Array.isArray(input.value)) {
        input.value.forEach((item, index) => {
            collectStaleMetadataDryRunChanges({
                value: item,
                path: `${input.path}[${index}]`,
                changes: input.changes,
            });
        });
        return;
    }
    if (!isRecord(input.value))
        return;
    for (const [key, item] of Object.entries(input.value)) {
        const childPath = `${input.path}.${key}`;
        if (STALE_METADATA_KEYS.has(key) || key === "suggestionHistory" || key === "aiSuggestionState") {
            input.changes.push(dryRunChange({
                kind: "removed",
                category: "metadata",
                path: childPath,
                sourceField: key,
                sourceValueSummary: summarizeDryRunValue(item),
                reason: "ExecutorTopologyV2 source model does not persist projection-only metadata.",
            }));
            continue;
        }
        collectStaleMetadataDryRunChanges({ value: item, path: childPath, changes: input.changes });
    }
}
function buildExecutorTopologyV2RollbackProcedure() {
    return [
        "Stop Gateway, channel adapters, scheduler, Yeonjang, and every writer before applying rollback.",
        "Verify the backup snapshot manifest and SQLite integrity before replacing operational files.",
        "Prefer version rollback through rollbackTopologyVersion(topologyId, targetVersion) when only the active topology changed.",
        "Restore DB, memory DB, prompt sources, setup state, and prompt registry from the verified backup only after restore rehearsal passes.",
        "Restart the local stack and run topology save/reload plus one channel smoke before live traffic resumes.",
        "Do not physically delete legacy rows, run history, or trace evidence without a separate explicit administrative cleanup task.",
    ];
}
export function buildExecutorTopologyV2MigrationDryRunReport(input) {
    const sourceTopology = input.sourceTopology;
    const runtimeReadModel = input.runtimeReadModel;
    const removedFields = [];
    const transformedFields = [];
    const preservedFields = [];
    const warnings = new Set();
    if (!sourceTopology) {
        warnings.add("No source topology was loaded, so field-level migration impact could not be inspected.");
    }
    else {
        const topologyRecord = sourceTopology;
        for (const field of STALE_TOPOLOGY_FIELDS) {
            if (field === "relations")
                continue;
            if (!Object.prototype.hasOwnProperty.call(topologyRecord, field))
                continue;
            const value = topologyRecord[field];
            if (Array.isArray(value) && value.length === 0)
                continue;
            if (value === undefined)
                continue;
            removedFields.push(dryRunChange({
                kind: "removed",
                category: "topology_field",
                path: `$.${field}`,
                sourceField: field,
                sourceValueSummary: summarizeDryRunValue(value),
                reason: "Legacy enterprise topology extension data is omitted from the ExecutorTopologyV2 source read model.",
            }));
        }
        collectStaleMetadataDryRunChanges({
            value: sourceTopology.metadata,
            path: "$.metadata",
            changes: removedFields,
        });
        transformedFields.push(dryRunChange({
            kind: "transformed",
            category: "node_field",
            path: "$.nodes",
            targetPath: "$.nodes",
            sourceValueSummary: `nodes(${sourceTopology.nodes.length})`,
            targetValueSummary: `nodes(${runtimeReadModel?.nodes.length ?? 0})`,
            reason: "Enterprise nodes become ExecutorTopologyV2 executor nodes with only node identity, role, work, position, status, profile, and sanitized metadata.",
        }));
        for (const [index, node] of sourceTopology.nodes.entries()) {
            const nodePath = `$.nodes[${index}]`;
            for (const field of STALE_NODE_FIELDS) {
                const value = node[field];
                if (Array.isArray(value) && value.length === 0)
                    continue;
                if (value === undefined)
                    continue;
                removedFields.push(dryRunChange({
                    kind: "removed",
                    category: "node_field",
                    path: `${nodePath}.${field}`,
                    sourceField: field,
                    sourceValueSummary: summarizeDryRunValue(value),
                    reason: field === "children"
                        ? "Node children are not persisted as V2 source data; delegates_to edges are the source of truth."
                        : "Legacy node resource permission caches are not persisted as V2 source data.",
                }));
            }
            collectStaleMetadataDryRunChanges({
                value: node.metadata,
                path: `${nodePath}.metadata`,
                changes: removedFields,
            });
            preservedFields.push(dryRunChange({
                kind: "preserved",
                category: "node_field",
                path: nodePath,
                sourceField: "id,name,description,status",
                targetPath: `$.nodes[id=${node.id}]`,
                targetField: "id,name,description,status",
                sourceValueSummary: node.id,
                reason: "Executor identity and user-visible node definition are preserved in the V2 read model.",
                approvalRequiredForPhysicalDelete: false,
            }));
        }
        const hasDelegatesToRelations = sourceTopology.relations.some((relation) => relation.relationType === "delegates_to");
        for (const [index, relation] of sourceTopology.relations.entries()) {
            const relationPath = `$.relations[${index}]`;
            if (relation.relationType === "delegates_to") {
                transformedFields.push(dryRunChange({
                    kind: "transformed",
                    category: "relation_field",
                    path: relationPath,
                    sourceField: "delegates_to",
                    targetPath: `$.edges[id=${relationEdgeId(relation)}]`,
                    targetField: "delegates_to",
                    sourceValueSummary: `${relation.from.entityType}:${relation.from.id}->${relation.to.entityType}:${relation.to.id}`,
                    reason: "delegates_to relations become ExecutorTopologyV2 edges.",
                    approvalRequiredForPhysicalDelete: false,
                }));
                continue;
            }
            removedFields.push(dryRunChange({
                kind: "removed",
                category: "relation_field",
                path: relationPath,
                sourceField: relation.relationType,
                sourceValueSummary: `${relation.from.entityType}:${relation.from.id}->${relation.to.entityType}:${relation.to.id}`,
                reason: "Only executor delegation edges are part of the V2 source model; non-delegation enterprise relations remain in old versions as audit history.",
            }));
        }
        if (!hasDelegatesToRelations) {
            for (const [index, node] of sourceTopology.nodes.entries()) {
                for (const targetNodeId of [...new Set(node.children ?? [])]) {
                    transformedFields.push(dryRunChange({
                        kind: "transformed",
                        category: "relation_field",
                        path: `$.nodes[${index}].children`,
                        sourceField: "children",
                        targetPath: `$.edges[id=${legacyChildEdgeId(node.id, targetNodeId)}]`,
                        targetField: "delegates_to",
                        sourceValueSummary: `${node.id}->${targetNodeId}`,
                        reason: "Legacy children are used only as compatibility input when no delegates_to relation exists.",
                        approvalRequiredForPhysicalDelete: false,
                    }));
                }
            }
        }
        preservedFields.push(dryRunChange({
            kind: "preserved",
            category: "topology_field",
            path: "$",
            sourceField: "id,name,status,createdAt,updatedAt",
            targetPath: "$",
            targetField: "id,name,status,createdAt,updatedAt",
            sourceValueSummary: sourceTopology.id,
            reason: "Topology identity and visible workspace metadata are preserved.",
            approvalRequiredForPhysicalDelete: false,
        }));
    }
    for (const table of [
        "enterprise_topology_versions",
        "enterprise_topology_history",
        "compiled_topology_snapshots",
        "topology_validation_snapshots",
    ]) {
        preservedFields.push(dryRunChange({
            kind: "preserved",
            category: "history",
            path: table,
            reason: "Dry-run does not write, delete, or compact topology history tables.",
            approvalRequiredForPhysicalDelete: false,
        }));
    }
    for (const table of [
        "topology_runs",
        "topology_node_runs",
        "topology_trace_events",
        "root_runs",
        "run_events",
        "run_subsessions",
        "orchestration_events",
    ]) {
        preservedFields.push(dryRunChange({
            kind: "preserved",
            category: "runtime_trace",
            path: table,
            reason: "Runtime history and trace evidence are outside the V2 source-model cleanup boundary.",
            approvalRequiredForPhysicalDelete: false,
        }));
    }
    const validation = input.validation;
    if (validation && !validation.ok) {
        warnings.add("V2 validation failed; materialization must not run until validation errors are fixed.");
    }
    for (const issueItem of input.issues ?? []) {
        if (issueItem.severity === "invalid")
            warnings.add(issueItem.message);
    }
    const sourceDelegateEdgeCount = sourceTopology?.relations.filter((relation) => relation.relationType === "delegates_to").length ?? 0;
    const staleIssueCount = (input.issues ?? []).filter((issueItem) => issueItem.code.includes("stale")).length;
    const invalidIssueCount = (input.issues ?? []).filter((issueItem) => issueItem.severity === "invalid").length +
        (validation?.issues.filter((issueItem) => issueItem.severity === "error").length ?? 0);
    const reportTopologyId = input.topologyId ?? sourceTopology?.id;
    return {
        reportVersion: 1,
        dryRun: true,
        writePlanned: false,
        destructiveChangesPlanned: false,
        backupRequired: true,
        rollbackSupported: true,
        approvalRequiredForDestructiveChanges: true,
        ...(reportTopologyId ? { topologyId: reportTopologyId } : {}),
        ...(input.sourceVersion !== undefined ? { sourceVersion: input.sourceVersion } : {}),
        ...(input.sourceVersionId !== undefined ? { sourceVersionId: input.sourceVersionId } : {}),
        removedFields,
        transformedFields,
        preservedFields,
        warnings: [...warnings],
        rollbackProcedure: buildExecutorTopologyV2RollbackProcedure(),
        summary: {
            sourceNodeCount: sourceTopology?.nodes.length ?? 0,
            sourceDelegateEdgeCount,
            runtimeNodeCount: runtimeReadModel?.nodes.length ?? 0,
            runtimeEdgeCount: runtimeReadModel?.edges.length ?? 0,
            removedFieldCount: removedFields.length,
            transformedFieldCount: transformedFields.length,
            preservedFieldCount: preservedFields.length,
            staleIssueCount,
            invalidIssueCount,
        },
    };
}
export function previewExecutorTopologyV2RegistryMigration(input) {
    const loaded = loadExecutorTopologyV2ReadModelFromRegistry(input);
    if (!loaded.ok || !loaded.topology) {
        const validation = { ok: false, issues: [] };
        const report = buildExecutorTopologyV2MigrationDryRunReport({
            ...(input.topologyId ? { topologyId: input.topologyId } : {}),
            issues: loaded.issues,
            validation,
        });
        return {
            ok: false,
            dryRun: true,
            reasonCode: loaded.reasonCode,
            issues: loaded.issues,
            validation,
            staleIssueCount: loaded.issues.filter((issue) => issue.code.includes("stale")).length,
            invalidIssueCount: loaded.issues.filter((issue) => issue.severity === "invalid").length,
            historyPreserved: true,
            report,
        };
    }
    const validation = validateExecutorTopologyV2(loaded.topology);
    const materializedTopology = validation.ok
        ? enterpriseTopologyFromExecutorTopologyV2(loaded.topology, {
            migrationSource: input.migrationSource ?? "executor_topology_v2_materialized_read_model",
            ...(loaded.envelope?.version.version !== undefined
                ? { sourceTopologyVersion: loaded.envelope.version.version }
                : {}),
            ...(loaded.envelope?.version.versionId !== undefined
                ? { sourceVersionId: loaded.envelope.version.versionId }
                : {}),
            ...(input.materializedAt !== undefined ? { materializedAt: input.materializedAt } : {}),
        })
        : undefined;
    const topologyId = loaded.envelope?.version.topologyId ?? loaded.topology.id;
    const sourceVersion = loaded.envelope?.version.version;
    const sourceVersionId = loaded.envelope?.version.versionId;
    const report = buildExecutorTopologyV2MigrationDryRunReport({
        runtimeReadModel: loaded.topology,
        ...(loaded.envelope?.version.topology ? { sourceTopology: loaded.envelope.version.topology } : {}),
        ...(materializedTopology ? { materializedTopology } : {}),
        topologyId,
        ...(sourceVersion !== undefined ? { sourceVersion } : {}),
        ...(sourceVersionId !== undefined ? { sourceVersionId } : {}),
        issues: loaded.issues,
        validation,
    });
    return {
        ok: validation.ok,
        dryRun: true,
        ...(validation.ok ? {} : { reasonCode: "v2_validation_failed" }),
        topologyId,
        ...(sourceVersion !== undefined ? { sourceVersion } : {}),
        ...(sourceVersionId !== undefined ? { sourceVersionId } : {}),
        ...(loaded.envelope?.version.importSource !== undefined
            ? { sourceImportSource: loaded.envelope.version.importSource }
            : {}),
        runtimeReadModel: loaded.topology,
        ...(materializedTopology ? { materializedTopology } : {}),
        issues: loaded.issues,
        validation,
        staleIssueCount: loaded.issues.filter((issue) => issue.code.includes("stale")).length,
        invalidIssueCount: loaded.issues.filter((issue) => issue.severity === "invalid").length,
        historyPreserved: true,
        report,
    };
}
export function materializeExecutorTopologyV2ReadModelInRegistry(input) {
    const preview = previewExecutorTopologyV2RegistryMigration(input);
    if (!preview.ok || !preview.materializedTopology || !preview.topologyId) {
        return { ok: false, preview };
    }
    const appendResult = input.registry.appendTopologyVersion({
        topology: preview.materializedTopology,
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
        importSource: input.importSource ?? "executor_topology_v2_materialize",
    });
    const activationResult = input.registry.activateTopologyVersion(preview.topologyId, appendResult.version.version);
    return {
        ok: activationResult.ok,
        preview,
        appendResult,
        activationResult,
    };
}
export function validateExecutorTopologyV2(input) {
    const issues = [];
    if (!isRecord(input)) {
        issue(issues, {
            code: "invalid_topology_shape",
            path: "$",
            message: "ExecutorTopologyV2 must be an object.",
        });
        return { ok: false, issues };
    }
    if (input.schemaVersion !== EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION) {
        issue(issues, {
            code: "invalid_schema_version",
            path: "$.schemaVersion",
            message: "ExecutorTopologyV2 schemaVersion must be 2.",
        });
    }
    if (!nonEmptyString(input.id)) {
        issue(issues, { code: "invalid_topology_id", path: "$.id", message: "Topology id is required." });
    }
    if (!nonEmptyString(input.name)) {
        issue(issues, { code: "invalid_topology_name", path: "$.name", message: "Topology name is required." });
    }
    if (!TOPOLOGY_STATUSES.has(input.status)) {
        issue(issues, {
            code: "invalid_topology_status",
            path: "$.status",
            message: "Topology status must be draft, active, or archived.",
        });
    }
    if (!validTimestamp(input.createdAt)) {
        issue(issues, {
            code: "invalid_created_at",
            path: "$.createdAt",
            message: "createdAt must be a non-empty string or finite number.",
        });
    }
    if (!validTimestamp(input.updatedAt)) {
        issue(issues, {
            code: "invalid_updated_at",
            path: "$.updatedAt",
            message: "updatedAt must be a non-empty string or finite number.",
        });
    }
    if (input.activeVersion !== undefined && (typeof input.activeVersion !== "number" || !Number.isInteger(input.activeVersion) || input.activeVersion < 0)) {
        issue(issues, {
            code: "invalid_active_version",
            path: "$.activeVersion",
            message: "activeVersion must be a non-negative integer when provided.",
        });
    }
    for (const field of STALE_TOPOLOGY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(input, field)) {
            issue(issues, {
                code: "stale_topology_field",
                path: `$.${field}`,
                message: `${field} is not part of the ExecutorTopologyV2 source model.`,
            });
        }
    }
    validateNoStaleMetadataKeys(issues, input.metadata, "$.metadata");
    const nodes = Array.isArray(input.nodes) ? input.nodes : undefined;
    const edges = Array.isArray(input.edges) ? input.edges : undefined;
    if (!nodes) {
        issue(issues, { code: "invalid_nodes", path: "$.nodes", message: "nodes must be an array." });
    }
    if (!edges) {
        issue(issues, { code: "invalid_edges", path: "$.edges", message: "edges must be an array." });
    }
    const nodeIds = new Set();
    const nodeStatuses = new Map();
    const activeNodeNameOwners = new Map();
    if (nodes) {
        nodes.forEach((node, index) => {
            const path = `$.nodes[${index}]`;
            if (!isRecord(node)) {
                issue(issues, { code: "invalid_node_shape", path, message: "Node must be an object." });
                return;
            }
            const nodeId = nonEmptyString(node.id) ? node.id : undefined;
            if (!nodeId) {
                issue(issues, { code: "invalid_node_id", path: `${path}.id`, message: "Node id is required." });
            }
            else if (nodeIds.has(nodeId)) {
                issue(issues, {
                    code: "duplicate_node_id",
                    path: `${path}.id`,
                    message: `Duplicate node id ${nodeId}.`,
                    nodeId,
                });
            }
            else {
                nodeIds.add(nodeId);
            }
            if (nodeId && NODE_STATUSES.has(node.status)) {
                nodeStatuses.set(nodeId, node.status);
            }
            if (!nonEmptyString(node.name)) {
                issue(issues, {
                    code: "invalid_node_name",
                    path: `${path}.name`,
                    message: "Node name is required.",
                    ...(nodeId ? { nodeId } : {}),
                });
            }
            else if (nodeId && node.status === "active") {
                const normalizedName = normalizedExecutorNodeName(node.name);
                const existingNodeId = normalizedName ? activeNodeNameOwners.get(normalizedName) : undefined;
                if (normalizedName && existingNodeId && existingNodeId !== nodeId) {
                    issue(issues, {
                        code: "duplicate_node_name",
                        path: `${path}.name`,
                        message: `Duplicate active node name ${node.name.trim()}. Executor node names must be unique.`,
                        nodeId,
                    });
                }
                else if (normalizedName) {
                    activeNodeNameOwners.set(normalizedName, nodeId);
                }
            }
            if (!nonEmptyString(node.description)) {
                issue(issues, {
                    code: "invalid_node_description",
                    path: `${path}.description`,
                    message: "Node description is required.",
                    ...(nodeId ? { nodeId } : {}),
                });
            }
            if (node.definitionQuickChips !== undefined &&
                (!Array.isArray(node.definitionQuickChips) ||
                    node.definitionQuickChips.some((item) => typeof item !== "string" || !item.trim()))) {
                issue(issues, {
                    code: "invalid_node_definition_quick_chips",
                    path: `${path}.definitionQuickChips`,
                    message: "definitionQuickChips must be a non-empty string array when provided.",
                    ...(nodeId ? { nodeId } : {}),
                });
            }
            if (!NODE_STATUSES.has(node.status)) {
                issue(issues, {
                    code: "invalid_node_status",
                    path: `${path}.status`,
                    message: "Node status must be active or archived.",
                    ...(nodeId ? { nodeId } : {}),
                });
            }
            validatePosition(issues, node.position, `${path}.position`, nodeId);
            for (const field of STALE_NODE_FIELDS) {
                if (Object.prototype.hasOwnProperty.call(node, field)) {
                    issue(issues, {
                        code: "stale_node_field",
                        path: `${path}.${field}`,
                        message: `${field} is not part of the ExecutorNodeV2 source model.`,
                        ...(nodeId ? { nodeId } : {}),
                    });
                }
            }
            validateNoStaleMetadataKeys(issues, node.profile, `${path}.profile`, nodeId ? { nodeId } : {});
            validateNoStaleMetadataKeys(issues, node.metadata, `${path}.metadata`, nodeId ? { nodeId } : {});
        });
    }
    const edgeIds = new Set();
    if (edges) {
        edges.forEach((edge, index) => {
            const path = `$.edges[${index}]`;
            if (!isRecord(edge)) {
                issue(issues, { code: "invalid_edge_shape", path, message: "Edge must be an object." });
                return;
            }
            const edgeId = nonEmptyString(edge.id) ? edge.id : undefined;
            if (!edgeId) {
                issue(issues, { code: "invalid_edge_id", path: `${path}.id`, message: "Edge id is required." });
            }
            else if (edgeIds.has(edgeId)) {
                issue(issues, {
                    code: "duplicate_edge_id",
                    path: `${path}.id`,
                    message: `Duplicate edge id ${edgeId}.`,
                    edgeId,
                });
            }
            else {
                edgeIds.add(edgeId);
            }
            if (edge.type !== "delegates_to") {
                issue(issues, {
                    code: "invalid_edge_type",
                    path: `${path}.type`,
                    message: "ExecutorEdgeV2 type must be delegates_to.",
                    ...(edgeId ? { edgeId } : {}),
                });
            }
            if (!EDGE_STATUSES.has(edge.status)) {
                issue(issues, {
                    code: "invalid_edge_status",
                    path: `${path}.status`,
                    message: "Edge status must be active or archived.",
                    ...(edgeId ? { edgeId } : {}),
                });
            }
            const sourceNodeId = nonEmptyString(edge.sourceNodeId) ? edge.sourceNodeId : undefined;
            const targetNodeId = nonEmptyString(edge.targetNodeId) ? edge.targetNodeId : undefined;
            if (!sourceNodeId || !nodeIds.has(sourceNodeId)) {
                issue(issues, {
                    code: "invalid_edge_source",
                    path: `${path}.sourceNodeId`,
                    message: "Edge sourceNodeId must reference an existing node.",
                    ...(edgeId ? { edgeId } : {}),
                });
            }
            if (!targetNodeId || !nodeIds.has(targetNodeId)) {
                issue(issues, {
                    code: "invalid_edge_target",
                    path: `${path}.targetNodeId`,
                    message: "Edge targetNodeId must reference an existing node.",
                    ...(edgeId ? { edgeId } : {}),
                });
            }
            if (sourceNodeId && targetNodeId && sourceNodeId === targetNodeId) {
                issue(issues, {
                    code: "self_loop_edge",
                    path,
                    message: "ExecutorEdgeV2 cannot delegate from a node to itself.",
                    ...(edgeId ? { edgeId } : {}),
                });
            }
            if (sourceNodeId && nodeStatuses.get(sourceNodeId) === "archived") {
                issue(issues, {
                    code: "archived_edge_endpoint",
                    path: `${path}.sourceNodeId`,
                    message: "ExecutorEdgeV2 sourceNodeId cannot reference an archived node.",
                    ...(edgeId ? { edgeId } : {}),
                });
            }
            if (targetNodeId && nodeStatuses.get(targetNodeId) === "archived") {
                issue(issues, {
                    code: "archived_edge_endpoint",
                    path: `${path}.targetNodeId`,
                    message: "ExecutorEdgeV2 targetNodeId cannot reference an archived node.",
                    ...(edgeId ? { edgeId } : {}),
                });
            }
        });
    }
    return { ok: issues.every((item) => item.severity !== "error"), issues };
}
export function isExecutorTopologyV2(input) {
    return validateExecutorTopologyV2(input).ok;
}
export function buildExecutorRuntimeGraphSnapshotV2(topology) {
    const activeNodes = topology.nodes.filter((node) => node.status === "active");
    const activeNodeIds = new Set(activeNodes.map((node) => node.id));
    const activeEdges = topology.edges.filter((edge) => edge.status === "active" &&
        edge.type === "delegates_to" &&
        activeNodeIds.has(edge.sourceNodeId) &&
        activeNodeIds.has(edge.targetNodeId));
    const incoming = new Set(activeEdges.map((edge) => edge.targetNodeId));
    const rootDirectChildIds = activeNodes
        .filter((node) => !incoming.has(node.id))
        .map((node) => node.id);
    const directChildrenByNodeId = Object.fromEntries(activeNodes.map((node) => [node.id, []]));
    for (const edge of activeEdges) {
        directChildrenByNodeId[edge.sourceNodeId]?.push(edge.targetNodeId);
    }
    return {
        topologyId: topology.id,
        schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
        rootAgentId: NOBIE_ROOT_AGENT_ID,
        nodes: activeNodes,
        edges: activeEdges,
        rootDirectChildIds,
        directChildrenByNodeId,
    };
}
//# sourceMappingURL=executor-topology-v2.js.map