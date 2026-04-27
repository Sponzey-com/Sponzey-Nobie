import { validateTeamConfig, } from "../contracts/sub-agent-orchestration.js";
import { listAgentTeamMemberships } from "../db/index.js";
import { CAPABILITY_RISK_ORDER, normalizeSkillMcpAllowlist, } from "../security/capability-isolation.js";
import { createAgentHierarchyService } from "./hierarchy.js";
import { createAgentRegistryService, createTeamRegistryService, } from "./registry.js";
const RECALCULATION_KEYS = [
    "task008.skill_mcp_binding_recalculation_pending",
    "task009.model_state_recalculation_pending",
];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => value.trim().length > 0))];
}
function defaultMembershipId(teamId, agentId, index) {
    return `${teamId}:membership:${agentId}:${index}`;
}
function teamMemberships(team) {
    if (Array.isArray(team.memberships) && team.memberships.length > 0) {
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
function persistedMembershipStatusByAgent(teamId) {
    const result = new Map();
    for (const row of listAgentTeamMemberships(teamId)) {
        if (row.status === "active" ||
            row.status === "inactive" ||
            row.status === "fallback_only" ||
            row.status === "removed" ||
            row.status === "unresolved") {
            result.set(row.agent_id, row.status);
        }
    }
    return result;
}
function roleProviders(members, required) {
    const providers = {};
    for (const role of required) {
        providers[role] = members
            .filter((member) => member.primaryRole === role || member.teamRoles.includes(role))
            .map((member) => member.agentId);
    }
    const covered = required.filter((role) => (providers[role] ?? []).length > 0);
    return {
        required,
        covered,
        missing: required.filter((role) => !covered.includes(role)),
        providers,
    };
}
function markCoverageProvidedByOwnerLead(coverage, ownerAgentId, leadAgentId) {
    if (leadAgentId !== ownerAgentId || !coverage.required.includes("lead"))
        return coverage;
    const leadProviders = uniqueStrings([...(coverage.providers.lead ?? []), ownerAgentId]).sort((left, right) => left.localeCompare(right));
    const covered = uniqueStrings([...coverage.covered, "lead"]).sort((left, right) => left.localeCompare(right));
    return {
        ...coverage,
        covered,
        missing: coverage.required.filter((role) => !covered.includes(role)),
        providers: {
            ...coverage.providers,
            lead: leadProviders,
        },
    };
}
function capabilityProviders(members, required) {
    const providers = {};
    for (const capability of required) {
        providers[capability] = members
            .filter((member) => member.specialtyTags.includes(capability))
            .map((member) => member.agentId);
    }
    const covered = required.filter((capability) => (providers[capability] ?? []).length > 0);
    return {
        required,
        covered,
        missing: required.filter((capability) => !covered.includes(capability)),
        providers,
    };
}
function subset(left, right) {
    const rightSet = new Set(right ?? []);
    return (left ?? []).every((value) => rightSet.has(value));
}
function broaderFallbackReason(fallback, primary) {
    if (!fallback || !primary || !fallback.permissionProfile || !primary.permissionProfile)
        return undefined;
    if (CAPABILITY_RISK_ORDER[fallback.permissionProfile.riskCeiling] >
        CAPABILITY_RISK_ORDER[primary.permissionProfile.riskCeiling]) {
        return "fallback_risk_ceiling_broader";
    }
    const fallbackProfile = fallback.permissionProfile;
    const primaryProfile = primary.permissionProfile;
    if (fallbackProfile.allowExternalNetwork && !primaryProfile.allowExternalNetwork)
        return "fallback_network_permission_broader";
    if (fallbackProfile.allowFilesystemWrite && !primaryProfile.allowFilesystemWrite)
        return "fallback_filesystem_permission_broader";
    if (fallbackProfile.allowShellExecution && !primaryProfile.allowShellExecution)
        return "fallback_shell_permission_broader";
    if (fallbackProfile.allowScreenControl && !primaryProfile.allowScreenControl)
        return "fallback_screen_permission_broader";
    if (!subset(fallbackProfile.allowedPaths, primaryProfile.allowedPaths))
        return "fallback_path_permission_broader";
    const fallbackAllowlist = normalizeSkillMcpAllowlist(fallback.skillMcpAllowlist);
    const primaryAllowlist = normalizeSkillMcpAllowlist(primary.skillMcpAllowlist);
    if (!subset(fallbackAllowlist.enabledSkillIds, primaryAllowlist.enabledSkillIds))
        return "fallback_skill_allowlist_broader";
    if (!subset(fallbackAllowlist.enabledMcpServerIds, primaryAllowlist.enabledMcpServerIds))
        return "fallback_mcp_allowlist_broader";
    if (!subset(fallbackAllowlist.enabledToolNames, primaryAllowlist.enabledToolNames))
        return "fallback_tool_allowlist_broader";
    return undefined;
}
function isAgentOverloaded(agent) {
    return Boolean(agent?.load && agent.load.utilization >= 1);
}
function healthFromCoverage(coverage) {
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
export function createTeamCompositionService(dependencies = {}) {
    const now = () => dependencies.now?.() ?? Date.now();
    const agentRegistry = () => createAgentRegistryService(dependencies);
    const teamRegistry = () => createTeamRegistryService(dependencies);
    const hierarchy = () => createAgentHierarchyService(dependencies);
    function agentSummaries() {
        const result = new Map();
        const snapshot = agentRegistry().snapshot();
        for (const entry of snapshot.agents) {
            result.set(entry.agentId, {
                agentId: entry.agentId,
                status: entry.status,
                specialtyTags: [...entry.specialtyTags],
                permissionProfile: entry.permissionProfile,
                skillMcpAllowlist: entry.capabilityPolicy.skillMcpAllowlist,
                load: entry.currentLoad,
            });
        }
        for (const agent of agentRegistry().list()) {
            if (agent.agentType !== "sub_agent")
                continue;
            const existing = result.get(agent.agentId);
            result.set(agent.agentId, {
                agentId: agent.agentId,
                status: agent.status,
                specialtyTags: [...agent.specialtyTags],
                permissionProfile: agent.capabilityPolicy.permissionProfile,
                skillMcpAllowlist: agent.capabilityPolicy.skillMcpAllowlist,
                ...(existing?.load ? { load: existing.load } : {}),
            });
        }
        const rootAgentId = hierarchy().rootAgentId;
        if (!result.has(rootAgentId)) {
            result.set(rootAgentId, {
                agentId: rootAgentId,
                status: "enabled",
                specialtyTags: [],
            });
        }
        return result;
    }
    function directChildIdsFor(ownerAgentId) {
        const service = hierarchy();
        const directChildren = service
            .directChildren(ownerAgentId)
            .map((child) => child.relationship.childAgentId);
        return new Set(directChildren);
    }
    function evaluateTeam(team, options) {
        const generatedAt = now();
        const agents = agentSummaries();
        const ownerAgentId = team.ownerAgentId ?? hierarchy().rootAgentId;
        const owner = agents.get(ownerAgentId);
        const directChildIds = directChildIdsFor(ownerAgentId);
        const persistedStatuses = options.usePersistedMembershipStatuses
            ? persistedMembershipStatusByAgent(team.teamId)
            : new Map();
        const diagnostics = [];
        if (team.status !== "enabled") {
            diagnostics.push({
                reasonCode: "team_unavailable",
                severity: "invalid",
                message: `Team ${team.teamId} is ${team.status}.`,
                teamId: team.teamId,
                ownerAgentId,
            });
        }
        if (!owner) {
            diagnostics.push({
                reasonCode: "team_owner_missing",
                severity: "invalid",
                message: `Team owner ${ownerAgentId} is not defined.`,
                teamId: team.teamId,
                ownerAgentId,
            });
        }
        else if (owner.status !== "enabled") {
            diagnostics.push({
                reasonCode: "team_owner_unavailable",
                severity: "invalid",
                message: `Team owner ${ownerAgentId} is ${owner.status}.`,
                teamId: team.teamId,
                ownerAgentId,
            });
        }
        const rawMemberships = teamMemberships(team);
        const primaryMembershipByAgent = new Map(rawMemberships.map((membership) => [membership.agentId, membership]));
        const memberCoverages = rawMemberships.map((membership) => {
            const agent = agents.get(membership.agentId);
            const membershipStatus = persistedStatuses.get(membership.agentId) ?? membership.status;
            const directChild = directChildIds.has(membership.agentId);
            const excludedReasonCodes = [];
            if (!agent)
                excludedReasonCodes.push("member_agent_missing");
            if (membershipStatus === "unresolved")
                excludedReasonCodes.push("member_unresolved");
            if (membershipStatus === "removed")
                excludedReasonCodes.push("membership_removed");
            if (membershipStatus === "inactive")
                excludedReasonCodes.push("membership_inactive");
            if (owner && owner.status !== "enabled")
                excludedReasonCodes.push("team_owner_unavailable");
            if (agent && agent.status !== "enabled")
                excludedReasonCodes.push(`member_${agent.status}`);
            if (isAgentOverloaded(agent))
                excludedReasonCodes.push("member_overloaded");
            if (!directChild)
                excludedReasonCodes.push("owner_direct_child_required");
            const primaryForFallback = membership.fallbackForAgentId
                ? primaryMembershipByAgent.get(membership.fallbackForAgentId)
                : undefined;
            const primaryAgent = primaryForFallback ? agents.get(primaryForFallback.agentId) : undefined;
            const primaryMembershipStatus = primaryForFallback
                ? (persistedStatuses.get(primaryForFallback.agentId) ?? primaryForFallback.status)
                : undefined;
            const fallbackBroaderReason = membership.fallbackForAgentId
                ? broaderFallbackReason(agent, primaryAgent)
                : undefined;
            if (fallbackBroaderReason)
                excludedReasonCodes.push(fallbackBroaderReason);
            const primaryUnavailable = primaryForFallback
                ? !primaryAgent ||
                    primaryAgent.status !== "enabled" ||
                    !directChildIds.has(primaryForFallback.agentId) ||
                    primaryMembershipStatus !== "active" ||
                    isAgentOverloaded(primaryAgent)
                : false;
            if (membershipStatus === "fallback_only") {
                if (!membership.fallbackForAgentId)
                    excludedReasonCodes.push("fallback_primary_missing");
                else if (!primaryUnavailable)
                    excludedReasonCodes.push("fallback_primary_available");
            }
            const active = membershipStatus === "active" &&
                owner?.status === "enabled" &&
                agent?.status === "enabled" &&
                directChild &&
                !excludedReasonCodes.includes("member_overloaded");
            const fallbackCandidate = membershipStatus === "fallback_only" &&
                Boolean(membership.fallbackForAgentId) &&
                primaryUnavailable &&
                owner?.status === "enabled" &&
                directChild &&
                agent?.status === "enabled" &&
                !fallbackBroaderReason &&
                !excludedReasonCodes.includes("member_overloaded");
            let executionState = "excluded";
            if (!agent || membershipStatus === "unresolved")
                executionState = "unresolved";
            else if (!directChild)
                executionState = "reference";
            else if (fallbackCandidate)
                executionState = "fallback";
            else if (active)
                executionState = "active";
            return {
                agentId: membership.agentId,
                membershipId: membership.membershipId,
                primaryRole: membership.primaryRole,
                teamRoles: [...membership.teamRoles],
                required: membership.required,
                membershipStatus,
                executionState,
                active,
                directChild,
                fallbackCandidate,
                ...(membership.fallbackForAgentId
                    ? { fallbackForAgentId: membership.fallbackForAgentId }
                    : {}),
                excludedReasonCodes: uniqueStrings(excludedReasonCodes),
                ...(agent ? { agentStatus: agent.status } : {}),
                specialtyTags: agent?.specialtyTags ?? [],
                ...(agent?.permissionProfile ? { riskCeiling: agent.permissionProfile.riskCeiling } : {}),
                ...(agent?.load
                    ? {
                        load: {
                            utilization: agent.load.utilization,
                            activeSubSessions: agent.load.activeSubSessions,
                            maxParallelSessions: agent.load.maxParallelSessions,
                        },
                    }
                    : {}),
            };
        });
        for (const member of memberCoverages) {
            if (member.executionState === "reference") {
                diagnostics.push({
                    reasonCode: "owner_direct_child_required",
                    severity: "warning",
                    message: `${member.agentId} is not a direct child of ${ownerAgentId}; it is a reference member only.`,
                    teamId: team.teamId,
                    agentId: member.agentId,
                    ownerAgentId,
                });
            }
            if (member.executionState === "unresolved") {
                diagnostics.push({
                    reasonCode: "member_unresolved",
                    severity: "warning",
                    message: `${member.agentId} is unresolved and cannot be active.`,
                    teamId: team.teamId,
                    agentId: member.agentId,
                    ownerAgentId,
                });
            }
            if (member.excludedReasonCodes.includes("member_disabled") ||
                member.excludedReasonCodes.includes("member_archived") ||
                member.excludedReasonCodes.includes("member_degraded")) {
                diagnostics.push({
                    reasonCode: "member_unavailable",
                    severity: "warning",
                    message: `${member.agentId} is ${member.agentStatus}.`,
                    teamId: team.teamId,
                    agentId: member.agentId,
                    ownerAgentId,
                });
            }
            if (member.excludedReasonCodes.includes("member_overloaded")) {
                diagnostics.push({
                    reasonCode: "member_overloaded",
                    severity: "warning",
                    message: `${member.agentId} is at its runtime concurrency limit.`,
                    teamId: team.teamId,
                    agentId: member.agentId,
                    ownerAgentId,
                });
            }
            const fallbackBroaderReason = member.excludedReasonCodes.find((reason) => reason.startsWith("fallback_") && reason.endsWith("_broader"));
            if (fallbackBroaderReason) {
                diagnostics.push({
                    reasonCode: fallbackBroaderReason,
                    severity: "invalid",
                    message: `${member.agentId} fallback policy is broader than ${member.fallbackForAgentId}.`,
                    teamId: team.teamId,
                    agentId: member.agentId,
                    ownerAgentId,
                    ...(member.fallbackForAgentId ? { fallbackForAgentId: member.fallbackForAgentId } : {}),
                });
            }
            if (member.excludedReasonCodes.includes("fallback_primary_available")) {
                diagnostics.push({
                    reasonCode: "fallback_primary_available",
                    severity: "info",
                    message: `${member.agentId} is held as fallback because primary ${member.fallbackForAgentId} is available.`,
                    teamId: team.teamId,
                    agentId: member.agentId,
                    ownerAgentId,
                    ...(member.fallbackForAgentId ? { fallbackForAgentId: member.fallbackForAgentId } : {}),
                });
            }
        }
        const activeMembers = memberCoverages.filter((member) => member.active);
        const fallbackMembers = memberCoverages.filter((member) => member.fallbackCandidate);
        const executableMembers = [...activeMembers, ...fallbackMembers];
        const roleCoverage = markCoverageProvidedByOwnerLead(roleProviders(executableMembers, uniqueStrings(team.requiredTeamRoles ?? [])), ownerAgentId, team.leadAgentId);
        const capabilityCoverage = capabilityProviders(executableMembers, uniqueStrings(team.requiredCapabilityTags ?? []));
        if (activeMembers.length === 0) {
            diagnostics.push({
                reasonCode: "no_active_team_members",
                severity: "invalid",
                message: "Team has no active owner-direct-child members.",
                teamId: team.teamId,
                ownerAgentId,
            });
        }
        if (team.leadAgentId &&
            team.leadAgentId !== ownerAgentId &&
            !activeMembers.some((member) => member.agentId === team.leadAgentId)) {
            diagnostics.push({
                reasonCode: "lead_not_active_member",
                severity: "invalid",
                message: `Team lead ${team.leadAgentId} is not an active member.`,
                teamId: team.teamId,
                agentId: team.leadAgentId,
                ownerAgentId,
            });
        }
        if (!team.leadAgentId) {
            diagnostics.push({
                reasonCode: "team_lead_missing",
                severity: "warning",
                message: "Team lead is not configured.",
                teamId: team.teamId,
                ownerAgentId,
            });
        }
        if ((team.requiredTeamRoles ?? []).length === 0) {
            diagnostics.push({
                reasonCode: "required_roles_empty",
                severity: "warning",
                message: "Team required roles are empty; planner coverage will be weak.",
                teamId: team.teamId,
                ownerAgentId,
            });
        }
        if (roleCoverage.missing.length > 0) {
            diagnostics.push({
                reasonCode: "required_role_missing",
                severity: "warning",
                message: `Missing required team roles: ${roleCoverage.missing.join(", ")}.`,
                teamId: team.teamId,
                ownerAgentId,
                missing: roleCoverage.missing,
            });
        }
        if (capabilityCoverage.missing.length > 0) {
            diagnostics.push({
                reasonCode: "required_capability_missing",
                severity: "warning",
                message: `Missing required capability tags: ${capabilityCoverage.missing.join(", ")}.`,
                teamId: team.teamId,
                ownerAgentId,
                missing: capabilityCoverage.missing,
            });
        }
        const coverageWithoutHealth = {
            teamId: team.teamId,
            ownerAgentId,
            ...(team.leadAgentId ? { leadAgentId: team.leadAgentId } : {}),
            generatedAt,
            activeMemberAgentIds: activeMembers.map((member) => member.agentId),
            referenceMemberAgentIds: memberCoverages
                .filter((member) => member.executionState === "reference")
                .map((member) => member.agentId),
            unresolvedMemberAgentIds: memberCoverages
                .filter((member) => member.executionState === "unresolved")
                .map((member) => member.agentId),
            fallbackCandidateAgentIds: fallbackMembers.map((member) => member.agentId),
            excludedMemberAgentIds: memberCoverages
                .filter((member) => member.executionState === "excluded")
                .map((member) => member.agentId),
            members: memberCoverages,
            roleCoverage,
            capabilityCoverage,
            diagnostics,
            recalculationKeys: [...RECALCULATION_KEYS],
        };
        const provisionalCoverage = { ...coverageWithoutHealth, executionCandidate: false };
        const health = healthFromCoverage(provisionalCoverage);
        const coverage = {
            ...coverageWithoutHealth,
            executionCandidate: health.status === "healthy",
        };
        const finalHealth = healthFromCoverage(coverage);
        return {
            ok: true,
            valid: finalHealth.status !== "invalid",
            team,
            coverage,
            health: finalHealth,
            diagnostics,
        };
    }
    function resolveTeam(input) {
        if (typeof input === "string") {
            const team = teamRegistry().get(input);
            if (!team) {
                return {
                    ok: false,
                    valid: false,
                    diagnostics: [
                        {
                            reasonCode: "team_not_found",
                            severity: "invalid",
                            message: `Team ${input} was not found.`,
                            teamId: input,
                        },
                    ],
                };
            }
            return evaluateTeam(team, { usePersistedMembershipStatuses: true });
        }
        const validation = validateTeamConfig(input);
        if (!validation.ok) {
            return {
                ok: false,
                valid: false,
                diagnostics: validation.issues.map((issue) => ({
                    reasonCode: "invalid_team_config",
                    severity: "invalid",
                    message: issue.message,
                    teamId: isRecord(input) && typeof input.teamId === "string" ? input.teamId : "unknown",
                })),
            };
        }
        return evaluateTeam(validation.value, { usePersistedMembershipStatuses: false });
    }
    return {
        evaluate: resolveTeam,
        coverage(teamId) {
            return resolveTeam(teamId).coverage;
        },
        health(teamId) {
            return resolveTeam(teamId).health;
        },
    };
}
//# sourceMappingURL=team-composition.js.map