import { createHash } from "node:crypto";
import { getConfig } from "../config/index.js";
import { validateAgentConfig, validateTeamConfig, } from "../contracts/sub-agent-orchestration.js";
import { deleteTeamConfig, disableAgentConfig, getAgentConfig, getDb, getTeamConfig, listAgentConfigs, listAgentRelationships, listAgentTeamMemberships, listTeamConfigs, upsertAgentConfig, upsertTeamConfig, } from "../db/index.js";
import { resolveAgentCapabilityModelSummary, } from "./capability-model.js";
import { normalizeLegacyAgentConfigRow, normalizeLegacyTeamConfigRow, } from "./config-normalization.js";
import { createLegacyTopologyRegistry, legacyTopologyEnvelopeToExecutorCompatibilityEnvelope, } from "../topology/legacy-enterprise-topology-adapter.js";
export const EXECUTOR_PROFILE_SCHEMA_VERSION = 1;
export const EXECUTOR_PROFILE_METADATA_KEY = "executorProfile";
const DEFAULT_ROOT_AGENT_ID = "agent:nobie";
const COLD_REGISTRY_TARGET_P95_MS = 500;
const HOT_INDEX_TARGET_P95_MS = 100;
const TEAM_RECALCULATION_KEYS = [
    "task008.skill_mcp_binding_recalculated",
    "task009.model_state_recalculated",
];
const HOT_CAPABILITY_INDEX_CACHE = new Map();
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => Boolean(value?.trim())))];
}
function sortedUniqueStrings(values) {
    return uniqueStrings(values).sort((left, right) => left.localeCompare(right));
}
function timestampMs(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
}
function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function parseJsonObject(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return undefined;
    }
}
function parseAgentConfigRow(row) {
    const parsed = normalizeLegacyAgentConfigRow(parseJsonObject(row.config_json));
    const validation = validateAgentConfig(parsed);
    return validation.ok ? validation.value : undefined;
}
function parseTeamConfigRow(row) {
    const parsed = normalizeLegacyTeamConfigRow(parseJsonObject(row.config_json));
    const validation = validateTeamConfig(parsed);
    return validation.ok ? validation.value : undefined;
}
function subAgentFromAgentConfig(config) {
    return config.agentType === "sub_agent" ? config : undefined;
}
function rootAgentIdFromConfig(config) {
    return config.nobie?.agentId ?? DEFAULT_ROOT_AGENT_ID;
}
function runtimeConfigModelProfile(config) {
    const connection = config.ai?.connection ?? getConfig().ai.connection;
    const rawProviderId = connection.provider?.trim();
    const modelId = connection.model?.trim();
    if (!rawProviderId || !modelId)
        return undefined;
    const providerId = rawProviderId === "llama" ? "custom" : rawProviderId;
    return {
        providerId,
        modelId,
    };
}
function modelProfileNeedsRuntimeDefault(modelProfile) {
    if (!modelProfile)
        return true;
    return (!modelProfile.providerId?.trim() ||
        !modelProfile.modelId?.trim() ||
        modelProfile.providerId === "provider:unknown" ||
        modelProfile.modelId === "model:unknown");
}
function withRuntimeModelProfile(config, runtimeModelProfile) {
    if (!runtimeModelProfile || !modelProfileNeedsRuntimeDefault(config.modelProfile))
        return config;
    return {
        ...config,
        modelProfile: { ...runtimeModelProfile },
    };
}
function topologyAgentId(topologyId, executorId) {
    return `${topologyId}:${executorId}`;
}
function metadataString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function metadataStringArray(value) {
    return Array.isArray(value)
        ? value.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []))
        : [];
}
function metadataRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    return value;
}
function firstStringArray(...values) {
    for (const value of values) {
        const strings = metadataStringArray(value);
        if (strings.length > 0)
            return sortedUniqueStrings(strings);
    }
    return [];
}
export function normalizeExecutorProfile(value, fallback) {
    const record = metadataRecord(value);
    const roleName = metadataString(record?.roleName) ?? metadataString(fallback.roleName) ?? "executor";
    const definition = metadataString(record?.definition) ??
        metadataString(fallback.definition) ??
        `${fallback.displayName} executor`;
    const does = firstStringArray(record?.does, fallback.does, [definition]);
    const delegationScope = firstStringArray(record?.delegationScope, fallback.delegationScope, does);
    const expectedOutputs = firstStringArray(record?.expectedOutputs, fallback.expectedOutputs, ["처리 결과"]);
    const handoffStyle = metadataString(record?.handoffStyle) ??
        metadataString(fallback.handoffStyle) ??
        "structured_handoff";
    const declineCriteria = firstStringArray(record?.declineCriteria, fallback.declineCriteria);
    const riskBoundary = firstStringArray(record?.riskBoundary, fallback.riskBoundary);
    return {
        schemaVersion: EXECUTOR_PROFILE_SCHEMA_VERSION,
        executorId: metadataString(record?.executorId) ?? fallback.executorId,
        displayName: metadataString(record?.displayName) ?? fallback.displayName,
        roleName,
        definition,
        does,
        delegationScope,
        expectedOutputs,
        handoffStyle,
        declineCriteria,
        riskBoundary,
    };
}
function executorGraphMetadataRecord(node) {
    return metadataRecord(node.metadata?.executorGraph);
}
function executorProfileMetadataValue(node) {
    const graphMetadata = executorGraphMetadataRecord(node);
    return (node.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
        node.template?.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
        graphMetadata?.[EXECUTOR_PROFILE_METADATA_KEY]);
}
export function buildExecutorProfileFromNode(node, overrides = {}) {
    const displayName = overrides.displayName ?? node.displayName?.trim() ?? node.name.trim() ?? node.id;
    return normalizeExecutorProfile(executorProfileMetadataValue(node), {
        executorId: overrides.executorId ?? node.id,
        displayName,
        roleName: metadataString(node.metadata?.roleName) ??
            metadataString(node.metadata?.role) ??
            metadataString(node.template?.metadata?.roleName) ??
            metadataString(node.template?.metadata?.role) ??
            node.nodeType,
        definition: node.description?.trim() || node.instruction?.trim() || displayName,
        does: metadataStringArray(node.template?.metadata?.does),
        delegationScope: sortedUniqueStrings([
            ...node.tags,
            ...metadataStringArray(node.metadata?.capabilityHints),
            ...metadataStringArray(node.metadata?.inferredCapabilities),
            ...metadataStringArray(node.template?.metadata?.capabilityHints),
            ...metadataStringArray(node.template?.metadata?.inferredCapabilities),
        ]),
        expectedOutputs: [
            ...metadataStringArray(node.template?.metadata?.expectedOutputs),
            ...metadataStringArray(node.template?.metadata?.outputs),
        ],
        handoffStyle: metadataString(node.template?.metadata?.handoffStyle),
        declineCriteria: [
            ...metadataStringArray(node.metadata?.declineCriteria),
            ...metadataStringArray(node.template?.metadata?.declineCriteria),
        ],
        riskBoundary: [
            ...metadataStringArray(node.metadata?.riskBoundary),
            ...metadataStringArray(node.template?.metadata?.riskBoundary),
        ],
    });
}
function topologyAgentRole(node) {
    return buildExecutorProfileFromNode(node).roleName;
}
function topologyAgentCapabilityTags(node) {
    const profile = buildExecutorProfileFromNode(node);
    return sortedUniqueStrings([
        ...profile.delegationScope,
        ...node.tags,
        ...metadataStringArray(node.metadata?.capabilityHints),
        ...metadataStringArray(node.metadata?.inferredCapabilities),
        ...metadataStringArray(node.template?.metadata?.capabilityHints),
        ...metadataStringArray(node.template?.metadata?.inferredCapabilities),
        "topology",
        "executor",
    ]);
}
function topologySubAgentConfigs(now, runtimeModelProfile, rootAgentId) {
    const registry = createLegacyTopologyRegistry();
    return registry
        .listTopologies()
        .filter((topology) => topology.status !== "archived")
        .flatMap((topologyRecord) => {
        const exported = registry.exportTopology(topologyRecord.topologyId);
        if (!exported)
            return [];
        const adapted = legacyTopologyEnvelopeToExecutorCompatibilityEnvelope(exported);
        return adapted.envelope.version.topology.nodes
            .filter((node) => node.status !== "archived")
            .map((node) => {
            const agentId = topologyAgentId(topologyRecord.topologyId, node.id);
            const displayName = node.displayName?.trim() || node.name.trim() || node.id;
            const executorProfile = {
                ...buildExecutorProfileFromNode(node, { executorId: agentId, displayName }),
                executorId: agentId,
                displayName,
            };
            const role = executorProfile.roleName;
            const specialtyTags = sortedUniqueStrings([
                ...topologyAgentCapabilityTags(node),
                ...executorProfile.delegationScope,
            ]);
            const enabledToolNames = sortedUniqueStrings(node.allowedToolIds);
            return {
                schemaVersion: 1,
                agentType: "sub_agent",
                agentId,
                displayName,
                nickname: displayName,
                normalizedNickname: displayName.normalize("NFKC").toLowerCase(),
                status: "enabled",
                role,
                personality: executorProfile.definition,
                specialtyTags,
                avoidTasks: [...executorProfile.declineCriteria],
                ...(runtimeModelProfile ? { modelProfile: { ...runtimeModelProfile } } : {}),
                memoryPolicy: {
                    owner: { ownerType: "sub_agent", ownerId: agentId },
                    visibility: "coordinator_visible",
                    readScopes: [{ ownerType: "nobie", ownerId: rootAgentId }],
                    writeScope: { ownerType: "sub_agent", ownerId: agentId },
                    retentionPolicy: "short_term",
                    writebackReviewRequired: true,
                },
                capabilityPolicy: {
                    permissionProfile: {
                        profileId: `permission:${agentId}`,
                        riskCeiling: "dangerous",
                        approvalRequiredFrom: "sensitive",
                        allowExternalNetwork: false,
                        allowFilesystemWrite: true,
                        allowShellExecution: true,
                        allowScreenControl: false,
                        allowedPaths: [],
                    },
                    skillMcpAllowlist: {
                        enabledSkillIds: [],
                        enabledMcpServerIds: [],
                        enabledToolNames,
                        disabledToolNames: [],
                    },
                    rateLimit: { maxConcurrentCalls: 1_000_000 },
                },
                profileVersion: exported.version.version,
                createdAt: timestampMs(topologyRecord.createdAt, now),
                updatedAt: timestampMs(topologyRecord.updatedAt, now),
                teamIds: [],
                delegation: {
                    enabled: true,
                    maxParallelSessions: 1_000_000,
                },
                executorProfile,
            };
        });
    });
}
function topologyRelationRefId(relation, key) {
    const ref = relation[key];
    return ref?.entityType === "node" && typeof ref.id === "string" && ref.id.trim()
        ? ref.id
        : undefined;
}
function topologyHierarchyProjections() {
    const registry = createLegacyTopologyRegistry();
    const diagnostics = [];
    const edges = [];
    const seenEdgeIds = new Set();
    for (const topologyRecord of registry
        .listTopologies()
        .filter((topology) => topology.status !== "archived")
        .sort((a, b) => a.topologyId.localeCompare(b.topologyId))) {
        const exported = registry.exportTopology(topologyRecord.topologyId);
        if (!exported)
            continue;
        const adapted = legacyTopologyEnvelopeToExecutorCompatibilityEnvelope(exported);
        const topology = adapted.envelope.version.topology;
        const topologyVersion = adapted.envelope.version.version;
        for (const issue of adapted.issues) {
            diagnostics.push({
                code: issue.code,
                severity: issue.severity,
                message: issue.message,
                ...(issue.agentId ? { agentId: issue.agentId } : {}),
                ...(issue.parentAgentId ? { parentAgentId: issue.parentAgentId } : {}),
                ...(issue.childAgentId ? { childAgentId: issue.childAgentId } : {}),
            });
        }
        const nodesById = new Map(topology.nodes
            .filter((node) => node.status !== "archived")
            .map((node) => [node.id, node]));
        for (const relation of topology.relations) {
            if (relation.status === "archived")
                continue;
            if (relation.relationType !== "delegates_to")
                continue;
            const fromNodeId = topologyRelationRefId(relation, "from");
            const toNodeId = topologyRelationRefId(relation, "to");
            if (!fromNodeId || !toNodeId) {
                diagnostics.push({
                    code: "topology_relation_endpoint_missing",
                    severity: "invalid",
                    message: `${topologyRecord.topologyId}@${topologyVersion} relation ${relation.id} is missing a node from/to endpoint.`,
                });
                continue;
            }
            if (!nodesById.has(fromNodeId) || !nodesById.has(toNodeId)) {
                diagnostics.push({
                    code: "topology_relation_endpoint_missing",
                    severity: "invalid",
                    message: `${topologyRecord.topologyId}@${topologyVersion} relation ${relation.id} references a missing node endpoint.`,
                    parentAgentId: topologyAgentId(topologyRecord.topologyId, fromNodeId),
                    childAgentId: topologyAgentId(topologyRecord.topologyId, toNodeId),
                });
                continue;
            }
            const edgeId = `topology:${topologyRecord.topologyId}:${relation.id}`;
            if (seenEdgeIds.has(edgeId))
                continue;
            seenEdgeIds.add(edgeId);
            edges.push({
                parentAgentId: topologyAgentId(topologyRecord.topologyId, fromNodeId),
                childAgentId: topologyAgentId(topologyRecord.topologyId, toNodeId),
                edgeId,
                relationshipStatus: relation.status,
                source: "topology_relation",
                sortOrder: edges.length,
            });
        }
    }
    return { edges, diagnostics };
}
function tableFingerprint(tableName) {
    try {
        const row = getDb()
            .prepare(`SELECT COUNT(*) AS rowCount, COALESCE(MAX(updated_at), 0) AS maxUpdatedAt FROM ${tableName}`)
            .get();
        return {
            rowCount: row?.rowCount ?? 0,
            maxUpdatedAt: row?.maxUpdatedAt ?? 0,
        };
    }
    catch {
        return {
            rowCount: 0,
            maxUpdatedAt: 0,
            missing: true,
        };
    }
}
function buildInvalidationSnapshot(config, runtimeModelProfile) {
    const tables = {
        agent_configs: tableFingerprint("agent_configs"),
        team_configs: tableFingerprint("team_configs"),
        agent_team_memberships: tableFingerprint("agent_team_memberships"),
        agent_relationships: tableFingerprint("agent_relationships"),
        skill_catalog: tableFingerprint("skill_catalog"),
        mcp_server_catalog: tableFingerprint("mcp_server_catalog"),
        agent_capability_bindings: tableFingerprint("agent_capability_bindings"),
        run_subsessions: tableFingerprint("run_subsessions"),
        enterprise_topologies: tableFingerprint("enterprise_topologies"),
        enterprise_topology_versions: tableFingerprint("enterprise_topology_versions"),
    };
    const configHash = sha256(stableStringify({
        nobie: config.nobie,
        subAgents: config.subAgents ?? [],
        teams: config.teams ?? [],
        runtimeModelProfile,
    }));
    const cacheKey = sha256(stableStringify({ configHash, tables }));
    return { cacheKey, configHash, tables };
}
function safeRatio(numerator, denominator) {
    if (denominator <= 0)
        return 0;
    return Math.max(0, Math.min(1, numerator / denominator));
}
function runtimeLoadForAgent(agent) {
    const rows = getDb()
        .prepare("SELECT status, COUNT(*) AS count FROM run_subsessions WHERE agent_id = ? GROUP BY status")
        .all(agent.agentId);
    const countByStatus = new Map(rows.map((row) => [row.status, row.count]));
    const activeSubSessions = (countByStatus.get("created") ?? 0) +
        (countByStatus.get("queued") ?? 0) +
        (countByStatus.get("running") ?? 0) +
        (countByStatus.get("waiting_for_input") ?? 0) +
        (countByStatus.get("awaiting_approval") ?? 0) +
        (countByStatus.get("needs_revision") ?? 0);
    const maxParallelSessions = Math.max(1, agent.delegation.maxParallelSessions);
    return {
        activeSubSessions,
        queuedSubSessions: (countByStatus.get("created") ?? 0) + (countByStatus.get("queued") ?? 0),
        failedSubSessions: countByStatus.get("failed") ?? 0,
        completedSubSessions: countByStatus.get("completed") ?? 0,
        maxParallelSessions,
        utilization: safeRatio(activeSubSessions, maxParallelSessions),
    };
}
function failureRateForAgent(agentId, now, windowMs) {
    const windowStart = now - windowMs;
    const row = getDb()
        .prepare(`SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM run_subsessions
       WHERE agent_id = ? AND updated_at >= ? AND status IN ('completed', 'failed', 'cancelled')`)
        .get(agentId, windowStart);
    const consideredSubSessions = row?.total ?? 0;
    const failedSubSessions = row?.failed ?? 0;
    return {
        windowMs,
        consideredSubSessions,
        failedSubSessions,
        value: safeRatio(failedSubSessions, consideredSubSessions),
    };
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
function activeRelationships() {
    return listAgentRelationships({ status: "active" }).map(relationshipFromRow);
}
function agentRelationshipHierarchyProjections() {
    return activeRelationships().map((relationship) => ({
        parentAgentId: relationship.parentAgentId,
        childAgentId: relationship.childAgentId,
        edgeId: relationship.edgeId,
        relationshipStatus: relationship.status,
        source: "agent_relationship",
        sortOrder: relationship.sortOrder,
    }));
}
function directChildBlockedReasons(agent, rootAgentId, agentsById, active) {
    if (!agent)
        return ["missing_agent"];
    const reasons = [];
    if (agent.status !== "enabled")
        reasons.push(`agent_${agent.status}`);
    if (agent.agentId === rootAgentId)
        return uniqueStrings(reasons);
    const parentByChild = new Map(active.map((relationship) => [relationship.childAgentId, relationship]));
    let cursor = agent.agentId;
    const seen = new Set();
    while (cursor !== rootAgentId) {
        if (seen.has(cursor)) {
            reasons.push("cycle_detected");
            break;
        }
        seen.add(cursor);
        const relationship = parentByChild.get(cursor);
        if (!relationship) {
            reasons.push(cursor === agent.agentId ? "agent_unassigned" : "ancestor_unassigned");
            break;
        }
        const parent = agentsById.get(relationship.parentAgentId);
        if (relationship.parentAgentId !== rootAgentId && !parent)
            reasons.push("missing_ancestor");
        if (parent && relationship.parentAgentId !== rootAgentId && parent.status !== "enabled") {
            reasons.push(`ancestor_${parent.status}`);
        }
        cursor = relationship.parentAgentId;
    }
    return uniqueStrings(reasons);
}
function buildHierarchySnapshot(input) {
    const topologyProjection = topologyHierarchyProjections();
    const relationshipEdges = [
        ...agentRelationshipHierarchyProjections(),
        ...topologyProjection.edges,
    ];
    const linkedChildIds = new Set(relationshipEdges.map((relationship) => relationship.childAgentId));
    const rootFallbackEdges = [...input.agentsById.values()]
        .filter((agent) => agent.agentId !== input.rootAgentId && !linkedChildIds.has(agent.agentId))
        .map((agent, index) => ({
        parentAgentId: input.rootAgentId,
        childAgentId: agent.agentId,
        edgeId: `${agent.source}-root:${agent.agentId}`,
        relationshipStatus: "fallback",
        source: "unparented_root",
        sortOrder: index,
    }));
    const active = [...relationshipEdges, ...rootFallbackEdges];
    const directChildren = [];
    const directChildrenByParent = new Map();
    const diagnostics = [...topologyProjection.diagnostics];
    const appendDirectChild = (edge) => {
        const agent = input.agentsById.get(edge.childAgentId);
        const reasonCodes = directChildBlockedReasons(agent, input.rootAgentId, input.agentsById, active);
        const children = directChildrenByParent.get(edge.parentAgentId) ?? [];
        children.push(edge.childAgentId);
        directChildrenByParent.set(edge.parentAgentId, children);
        directChildren.push({
            parentAgentId: edge.parentAgentId,
            childAgentId: edge.childAgentId,
            edgeId: edge.edgeId,
            relationshipStatus: edge.relationshipStatus,
            source: edge.source,
            executionCandidate: reasonCodes.length === 0,
            reasonCodes,
        });
        for (const reasonCode of reasonCodes) {
            diagnostics.push({
                code: reasonCode,
                severity: reasonCode === "missing_agent" || reasonCode === "cycle_detected" ? "invalid" : "warning",
                message: `${edge.parentAgentId} direct child ${edge.childAgentId} is blocked by ${reasonCode}.`,
                parentAgentId: edge.parentAgentId,
                childAgentId: edge.childAgentId,
                agentId: edge.childAgentId,
            });
        }
    };
    for (const relationship of active.sort((left, right) => left.parentAgentId.localeCompare(right.parentAgentId) ||
        left.sortOrder - right.sortOrder ||
        left.edgeId.localeCompare(right.edgeId))) {
        appendDirectChild(relationship);
    }
    const directChildrenRecord = {};
    for (const [parentAgentId, childIds] of directChildrenByParent.entries()) {
        directChildrenRecord[parentAgentId] = sortedUniqueStrings(childIds);
    }
    const topLevelSubAgentIds = (directChildrenRecord[input.rootAgentId] ?? []).filter((agentId) => {
        const agent = input.agentsById.get(agentId);
        return agent?.status === "enabled";
    });
    return {
        rootAgentId: input.rootAgentId,
        fallbackActive: false,
        directChildrenByParent: directChildrenRecord,
        topLevelSubAgentIds,
        directChildren: directChildren.sort((left, right) => left.parentAgentId.localeCompare(right.parentAgentId) ||
            left.childAgentId.localeCompare(right.childAgentId)),
        diagnostics,
    };
}
function defaultMembershipId(teamId, agentId, index) {
    return `${teamId}:membership:${agentId}:${index}`;
}
function teamMemberships(team) {
    if (team.memberships && team.memberships.length > 0) {
        return team.memberships.map((membership, index) => ({
            ...membership,
            membershipId: membership.membershipId || defaultMembershipId(team.teamId, membership.agentId, index),
            teamId: team.teamId,
            primaryRole: membership.primaryRole || membership.teamRoles[0] || team.roleHints[index] || "member",
            teamRoles: uniqueStrings(membership.teamRoles.length > 0
                ? membership.teamRoles
                : [team.roleHints[index] ?? "member"]),
            sortOrder: membership.sortOrder ?? index,
            status: membership.status ?? "active",
        }));
    }
    return team.memberAgentIds.map((agentId, index) => {
        const primaryRole = team.roleHints[index] ?? "member";
        return {
            membershipId: defaultMembershipId(team.teamId, agentId, index),
            teamId: team.teamId,
            agentId,
            teamRoles: [primaryRole],
            primaryRole,
            required: true,
            sortOrder: index,
            status: "active",
            ...(team.ownerAgentId ? { ownerAgentIdSnapshot: team.ownerAgentId } : {}),
        };
    });
}
function coverageDimension(members, required, providerValues) {
    const providers = {};
    for (const item of required) {
        providers[item] = members
            .filter((member) => providerValues(member).includes(item))
            .map((member) => member.agentId)
            .sort((left, right) => left.localeCompare(right));
    }
    const covered = required.filter((item) => (providers[item] ?? []).length > 0);
    return {
        required,
        covered,
        missing: required.filter((item) => !covered.includes(item)),
        providers,
    };
}
function markCoverageProvidedByOwnerLead(coverage, ownerAgentId, leadAgentId) {
    if (leadAgentId !== ownerAgentId || !coverage.required.includes("lead"))
        return coverage;
    const leadProviders = sortedUniqueStrings([...(coverage.providers.lead ?? []), ownerAgentId]);
    const covered = sortedUniqueStrings([...coverage.covered, "lead"]);
    return {
        ...coverage,
        covered,
        missing: coverage.required.filter((item) => !covered.includes(item)),
        providers: {
            ...coverage.providers,
            lead: leadProviders,
        },
    };
}
function capabilityIdsForAgent(agent) {
    return sortedUniqueStrings([
        ...agent.specialtyTags,
        ...agent.capabilitySummary.enabledSkillIds,
        ...agent.capabilitySummary.enabledMcpServerIds,
        ...agent.capabilitySummary.enabledToolNames,
        agent.permissionProfile.profileId,
        agent.permissionProfile.riskCeiling,
    ]);
}
function registryDiagnostic(input) {
    return input;
}
function healthFromTeamCoverage(coverage) {
    const invalidDiagnostics = coverage.diagnostics.filter((diagnostic) => diagnostic.severity === "invalid");
    const warningDiagnostics = coverage.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    const status = invalidDiagnostics.length > 0
        ? "invalid"
        : warningDiagnostics.length > 0
            ? "degraded"
            : "healthy";
    return {
        teamId: coverage.teamId,
        status,
        executionCandidate: status === "healthy",
        activeMemberCount: coverage.activeMemberAgentIds.length,
        referenceMemberCount: coverage.referenceMemberAgentIds.length,
        unresolvedMemberCount: coverage.unresolvedMemberAgentIds.length,
        excludedMemberCount: coverage.excludedMemberAgentIds.length,
        diagnostics: coverage.diagnostics,
        coverageSummary: {
            missingRoles: coverage.roleCoverage.missing,
            missingCapabilityTags: coverage.capabilityCoverage.missing,
            recalculationKeys: coverage.recalculationKeys,
        },
    };
}
function agentEntry(config, source, now, failureWindowMs) {
    const capabilityModelSummary = resolveAgentCapabilityModelSummary(config);
    const executorProfile = config.executorProfile;
    return {
        agentId: config.agentId,
        displayName: config.displayName,
        ...(config.nickname ? { nickname: config.nickname } : {}),
        status: config.status,
        role: config.role,
        specialtyTags: [...config.specialtyTags],
        avoidTasks: [...config.avoidTasks],
        teamIds: [...config.teamIds],
        delegationEnabled: config.delegation.enabled,
        source,
        config,
        permissionProfile: config.capabilityPolicy.permissionProfile,
        capabilityPolicy: config.capabilityPolicy,
        skillMcpSummary: capabilityModelSummary.skillMcpSummary,
        capabilitySummary: capabilityModelSummary.capabilitySummary,
        modelSummary: capabilityModelSummary.modelSummary,
        degradedReasonCodes: capabilityModelSummary.degradedReasonCodes,
        currentLoad: runtimeLoadForAgent(config),
        failureRate: failureRateForAgent(config.agentId, now, failureWindowMs),
        ...(executorProfile ? { executorProfile } : {}),
    };
}
function teamEntry(config, source, activeAgentIds) {
    return {
        teamId: config.teamId,
        displayName: config.displayName,
        ...(config.nickname ? { nickname: config.nickname } : {}),
        status: config.status,
        purpose: config.purpose,
        roleHints: [...config.roleHints],
        memberAgentIds: [...config.memberAgentIds],
        activeMemberAgentIds: config.memberAgentIds.filter((agentId) => activeAgentIds.has(agentId)),
        unresolvedMemberAgentIds: config.memberAgentIds.filter((agentId) => !activeAgentIds.has(agentId)),
        source,
        config,
    };
}
function buildTeamCoverageSnapshot(input) {
    const ownerAgentId = input.team.config.ownerAgentId ?? input.rootAgentId;
    const owner = ownerAgentId === input.rootAgentId
        ? { status: "enabled" }
        : input.agentsById.get(ownerAgentId);
    const directChildIds = new Set(input.hierarchy.directChildrenByParent[ownerAgentId] ?? []);
    const diagnostics = [];
    if (input.team.status !== "enabled") {
        diagnostics.push(registryDiagnostic({
            code: "team_unavailable",
            severity: "invalid",
            message: `Team ${input.team.teamId} is ${input.team.status}.`,
            teamId: input.team.teamId,
            parentAgentId: ownerAgentId,
        }));
    }
    if (!owner) {
        diagnostics.push(registryDiagnostic({
            code: "team_owner_missing",
            severity: "invalid",
            message: `Team owner ${ownerAgentId} is not defined.`,
            teamId: input.team.teamId,
            parentAgentId: ownerAgentId,
        }));
    }
    else if (owner.status !== "enabled") {
        diagnostics.push(registryDiagnostic({
            code: "team_owner_unavailable",
            severity: "invalid",
            message: `Team owner ${ownerAgentId} is ${owner.status}.`,
            teamId: input.team.teamId,
            parentAgentId: ownerAgentId,
        }));
    }
    const members = teamMemberships(input.team.config).map((membership) => {
        const agent = input.agentsById.get(membership.agentId);
        const reasonCodes = [];
        const directChild = directChildIds.has(membership.agentId);
        if (!agent)
            reasonCodes.push("member_agent_missing");
        if (membership.status === "removed")
            reasonCodes.push("membership_removed");
        if (membership.status === "inactive")
            reasonCodes.push("membership_inactive");
        if (!directChild)
            reasonCodes.push("owner_direct_child_required");
        if (owner && owner.status !== "enabled")
            reasonCodes.push("team_owner_unavailable");
        if (agent?.status && agent.status !== "enabled")
            reasonCodes.push(`member_${agent.status}`);
        if (agent && !agent.delegationEnabled)
            reasonCodes.push("delegation_disabled");
        if (agent && agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions) {
            reasonCodes.push("member_overloaded");
        }
        if (agent?.modelSummary.availability === "unavailable") {
            reasonCodes.push("member_model_unavailable");
        }
        else if (agent?.modelSummary.availability === "degraded") {
            reasonCodes.push("member_model_degraded");
        }
        if (agent?.capabilitySummary.disabledSkillIds.length) {
            reasonCodes.push("member_skill_binding_unavailable");
        }
        if (agent?.capabilitySummary.disabledMcpServerIds.length) {
            reasonCodes.push("member_mcp_binding_unavailable");
        }
        if (agent?.capabilitySummary.availability === "unavailable") {
            reasonCodes.push("member_capability_unavailable");
        }
        const blockingReasons = reasonCodes.filter((reasonCode) => reasonCode !== "member_model_degraded");
        const active = membership.status === "active" &&
            input.team.status === "enabled" &&
            owner?.status === "enabled" &&
            agent?.status === "enabled" &&
            directChild &&
            blockingReasons.length === 0;
        let executionState = "excluded";
        if (!agent)
            executionState = "unresolved";
        else if (!directChild)
            executionState = "reference";
        else if (membership.status === "fallback_only")
            executionState = "fallback";
        else if (active)
            executionState = "active";
        return {
            agentId: membership.agentId,
            membershipId: membership.membershipId,
            primaryRole: membership.primaryRole,
            teamRoles: [...membership.teamRoles],
            required: membership.required,
            executionState,
            directChild,
            active,
            reasonCodes: uniqueStrings(reasonCodes),
            specialtyTags: agent?.specialtyTags ?? [],
            capabilityIds: agent ? capabilityIdsForAgent(agent) : [],
            ...(agent?.modelSummary.availability
                ? { modelAvailability: agent.modelSummary.availability }
                : {}),
            ...(agent?.capabilitySummary.availability
                ? { capabilityAvailability: agent.capabilitySummary.availability }
                : {}),
        };
    });
    for (const member of members) {
        for (const reasonCode of member.reasonCodes) {
            diagnostics.push({
                code: reasonCode,
                severity: reasonCode === "member_agent_missing" ||
                    reasonCode === "team_owner_unavailable" ||
                    reasonCode === "member_archived"
                    ? "invalid"
                    : "warning",
                message: `${member.agentId} is not an active team execution member because of ${reasonCode}.`,
                teamId: input.team.teamId,
                agentId: member.agentId,
                parentAgentId: ownerAgentId,
            });
        }
    }
    const activeMembers = members.filter((member) => member.active);
    const requiredRoles = sortedUniqueStrings(input.team.config.requiredTeamRoles ?? []);
    const requiredCapabilities = sortedUniqueStrings(input.team.config.requiredCapabilityTags ?? []);
    const roleCoverage = markCoverageProvidedByOwnerLead(coverageDimension(activeMembers, requiredRoles, (member) => [
        member.primaryRole,
        ...member.teamRoles,
    ]), ownerAgentId, input.team.config.leadAgentId);
    const capabilityCoverage = coverageDimension(activeMembers, requiredCapabilities, (member) => member.capabilityIds);
    const roleTagOnlyMembers = members.filter((member) => {
        const agent = input.agentsById.get(member.agentId);
        return (member.directChild &&
            input.team.status === "enabled" &&
            owner?.status === "enabled" &&
            membershipActiveForCoverage(input.team.config, member.agentId) &&
            agent?.status === "enabled");
    });
    const tagOnlyCapabilityCoverage = coverageDimension(roleTagOnlyMembers, requiredCapabilities, (member) => member.specialtyTags);
    if (activeMembers.length === 0) {
        diagnostics.push({
            code: "no_active_team_members",
            severity: "invalid",
            message: "Team has no active owner-direct-child members.",
            teamId: input.team.teamId,
            parentAgentId: ownerAgentId,
        });
    }
    if (input.team.config.leadAgentId &&
        input.team.config.leadAgentId !== ownerAgentId &&
        !activeMembers.some((member) => member.agentId === input.team.config.leadAgentId)) {
        diagnostics.push({
            code: "lead_not_active_member",
            severity: "invalid",
            message: `Team lead ${input.team.config.leadAgentId} is not an active member.`,
            teamId: input.team.teamId,
            agentId: input.team.config.leadAgentId,
            parentAgentId: ownerAgentId,
        });
    }
    if (roleCoverage.missing.length > 0) {
        diagnostics.push({
            code: "required_role_missing",
            severity: "warning",
            message: `Missing required team roles: ${roleCoverage.missing.join(", ")}.`,
            teamId: input.team.teamId,
            parentAgentId: ownerAgentId,
        });
    }
    if (capabilityCoverage.missing.length > 0) {
        diagnostics.push({
            code: "required_capability_missing",
            severity: "warning",
            message: `Missing required capability tags: ${capabilityCoverage.missing.join(", ")}.`,
            teamId: input.team.teamId,
            parentAgentId: ownerAgentId,
        });
    }
    if (tagOnlyCapabilityCoverage.missing.length < capabilityCoverage.missing.length) {
        diagnostics.push({
            code: "coverage_recalculated_conservative",
            severity: "warning",
            message: "Role/tag-only team coverage was reduced after capability and model summaries were applied.",
            teamId: input.team.teamId,
            parentAgentId: ownerAgentId,
        });
    }
    const coverageWithoutHealth = {
        teamId: input.team.teamId,
        ownerAgentId,
        ...(input.team.config.leadAgentId ? { leadAgentId: input.team.config.leadAgentId } : {}),
        generatedAt: input.generatedAt,
        executionCandidate: false,
        activeMemberAgentIds: activeMembers.map((member) => member.agentId),
        referenceMemberAgentIds: members
            .filter((member) => member.executionState === "reference")
            .map((member) => member.agentId),
        unresolvedMemberAgentIds: members
            .filter((member) => member.executionState === "unresolved")
            .map((member) => member.agentId),
        excludedMemberAgentIds: members
            .filter((member) => member.executionState === "excluded")
            .map((member) => member.agentId),
        members,
        roleCoverage,
        capabilityCoverage,
        diagnostics,
        recalculationKeys: [...TEAM_RECALCULATION_KEYS],
    };
    const health = healthFromTeamCoverage(coverageWithoutHealth);
    return {
        ...coverageWithoutHealth,
        executionCandidate: health.status === "healthy",
    };
}
function membershipActiveForCoverage(team, agentId) {
    return teamMemberships(team).some((membership) => membership.agentId === agentId && membership.status === "active");
}
function attachTeamCoverage(input) {
    return input.teams.map((team) => {
        const coverage = buildTeamCoverageSnapshot({
            team,
            generatedAt: input.generatedAt,
            rootAgentId: input.rootAgentId,
            agentsById: input.agentsById,
            hierarchy: input.hierarchy,
        });
        return {
            ...team,
            coverage,
            health: healthFromTeamCoverage(coverage),
        };
    });
}
function candidateReasonCodes(agent) {
    if (!agent)
        return ["missing_agent"];
    const reasons = [];
    if (agent.status !== "enabled")
        reasons.push(`agent_${agent.status}`);
    if (!agent.delegationEnabled)
        reasons.push("delegation_disabled");
    if (agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions) {
        reasons.push("concurrency_limit_reached");
    }
    if (!agent.permissionProfile?.profileId)
        reasons.push("permission_missing");
    if (agent.capabilitySummary.availability === "unavailable" ||
        agent.capabilitySummary.disabledSkillIds.length > 0 ||
        agent.capabilitySummary.disabledMcpServerIds.length > 0) {
        reasons.push("capability_unavailable");
    }
    else if (agent.capabilitySummary.availability === "degraded") {
        reasons.push("capability_degraded");
    }
    if (agent.modelSummary.availability === "unavailable")
        reasons.push("model_unavailable");
    else if (agent.modelSummary.availability === "degraded")
        reasons.push("model_degraded");
    return uniqueStrings(reasons);
}
function buildAgentCapabilityIndex(input) {
    const cached = HOT_CAPABILITY_INDEX_CACHE.get(input.invalidation.cacheKey);
    if (cached)
        return cached;
    const startedAt = input.clock();
    const agentsById = new Map(input.agents.map((agent) => [agent.agentId, agent]));
    const candidateAgentIdsByParent = {};
    const excludedCandidatesByParent = {};
    const candidatesByAgentId = {};
    const diagnostics = [];
    for (const [parentAgentId, childAgentIds] of Object.entries(input.hierarchy.directChildrenByParent).sort(([left], [right]) => left.localeCompare(right))) {
        candidateAgentIdsByParent[parentAgentId] = [];
        excludedCandidatesByParent[parentAgentId] = [];
        for (const agentId of childAgentIds) {
            const agent = agentsById.get(agentId);
            const reasonCodes = candidateReasonCodes(agent);
            const candidate = {
                parentAgentId,
                agentId,
                eligible: reasonCodes.length === 0,
                reasonCodes,
                specialtyTags: agent?.specialtyTags ?? [],
                enabledSkillIds: agent?.capabilitySummary.enabledSkillIds ?? [],
                enabledMcpServerIds: agent?.capabilitySummary.enabledMcpServerIds ?? [],
                enabledToolNames: agent?.capabilitySummary.enabledToolNames ?? [],
                modelAvailability: agent?.modelSummary.availability ?? "unavailable",
                capabilityAvailability: agent?.capabilitySummary.availability ?? "unavailable",
                load: agent?.currentLoad ?? {
                    activeSubSessions: 0,
                    queuedSubSessions: 0,
                    failedSubSessions: 0,
                    completedSubSessions: 0,
                    maxParallelSessions: 1,
                    utilization: 0,
                },
                failureRate: agent?.failureRate ?? {
                    windowMs: 0,
                    consideredSubSessions: 0,
                    failedSubSessions: 0,
                    value: 0,
                },
            };
            const byAgent = candidatesByAgentId[agentId] ?? [];
            byAgent.push(candidate);
            candidatesByAgentId[agentId] = byAgent;
            if (candidate.eligible)
                candidateAgentIdsByParent[parentAgentId]?.push(agentId);
            else {
                excludedCandidatesByParent[parentAgentId]?.push({ agentId, reasonCodes });
                diagnostics.push({
                    code: "candidate_excluded",
                    severity: "warning",
                    message: `${agentId} is excluded for parent ${parentAgentId}: ${reasonCodes.join(", ")}.`,
                    parentAgentId,
                    agentId,
                });
                for (const reasonCode of reasonCodes) {
                    diagnostics.push({
                        code: reasonCode,
                        severity: reasonCode === "missing_agent" ? "invalid" : "warning",
                        message: `${agentId} is excluded for parent ${parentAgentId} by ${reasonCode}.`,
                        parentAgentId,
                        agentId,
                    });
                }
            }
        }
    }
    for (const parentAgentId of Object.keys(candidateAgentIdsByParent)) {
        candidateAgentIdsByParent[parentAgentId] = sortedUniqueStrings(candidateAgentIdsByParent[parentAgentId] ?? []);
        excludedCandidatesByParent[parentAgentId] = [
            ...(excludedCandidatesByParent[parentAgentId] ?? []),
        ].sort((left, right) => left.agentId.localeCompare(right.agentId));
    }
    const index = {
        generatedAt: input.generatedAt,
        cacheKey: input.invalidation.cacheKey,
        rootAgentId: input.rootAgentId,
        topLevelCandidateAgentIds: candidateAgentIdsByParent[input.rootAgentId] ?? [],
        directChildAgentIdsByParent: input.hierarchy.directChildrenByParent,
        candidateAgentIdsByParent,
        excludedCandidatesByParent,
        candidatesByAgentId,
        diagnostics,
        metrics: {
            buildLatencyMs: Math.max(0, input.clock() - startedAt),
            targetP95Ms: HOT_INDEX_TARGET_P95_MS,
        },
    };
    HOT_CAPABILITY_INDEX_CACHE.set(input.invalidation.cacheKey, index);
    return index;
}
function buildOrchestrationRegistrySnapshotUnsafe(input) {
    const cfg = input.dependencies.getConfig?.() ?? getConfig();
    const now = input.startedAt;
    const failureWindowMs = input.dependencies.failureWindowMs ?? 7 * 24 * 60 * 60 * 1000;
    const diagnostics = [];
    const agentsById = new Map();
    const teamsById = new Map();
    const rootAgentId = rootAgentIdFromConfig(cfg.orchestration);
    const inheritedModelProfile = runtimeConfigModelProfile(cfg);
    const invalidation = buildInvalidationSnapshot(cfg.orchestration, inheritedModelProfile);
    const archivedAgentIds = new Set(listAgentConfigs({ includeArchived: true, agentType: "sub_agent" })
        .filter((row) => row.status === "archived")
        .map((row) => row.agent_id));
    const archivedTeamIds = new Set(listTeamConfigs({ includeArchived: true })
        .filter((row) => row.status === "archived")
        .map((row) => row.team_id));
    for (const agent of cfg.orchestration.subAgents ?? []) {
        if (archivedAgentIds.has(agent.agentId))
            continue;
        const runtimeAgent = withRuntimeModelProfile(agent, inheritedModelProfile);
        agentsById.set(runtimeAgent.agentId, agentEntry(runtimeAgent, "config", now, failureWindowMs));
    }
    for (const row of listAgentConfigs({ includeArchived: false, agentType: "sub_agent" })) {
        const config = parseAgentConfigRow(row);
        const subAgent = config ? subAgentFromAgentConfig(config) : undefined;
        if (!subAgent) {
            diagnostics.push({
                code: "invalid_agent_config_row",
                severity: "invalid",
                message: `agent_configs row ${row.agent_id} could not be parsed.`,
                agentId: row.agent_id,
            });
            continue;
        }
        const runtimeAgent = withRuntimeModelProfile(subAgent, inheritedModelProfile);
        agentsById.set(runtimeAgent.agentId, agentEntry(runtimeAgent, "db", now, failureWindowMs));
    }
    for (const topologyAgent of topologySubAgentConfigs(now, inheritedModelProfile, rootAgentId)) {
        if (archivedAgentIds.has(topologyAgent.agentId))
            continue;
        agentsById.set(topologyAgent.agentId, agentEntry(topologyAgent, "topology", now, failureWindowMs));
    }
    for (const team of cfg.orchestration.teams ?? []) {
        if (archivedTeamIds.has(team.teamId))
            continue;
        teamsById.set(team.teamId, { ...team, source: "config" });
    }
    for (const row of listTeamConfigs({ includeArchived: false })) {
        const config = parseTeamConfigRow(row);
        if (!config) {
            diagnostics.push({
                code: "invalid_team_config_row",
                severity: "invalid",
                message: `team_configs row ${row.team_id} could not be parsed.`,
                teamId: row.team_id,
            });
            continue;
        }
        teamsById.set(config.teamId, { ...config, source: "db" });
    }
    const hierarchy = buildHierarchySnapshot({ rootAgentId, agentsById });
    diagnostics.push(...hierarchy.diagnostics);
    const activeAgentIds = new Set([...agentsById.values()]
        .filter((agent) => agent.status === "enabled" && agent.delegationEnabled)
        .map((agent) => agent.agentId));
    const teamsWithoutCoverage = [...teamsById.values()]
        .map((team) => teamEntry(team, team.source, activeAgentIds))
        .sort((a, b) => a.teamId.localeCompare(b.teamId));
    const teams = attachTeamCoverage({
        teams: teamsWithoutCoverage,
        generatedAt: now,
        rootAgentId,
        agentsById,
        hierarchy,
    });
    const membershipEdges = listAgentTeamMemberships()
        .filter((membership) => membership.status === "active" || membership.status === "unresolved")
        .map((membership) => ({
        teamId: membership.team_id,
        agentId: membership.agent_id,
        status: membership.status,
        ...(membership.role_hint ? { roleHint: membership.role_hint } : {}),
    }));
    for (const team of teams) {
        for (const agentId of team.memberAgentIds) {
            if (!agentsById.has(agentId)) {
                diagnostics.push({
                    code: "unresolved_team_member",
                    severity: "warning",
                    message: `${team.teamId} references missing agent ${agentId}.`,
                    teamId: team.teamId,
                    agentId,
                });
            }
        }
        diagnostics.push(...(team.coverage?.diagnostics ?? []));
    }
    for (const agent of agentsById.values()) {
        for (const reasonCode of agent.degradedReasonCodes) {
            diagnostics.push({
                code: reasonCode,
                severity: "warning",
                message: `${agent.agentId} has capability/model diagnostic ${reasonCode}.`,
                agentId: agent.agentId,
            });
        }
    }
    const agents = [...agentsById.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
    const capabilityIndex = buildAgentCapabilityIndex({
        generatedAt: now,
        rootAgentId,
        agents,
        hierarchy,
        invalidation,
        clock: input.clock,
    });
    diagnostics.push(...capabilityIndex.diagnostics);
    return {
        status: "ready",
        generatedAt: now,
        agents,
        teams,
        hierarchy,
        capabilityIndex,
        invalidation,
        metrics: {
            buildLatencyMs: Math.max(0, input.clock() - input.startedAt),
            coldSnapshotTargetP95Ms: COLD_REGISTRY_TARGET_P95_MS,
            hotIndexTargetP95Ms: HOT_INDEX_TARGET_P95_MS,
        },
        membershipEdges,
        diagnostics,
    };
}
function fallbackRegistrySnapshot(input) {
    const detail = input.error instanceof Error ? input.error.message : String(input.error);
    const invalidation = {
        cacheKey: sha256(`registry_load_failed:${detail}`),
        configHash: sha256("registry_load_failed"),
        tables: {},
    };
    const hierarchy = {
        rootAgentId: DEFAULT_ROOT_AGENT_ID,
        fallbackActive: true,
        directChildrenByParent: {},
        topLevelSubAgentIds: [],
        directChildren: [],
        diagnostics: [],
    };
    const capabilityIndex = buildAgentCapabilityIndex({
        generatedAt: input.generatedAt,
        rootAgentId: DEFAULT_ROOT_AGENT_ID,
        agents: [],
        hierarchy,
        invalidation,
        clock: () => input.generatedAt,
    });
    return {
        status: "degraded",
        generatedAt: input.generatedAt,
        agents: [],
        teams: [],
        hierarchy,
        capabilityIndex,
        invalidation,
        metrics: {
            buildLatencyMs: input.buildLatencyMs,
            coldSnapshotTargetP95Ms: COLD_REGISTRY_TARGET_P95_MS,
            hotIndexTargetP95Ms: HOT_INDEX_TARGET_P95_MS,
        },
        fallback: {
            mode: "single_nobie",
            reasonCode: "registry_load_failed",
            reason: `Registry snapshot failed and fell back to single Nobie mode: ${detail}`,
        },
        membershipEdges: [],
        diagnostics: [
            {
                code: "registry_load_failed",
                severity: "invalid",
                message: `Registry snapshot failed: ${detail}`,
            },
        ],
    };
}
export function clearAgentCapabilityIndexCache() {
    HOT_CAPABILITY_INDEX_CACHE.clear();
}
export function buildOrchestrationRegistrySnapshot(dependencies = {}) {
    const clock = dependencies.now ?? (() => Date.now());
    const startedAt = clock();
    try {
        return buildOrchestrationRegistrySnapshotUnsafe({ dependencies, startedAt, clock });
    }
    catch (error) {
        return fallbackRegistrySnapshot({
            error,
            generatedAt: startedAt,
            buildLatencyMs: Math.max(0, clock() - startedAt),
        });
    }
}
export function createAgentRegistryService(dependencies = {}) {
    const now = () => dependencies.now?.() ?? Date.now();
    return {
        get(agentId) {
            const row = getAgentConfig(agentId);
            return row ? parseAgentConfigRow(row) : undefined;
        },
        list() {
            return listAgentConfigs({ includeArchived: true })
                .map(parseAgentConfigRow)
                .filter((config) => config != null);
        },
        snapshot() {
            return buildOrchestrationRegistrySnapshot(dependencies);
        },
        createOrUpdate(input, options = {}) {
            upsertAgentConfig(input, { ...options, now: options.now ?? now() });
        },
        disable(agentId) {
            return disableAgentConfig(agentId, now());
        },
        archive(agentId) {
            const current = this.get(agentId);
            if (!current)
                return false;
            upsertAgentConfig({ ...current, status: "archived", updatedAt: now() }, {
                source: "manual",
                now: now(),
            });
            return true;
        },
    };
}
export function createTeamRegistryService(dependencies = {}) {
    const now = () => dependencies.now?.() ?? Date.now();
    return {
        get(teamId) {
            const row = getTeamConfig(teamId);
            return row ? parseTeamConfigRow(row) : undefined;
        },
        list() {
            return listTeamConfigs({ includeArchived: true })
                .map(parseTeamConfigRow)
                .filter((config) => config != null);
        },
        snapshot() {
            return buildOrchestrationRegistrySnapshot(dependencies);
        },
        createOrUpdate(input, options = {}) {
            upsertTeamConfig(input, { ...options, now: options.now ?? now() });
        },
        disable(teamId) {
            const current = this.get(teamId);
            if (!current)
                return false;
            upsertTeamConfig({ ...current, status: "disabled", updatedAt: now() }, { source: "manual", now: now() });
            return true;
        },
        archive(teamId) {
            const current = this.get(teamId);
            if (!current)
                return false;
            upsertTeamConfig({ ...current, status: "archived", updatedAt: now() }, { source: "manual", now: now() });
            return true;
        },
        delete(teamId) {
            return deleteTeamConfig(teamId);
        },
    };
}
//# sourceMappingURL=registry.js.map