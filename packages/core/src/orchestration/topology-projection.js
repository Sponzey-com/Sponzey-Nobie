import { redactUiValue } from "../ui/redaction.js";
import { createAgentHierarchyService, } from "./hierarchy.js";
import { createAgentRegistryService, } from "./registry.js";
const PRIVATE_MEMORY_PATTERN = /[^\n.]*private raw memory[^\n.]*/giu;
function safeJsonValue(value) {
    if (value == null)
        return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value))
        return value.map(safeJsonValue);
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            safeJsonValue(item),
        ]));
    }
    return String(value);
}
function redactedText(value, fallback = "") {
    const raw = typeof value === "string" ? value : fallback;
    const redacted = redactUiValue(raw, { audience: "advanced" }).value.replace(PRIVATE_MEMORY_PATTERN, "[private memory redacted]");
    return redacted.length > 700 ? `${redacted.slice(0, 697)}...` : redacted;
}
function redactedStrings(values) {
    return (values ?? []).map((value) => redactedText(value)).filter((value) => value.length > 0);
}
function scopeLabel(scope) {
    if (!scope)
        return "unknown";
    return redactedText(`${scope.ownerType}:${scope.ownerId}`);
}
function uniqueSorted(values) {
    return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
function slug(value) {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/gu, "-")
        .replace(/^-+|-+$/gu, "");
    return normalized || "role";
}
function agentNodeId(agentId) {
    return `agent:${agentId}`;
}
function teamNodeId(teamId) {
    return `team:${teamId}`;
}
function roleNodeId(teamId, agentId, primaryRole) {
    return `team-role:${teamId}:${agentId}:${slug(primaryRole)}`;
}
function leadNodeId(teamId, agentId) {
    return `team-lead:${teamId}:${agentId}`;
}
function emptyCoverageDimension() {
    return {
        required: [],
        covered: [],
        missing: [],
        providers: {},
    };
}
function nodePosition(nodeId, generated, layout) {
    const saved = layout.nodes[nodeId];
    if (!saved)
        return generated;
    return {
        x: saved.x,
        y: saved.y,
        ...(saved.collapsed === undefined ? {} : { collapsed: saved.collapsed }),
    };
}
function diagnosticSeverity(value) {
    if (value === "blocked" || value === "invalid")
        return value;
    if (value === "warning")
        return "warning";
    return "info";
}
function hierarchyDiagnostic(diagnostic) {
    return {
        reasonCode: diagnostic.reasonCode,
        severity: diagnosticSeverity(diagnostic.severity),
        message: redactedText(diagnostic.message),
        ...(diagnostic.edgeId ? { edgeId: diagnostic.edgeId } : {}),
        ...(diagnostic.parentAgentId ? { parentAgentId: diagnostic.parentAgentId } : {}),
        ...(diagnostic.childAgentId ? { childAgentId: diagnostic.childAgentId } : {}),
        ...(diagnostic.childAgentId ? { agentId: diagnostic.childAgentId } : {}),
    };
}
function registryDiagnostic(diagnostic) {
    return {
        reasonCode: diagnostic.code,
        severity: diagnosticSeverity(diagnostic.severity),
        message: redactedText(diagnostic.message),
        ...(diagnostic.agentId ? { agentId: diagnostic.agentId } : {}),
        ...(diagnostic.teamId ? { teamId: diagnostic.teamId } : {}),
        ...(diagnostic.parentAgentId ? { parentAgentId: diagnostic.parentAgentId } : {}),
        ...(diagnostic.childAgentId ? { childAgentId: diagnostic.childAgentId } : {}),
    };
}
function nodeMetadata(node) {
    return (node.metadata ?? {});
}
function numberMetadata(node, key) {
    const value = nodeMetadata(node)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function stringMetadata(node, key) {
    const value = nodeMetadata(node)[key];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function booleanMetadata(node, key) {
    const value = nodeMetadata(node)[key];
    return typeof value === "boolean" ? value : undefined;
}
function defaultAgentPosition(node, index) {
    const depth = numberMetadata(node, "depth") ?? (node.entityType === "nobie" ? 0 : 1);
    const row = Number.isFinite(depth) ? index : index + 1;
    return {
        x: 80 + Math.max(0, depth) * 280,
        y: 80 + row * 132,
    };
}
function agentTopologyNode(input) {
    const kind = input.node.entityType === "nobie" ? "nobie" : "sub_agent";
    const metadata = nodeMetadata(input.node);
    const badges = [kind === "nobie" ? "Nobie" : "SubAgent"];
    if (metadata.topLevel === true)
        badges.push("top-level");
    if (metadata.executionCandidate === true)
        badges.push("candidate");
    const blockedReason = stringMetadata(input.node, "blockedReason");
    if (blockedReason)
        badges.push(blockedReason);
    const id = input.node.nodeId;
    return {
        id,
        kind,
        entityId: input.node.entityId,
        label: redactedText(input.node.label, input.node.entityId),
        ...(input.node.status ? { status: String(input.node.status) } : {}),
        position: nodePosition(id, defaultAgentPosition(input.node, input.index), input.layout),
        badges,
        data: {
            entityType: input.node.entityType,
            source: safeJsonValue(metadata.source),
            depth: safeJsonValue(metadata.depth),
            root: safeJsonValue(metadata.root),
            topLevel: safeJsonValue(metadata.topLevel),
            executionCandidate: safeJsonValue(metadata.executionCandidate),
            ...(blockedReason ? { blockedReason } : {}),
        },
        diagnostics: input.diagnostics,
    };
}
function teamMemberships(team) {
    if (Array.isArray(team.memberships) && team.memberships.length > 0) {
        return team.memberships.map((membership, index) => ({
            ...membership,
            membershipId: membership.membershipId || `${team.teamId}:membership:${membership.agentId}:${index}`,
            teamId: team.teamId,
            primaryRole: membership.primaryRole || membership.teamRoles[0] || team.roleHints[index] || "member",
            teamRoles: uniqueSorted(membership.teamRoles.length > 0
                ? membership.teamRoles
                : [team.roleHints[index] ?? "member"]),
            sortOrder: membership.sortOrder ?? index,
            status: membership.status ?? "active",
        }));
    }
    return team.memberAgentIds.map((agentId, index) => {
        const primaryRole = team.roleHints[index] ?? "member";
        return {
            membershipId: `${team.teamId}:membership:${agentId}:${index}`,
            teamId: team.teamId,
            agentId,
            ...(team.ownerAgentId ? { ownerAgentIdSnapshot: team.ownerAgentId } : {}),
            teamRoles: [primaryRole],
            primaryRole,
            required: true,
            sortOrder: index,
            status: "active",
        };
    });
}
function buildAgentInspector(input) {
    const agent = input.agent;
    const config = agent?.config;
    const memory = config?.memoryPolicy;
    const allowlist = agent?.skillMcpSummary;
    const delegation = config?.delegationPolicy ?? config?.delegation;
    const permission = agent?.permissionProfile;
    const modelProfile = config?.modelProfile;
    return {
        agentId: input.node.entityId,
        nodeId: input.node.nodeId,
        kind: input.node.entityType === "nobie" ? "nobie" : "sub_agent",
        displayName: redactedText(agent?.displayName ?? input.node.label, input.node.entityId),
        ...(agent?.nickname ? { nickname: redactedText(agent.nickname) } : {}),
        status: redactedText(agent?.status ?? input.node.status ?? "unknown"),
        role: redactedText(agent?.role ?? "coordinator"),
        specialtyTags: redactedStrings(agent?.specialtyTags),
        teamIds: redactedStrings(agent?.teamIds),
        source: agent?.source ?? "synthetic",
        model: {
            ...(modelProfile?.providerId ? { providerId: redactedText(modelProfile.providerId) } : {}),
            ...(modelProfile?.modelId ? { modelId: redactedText(modelProfile.modelId) } : {}),
            ...(modelProfile?.fallbackModelId
                ? { fallbackModelId: redactedText(modelProfile.fallbackModelId) }
                : {}),
            ...(agent?.modelSummary.availability
                ? { availability: agent.modelSummary.availability }
                : {}),
            reasonCodes: redactedStrings(agent?.degradedReasonCodes),
        },
        skillMcp: {
            enabledSkillIds: redactedStrings(allowlist?.enabledSkillIds),
            enabledMcpServerIds: redactedStrings(allowlist?.enabledMcpServerIds),
            enabledToolNames: redactedStrings(allowlist?.enabledToolNames),
            disabledToolNames: redactedStrings(allowlist?.disabledToolNames),
            secretScope: agent?.capabilityPolicy.skillMcpAllowlist.secretScopeId ? "configured" : "none",
        },
        tools: {
            enabledCount: allowlist?.enabledToolNames.length ?? 0,
            disabledCount: allowlist?.disabledToolNames.length ?? 0,
            enabledToolNames: redactedStrings(allowlist?.enabledToolNames),
            disabledToolNames: redactedStrings(allowlist?.disabledToolNames),
        },
        memory: {
            owner: scopeLabel(memory?.owner),
            visibility: memory?.visibility ?? "unknown",
            readScopeCount: memory?.readScopes.length ?? 0,
            readScopes: (memory?.readScopes ?? []).map(scopeLabel),
            writeScope: scopeLabel(memory?.writeScope),
            retentionPolicy: memory?.retentionPolicy ?? "unknown",
            writebackReviewRequired: memory?.writebackReviewRequired ?? false,
        },
        capability: {
            ...(permission?.riskCeiling ? { riskCeiling: permission.riskCeiling } : {}),
            ...(permission?.approvalRequiredFrom
                ? { approvalRequiredFrom: permission.approvalRequiredFrom }
                : {}),
            allowExternalNetwork: permission?.allowExternalNetwork ?? false,
            allowFilesystemWrite: permission?.allowFilesystemWrite ?? false,
            allowShellExecution: permission?.allowShellExecution ?? false,
            allowScreenControl: permission?.allowScreenControl ?? false,
            allowedPathCount: permission?.allowedPaths.length ?? 0,
            ...(agent?.capabilitySummary.availability
                ? { availability: agent.capabilitySummary.availability }
                : {}),
            reasonCodes: redactedStrings(agent?.degradedReasonCodes),
        },
        delegation: {
            enabled: delegation?.enabled ?? false,
            maxParallelSessions: delegation?.maxParallelSessions ?? 0,
            retryBudget: delegation?.retryBudget ?? 0,
        },
        diagnostics: input.diagnostics.map((diagnostic) => diagnostic.reasonCode),
    };
}
function memberCoverageByAgent(coverage) {
    return new Map((coverage?.members ?? []).map((member) => [member.agentId, member]));
}
function buildTeamMemberInspectors(input) {
    const coverageByAgent = memberCoverageByAgent(input.team.coverage);
    return teamMemberships(input.team.config).map((membership) => {
        const coverage = coverageByAgent.get(membership.agentId);
        const agent = input.agentsById.get(membership.agentId);
        return {
            agentId: membership.agentId,
            label: redactedText(agent?.nickname ?? agent?.displayName ?? membership.agentId),
            membershipId: membership.membershipId,
            primaryRole: redactedText(coverage?.primaryRole ?? membership.primaryRole),
            teamRoles: redactedStrings(coverage?.teamRoles ?? membership.teamRoles),
            required: coverage?.required ?? membership.required,
            executionState: coverage?.executionState ?? "unresolved",
            directChild: coverage?.directChild ?? false,
            active: coverage?.active ?? false,
            reasonCodes: redactedStrings(coverage?.reasonCodes),
            specialtyTags: redactedStrings(coverage?.specialtyTags),
            capabilityIds: redactedStrings(coverage?.capabilityIds),
            ...(coverage?.modelAvailability ? { modelAvailability: coverage.modelAvailability } : {}),
            ...(coverage?.capabilityAvailability
                ? { capabilityAvailability: coverage.capabilityAvailability }
                : {}),
        };
    });
}
function buildTeamBuilderCandidates(input) {
    const directChildren = new Set(input.directChildAgentIds);
    const memberships = new Map(teamMemberships(input.team.config).map((item) => [item.agentId, item]));
    const coverageByAgent = memberCoverageByAgent(input.team.coverage);
    return input.agents
        .map((agent) => {
        const membership = memberships.get(agent.agentId);
        const coverage = coverageByAgent.get(agent.agentId);
        const directChild = directChildren.has(agent.agentId);
        const membershipStatus = membership?.status ?? "unconfigured";
        const active = membershipStatus === "active";
        const reasonCodes = uniqueSorted([
            ...(coverage?.reasonCodes ?? []),
            ...(directChild ? [] : ["owner_direct_child_required"]),
        ]);
        return {
            agentId: agent.agentId,
            label: redactedText(agent.nickname ?? agent.displayName, agent.agentId),
            directChild,
            configuredMember: Boolean(membership),
            active,
            canActivate: directChild,
            membershipStatus,
            ...(membership?.primaryRole ? { primaryRole: redactedText(membership.primaryRole) } : {}),
            teamRoles: redactedStrings(membership?.teamRoles),
            reasonCodes,
        };
    })
        .sort((left, right) => {
        if (left.directChild !== right.directChild)
            return left.directChild ? -1 : 1;
        return left.label.localeCompare(right.label);
    });
}
function buildTeamInspector(input) {
    const ownerAgentId = input.team.config.ownerAgentId ?? input.rootAgentId;
    const directChildAgentIds = [...(input.directChildrenByParent[ownerAgentId] ?? [])].sort((left, right) => left.localeCompare(right));
    const coverage = input.team.coverage;
    const health = input.team.health;
    const diagnostics = (health?.diagnostics ?? coverage?.diagnostics ?? []).map(registryDiagnostic);
    return {
        teamId: input.team.teamId,
        nodeId: teamNodeId(input.team.teamId),
        displayName: redactedText(input.team.displayName, input.team.teamId),
        ...(input.team.nickname ? { nickname: redactedText(input.team.nickname) } : {}),
        status: redactedText(input.team.status),
        purpose: redactedText(input.team.purpose),
        ownerAgentId,
        ...(input.team.config.leadAgentId ? { leadAgentId: input.team.config.leadAgentId } : {}),
        memberAgentIds: redactedStrings(input.team.config.memberAgentIds),
        activeMemberAgentIds: redactedStrings(coverage?.activeMemberAgentIds),
        roleHints: redactedStrings(input.team.roleHints),
        requiredTeamRoles: redactedStrings(input.team.config.requiredTeamRoles ?? []),
        requiredCapabilityTags: redactedStrings(input.team.config.requiredCapabilityTags ?? []),
        members: buildTeamMemberInspectors({ team: input.team, agentsById: input.agentsById }),
        roleCoverage: coverage?.roleCoverage ?? emptyCoverageDimension(),
        capabilityCoverage: coverage?.capabilityCoverage ?? emptyCoverageDimension(),
        health: {
            status: health?.status ?? "unknown",
            executionCandidate: health?.executionCandidate ?? false,
            activeMemberCount: health?.activeMemberCount ?? 0,
            referenceMemberCount: health?.referenceMemberCount ?? 0,
            unresolvedMemberCount: health?.unresolvedMemberCount ?? 0,
            excludedMemberCount: health?.excludedMemberCount ?? 0,
            degradedReasonCodes: uniqueSorted(diagnostics.map((diagnostic) => diagnostic.reasonCode)),
        },
        builder: {
            ownerAgentId,
            directChildAgentIds,
            candidates: buildTeamBuilderCandidates({
                team: input.team,
                agents: input.agents,
                directChildAgentIds,
            }),
        },
        diagnostics,
    };
}
function teamTopologyNode(input) {
    const id = teamNodeId(input.team.teamId);
    const healthStatus = input.team.health?.status ?? "unknown";
    const badges = ["Team", healthStatus];
    if (input.team.config.leadAgentId)
        badges.push("lead");
    return {
        id,
        kind: "team",
        entityId: input.team.teamId,
        label: redactedText(input.team.nickname ?? input.team.displayName, input.team.teamId),
        status: input.team.status,
        position: nodePosition(id, { x: 80, y: input.yOffset + input.index * 172 }, input.layout),
        badges,
        data: {
            purpose: redactedText(input.team.purpose),
            ownerAgentId: input.team.config.ownerAgentId ?? "",
            leadAgentId: input.team.config.leadAgentId ?? "",
            healthStatus,
            activeMemberCount: input.team.health?.activeMemberCount ?? 0,
        },
        diagnostics: input.diagnostics,
    };
}
function roleBadgeNode(input) {
    const id = roleNodeId(input.teamId, input.member.agentId, input.member.primaryRole);
    const blocked = input.member.reasonCodes.length > 0;
    return {
        id,
        kind: "team_role",
        entityId: `${input.teamId}:${input.member.agentId}:${input.member.primaryRole}`,
        label: input.member.teamRoles.length > 1
            ? input.member.teamRoles.slice(0, 3).join(" / ")
            : input.member.primaryRole,
        status: input.member.executionState,
        position: nodePosition(id, { x: 360, y: input.yOffset + input.index * 74 }, input.layout),
        badges: ["TeamRole", input.member.executionState, ...(blocked ? ["invalid"] : [])],
        data: {
            teamId: input.teamId,
            agentId: input.member.agentId,
            primaryRole: input.member.primaryRole,
            directChild: input.member.directChild,
            active: input.member.active,
        },
        diagnostics: input.member.reasonCodes.map((reasonCode) => ({
            reasonCode,
            severity: reasonCode === "owner_direct_child_required" ? "warning" : "info",
            message: `${input.member.agentId} role ${input.member.primaryRole} has ${reasonCode}.`,
            teamId: input.teamId,
            agentId: input.member.agentId,
        })),
    };
}
function leadBadgeNode(input) {
    const id = leadNodeId(input.team.teamId, input.leadAgentId);
    return {
        id,
        kind: "team_lead",
        entityId: `${input.team.teamId}:${input.leadAgentId}`,
        label: "Team Lead",
        status: input.team.health?.status ?? "unknown",
        position: nodePosition(id, { x: 650, y: input.yOffset + input.index * 172 }, input.layout),
        badges: ["TeamLead", input.team.health?.status ?? "unknown"],
        data: {
            teamId: input.team.teamId,
            agentId: input.leadAgentId,
            healthStatus: input.team.health?.status ?? "unknown",
        },
        diagnostics: (input.team.health?.diagnostics ?? [])
            .filter((diagnostic) => diagnostic.agentId === input.leadAgentId)
            .map(registryDiagnostic),
    };
}
function membershipEdgeStyle(member) {
    if (member.reasonCodes.includes("owner_direct_child_required"))
        return "membership_reference";
    if (!member.directChild || member.executionState === "reference")
        return "membership_reference";
    if (member.reasonCodes.some((reasonCode) => reasonCode.includes("missing")))
        return "invalid";
    return "membership";
}
function teamMembershipEdges(input) {
    const teamId = input.team.teamId;
    const source = teamNodeId(teamId);
    const edges = [];
    for (const member of input.teamInspector.members) {
        const roleId = roleNodeId(teamId, member.agentId, member.primaryRole);
        const agentId = agentNodeId(member.agentId);
        const diagnostics = member.reasonCodes.map((reasonCode) => ({
            reasonCode,
            severity: reasonCode === "member_agent_missing" || reasonCode === "lead_not_active_member"
                ? "invalid"
                : "warning",
            message: `${member.agentId} team membership has ${reasonCode}.`,
            teamId,
            agentId: member.agentId,
        }));
        const style = membershipEdgeStyle(member);
        edges.push({
            id: `membership:${teamId}->${roleId}`,
            kind: "team_membership",
            source,
            target: roleId,
            label: member.primaryRole,
            valid: diagnostics.every((diagnostic) => diagnostic.severity !== "invalid"),
            style,
            data: {
                teamId,
                agentId: member.agentId,
                executionState: member.executionState,
                directChild: member.directChild,
                active: member.active,
                role: member.primaryRole,
            },
            diagnostics,
        });
        edges.push({
            id: `membership:${roleId}->${agentId}`,
            kind: "team_membership",
            source: roleId,
            target: agentId,
            label: "member",
            valid: diagnostics.every((diagnostic) => diagnostic.severity !== "invalid"),
            style,
            data: {
                teamId,
                agentId: member.agentId,
                executionState: member.executionState,
                directChild: member.directChild,
                active: member.active,
            },
            diagnostics,
        });
    }
    if (input.team.config.leadAgentId) {
        const leadId = leadNodeId(teamId, input.team.config.leadAgentId);
        edges.push({
            id: `lead:${teamId}->${leadId}`,
            kind: "team_membership",
            source,
            target: leadId,
            label: "lead",
            valid: input.team.health?.status !== "invalid",
            style: "lead",
            data: {
                teamId,
                agentId: input.team.config.leadAgentId,
                role: "lead",
            },
            diagnostics: input.teamInspector.diagnostics.filter((diagnostic) => diagnostic.agentId === input.team.config.leadAgentId),
        });
        edges.push({
            id: `lead:${leadId}->${agentNodeId(input.team.config.leadAgentId)}`,
            kind: "team_membership",
            source: leadId,
            target: agentNodeId(input.team.config.leadAgentId),
            label: "lead agent",
            valid: input.team.health?.status !== "invalid",
            style: "lead",
            data: {
                teamId,
                agentId: input.team.config.leadAgentId,
                role: "lead",
            },
            diagnostics: input.teamInspector.diagnostics.filter((diagnostic) => diagnostic.agentId === input.team.config.leadAgentId),
        });
    }
    return edges;
}
function directChildDiagnostic(input) {
    return {
        reasonCode: "owner_direct_child_required",
        severity: "blocked",
        message: `${input.agentId} must be a direct child of ${input.ownerAgentId} before it can be an active team member.`,
        teamId: input.teamId,
        agentId: input.agentId,
        parentAgentId: input.ownerAgentId,
        childAgentId: input.agentId,
    };
}
export function createAgentTopologyService(dependencies = {}) {
    const hierarchy = () => createAgentHierarchyService(dependencies);
    const registry = () => createAgentRegistryService(dependencies);
    function buildProjection() {
        const hierarchyService = hierarchy();
        const tree = hierarchyService.buildProjection();
        const layout = hierarchyService.readLayout();
        const snapshot = registry().snapshot();
        const agentsById = new Map(snapshot.agents.map((agent) => [agent.agentId, agent]));
        const hierarchyDiagnostics = tree.diagnostics.map(hierarchyDiagnostic);
        const registryDiagnostics = [
            ...(snapshot.diagnostics ?? []),
            ...(snapshot.hierarchy?.diagnostics ?? []),
            ...snapshot.teams.flatMap((team) => team.health?.diagnostics ?? team.coverage?.diagnostics ?? []),
        ].map(registryDiagnostic);
        const diagnostics = [...hierarchyDiagnostics, ...registryDiagnostics];
        const diagnosticsByAgentId = new Map();
        const diagnosticsByTeamId = new Map();
        for (const diagnostic of diagnostics) {
            if (diagnostic.agentId) {
                diagnosticsByAgentId.set(diagnostic.agentId, [
                    ...(diagnosticsByAgentId.get(diagnostic.agentId) ?? []),
                    diagnostic,
                ]);
            }
            if (diagnostic.teamId) {
                diagnosticsByTeamId.set(diagnostic.teamId, [
                    ...(diagnosticsByTeamId.get(diagnostic.teamId) ?? []),
                    diagnostic,
                ]);
            }
        }
        const agentNodes = tree.nodes.map((node, index) => agentTopologyNode({
            node,
            index,
            layout,
            diagnostics: diagnosticsByAgentId.get(node.entityId) ?? [],
        }));
        const maxAgentY = agentNodes.reduce((max, node) => Math.max(max, node.position.y), agentNodes.length > 0 ? 80 : 0);
        const teamYOffset = maxAgentY + 190;
        const roleYOffset = teamYOffset;
        const inspectors = {
            agents: {},
            teams: {},
        };
        for (const node of tree.nodes) {
            const agent = agentsById.get(node.entityId);
            inspectors.agents[node.entityId] = buildAgentInspector({
                node,
                ...(agent ? { agent } : {}),
                diagnostics: diagnosticsByAgentId.get(node.entityId) ?? [],
            });
        }
        const teamNodes = [];
        const roleNodes = [];
        const leadNodes = [];
        const membershipEdges = [];
        snapshot.teams.forEach((team, teamIndex) => {
            const teamInspector = buildTeamInspector({
                team,
                rootAgentId: tree.rootAgentId,
                agents: snapshot.agents,
                agentsById,
                directChildrenByParent: snapshot.hierarchy?.directChildrenByParent ?? {},
            });
            inspectors.teams[team.teamId] = teamInspector;
            teamNodes.push(teamTopologyNode({
                team,
                index: teamIndex,
                yOffset: teamYOffset,
                layout,
                diagnostics: diagnosticsByTeamId.get(team.teamId) ?? [],
            }));
            teamInspector.members.forEach((member, memberIndex) => {
                roleNodes.push(roleBadgeNode({
                    teamId: team.teamId,
                    member,
                    index: teamIndex * Math.max(1, teamInspector.members.length) + memberIndex,
                    yOffset: roleYOffset,
                    layout,
                }));
            });
            if (team.config.leadAgentId) {
                leadNodes.push(leadBadgeNode({
                    team,
                    leadAgentId: team.config.leadAgentId,
                    index: teamIndex,
                    yOffset: teamYOffset,
                    layout,
                }));
            }
            membershipEdges.push(...teamMembershipEdges({ team, teamInspector }));
        });
        const hierarchyEdges = tree.edges.map((edge) => ({
            id: edge.edgeId,
            kind: "parent_child",
            source: edge.fromNodeId,
            target: edge.toNodeId,
            ...(edge.label ? { label: redactedText(edge.label) } : {}),
            valid: true,
            style: "hierarchy",
            data: {
                edgeType: edge.edgeType,
                source: safeJsonValue(edge.metadata?.source),
                status: safeJsonValue(edge.metadata?.status),
                sortOrder: safeJsonValue(edge.metadata?.sortOrder),
            },
            diagnostics: diagnostics.filter((diagnostic) => diagnostic.edgeId === edge.edgeId),
        }));
        return {
            schemaVersion: 1,
            generatedAt: tree.generatedAt,
            rootAgentId: tree.rootAgentId,
            nodes: [...agentNodes, ...teamNodes, ...roleNodes, ...leadNodes],
            edges: [...hierarchyEdges, ...membershipEdges],
            inspectors,
            layout,
            diagnostics,
            validation: {
                hierarchy: {
                    maxDepth: hierarchyService.maxDepth,
                    maxChildCount: hierarchyService.maxChildCount,
                },
                teamActiveMembershipRule: "owner_direct_child_required",
            },
        };
    }
    function validateEdge(input) {
        if (input.kind === "parent_child") {
            const relationshipInput = input.relationship ?? {
                ...(input.sourceAgentId ? { parentAgentId: input.sourceAgentId } : {}),
                ...(input.targetAgentId ? { childAgentId: input.targetAgentId } : {}),
            };
            const result = hierarchy().validate(relationshipInput);
            return {
                ok: true,
                valid: result.ok,
                kind: "parent_child",
                ...(result.relationship ? { relationship: result.relationship } : {}),
                diagnostics: result.diagnostics.map(hierarchyDiagnostic),
            };
        }
        const projection = buildProjection();
        const team = projection.inspectors.teams[input.teamId ?? ""];
        if (!team) {
            return {
                ok: false,
                valid: false,
                kind: "team_membership",
                diagnostics: [
                    {
                        reasonCode: "team_not_found",
                        severity: "blocked",
                        message: `Team ${input.teamId ?? "unknown"} was not found.`,
                        ...(input.teamId ? { teamId: input.teamId } : {}),
                    },
                ],
            };
        }
        const agentId = input.agentId ?? input.targetAgentId;
        if (!agentId) {
            return {
                ok: false,
                valid: false,
                kind: "team_membership",
                diagnostics: [
                    {
                        reasonCode: "team_member_agent_required",
                        severity: "blocked",
                        message: "agentId is required for team membership validation.",
                        teamId: team.teamId,
                    },
                ],
            };
        }
        const candidate = team.builder.candidates.find((item) => item.agentId === agentId);
        const wantsActive = (input.memberStatus ?? "active") === "active";
        const diagnostics = candidate
            ? candidate.reasonCodes.map((reasonCode) => ({
                reasonCode,
                severity: reasonCode === "owner_direct_child_required" ? "blocked" : "warning",
                message: `${agentId} membership has ${reasonCode}.`,
                teamId: team.teamId,
                agentId,
                parentAgentId: team.ownerAgentId,
                childAgentId: agentId,
            }))
            : [];
        if (wantsActive && !candidate?.directChild) {
            diagnostics.unshift(directChildDiagnostic({ teamId: team.teamId, agentId, ownerAgentId: team.ownerAgentId }));
        }
        return {
            ok: true,
            valid: diagnostics.every((diagnostic) => diagnostic.severity !== "blocked"),
            kind: "team_membership",
            diagnostics,
        };
    }
    function validateActiveTeamMembers(team) {
        const projection = buildProjection();
        const projectedTeam = projection.inspectors.teams[team.teamId];
        if (!projectedTeam) {
            return {
                ok: false,
                valid: false,
                kind: "team_membership",
                diagnostics: [
                    {
                        reasonCode: "team_not_found",
                        severity: "blocked",
                        message: `Team ${team.teamId} was not found.`,
                        teamId: team.teamId,
                    },
                ],
            };
        }
        const diagnostics = [];
        for (const membership of teamMemberships(team)) {
            if (membership.status !== "active")
                continue;
            const directChild = projectedTeam.builder.directChildAgentIds.includes(membership.agentId);
            if (!directChild) {
                diagnostics.push(directChildDiagnostic({
                    teamId: team.teamId,
                    agentId: membership.agentId,
                    ownerAgentId: projectedTeam.ownerAgentId,
                }));
            }
        }
        return {
            ok: true,
            valid: diagnostics.length === 0,
            kind: "team_membership",
            diagnostics,
        };
    }
    return {
        buildProjection,
        validateEdge,
        validateActiveTeamMembers,
    };
}
//# sourceMappingURL=topology-projection.js.map