import { normalizeSkillMcpAllowlist } from "../security/capability-isolation.js";
import { normalizeNickname } from "../contracts/sub-agent-orchestration.js";
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string");
}
function asString(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function asBoolean(value) {
    return typeof value === "boolean" ? value : undefined;
}
function normalizeMembershipStatus(value, fallback) {
    switch (value) {
        case "active":
        case "inactive":
        case "fallback_only":
        case "removed":
            return value;
        default:
            return fallback;
    }
}
export function normalizeLegacyAgentConfigRow(value) {
    if (!isRecord(value))
        return value;
    const capabilityPolicy = isRecord(value.capabilityPolicy) ? value.capabilityPolicy : {};
    const permissionProfile = isRecord(capabilityPolicy.permissionProfile) ? capabilityPolicy.permissionProfile : {};
    const allowlist = normalizeSkillMcpAllowlist(isRecord(capabilityPolicy.skillMcpAllowlist) ? capabilityPolicy.skillMcpAllowlist : {});
    const nickname = asString(value.nickname);
    const delegation = isRecord(value.delegation) ? value.delegation : {};
    const coordinator = isRecord(value.coordinator) ? value.coordinator : {};
    const modelProfile = isRecord(value.modelProfile) ? value.modelProfile : {};
    const normalizedNickname = asString(value.normalizedNickname) ?? (nickname ? normalizeNickname(nickname) : undefined);
    const delegationPolicy = isRecord(value.delegationPolicy)
        ? value.delegationPolicy
        : {
            enabled: asBoolean(delegation.enabled) ?? value.agentType === "nobie",
            maxParallelSessions: asNumber(delegation.maxParallelSessions) ?? asNumber(coordinator.maxDelegatedSubSessions) ?? 1,
            retryBudget: asNumber(delegation.retryBudget) ?? 0,
        };
    return {
        ...value,
        ...(normalizedNickname ? { normalizedNickname } : {}),
        specialtyTags: asStringArray(value.specialtyTags),
        avoidTasks: asStringArray(value.avoidTasks),
        teamIds: asStringArray(value.teamIds),
        modelProfile: {
            providerId: asString(modelProfile.providerId) ?? "provider:unknown",
            modelId: asString(modelProfile.modelId) ?? "model:unknown",
            ...(asNumber(modelProfile.temperature) !== undefined ? { temperature: asNumber(modelProfile.temperature) } : {}),
            ...(asNumber(modelProfile.maxOutputTokens) !== undefined ? { maxOutputTokens: asNumber(modelProfile.maxOutputTokens) } : {}),
            ...(asNumber(modelProfile.timeoutMs) !== undefined ? { timeoutMs: asNumber(modelProfile.timeoutMs) } : {}),
            ...(asNumber(modelProfile.retryCount) !== undefined ? { retryCount: asNumber(modelProfile.retryCount) } : {}),
            ...(asNumber(modelProfile.costBudget) !== undefined ? { costBudget: asNumber(modelProfile.costBudget) } : {}),
            ...(asString(modelProfile.fallbackModelId) ? { fallbackModelId: asString(modelProfile.fallbackModelId) } : {}),
        },
        delegationPolicy,
        capabilityPolicy: {
            ...capabilityPolicy,
            permissionProfile: {
                ...permissionProfile,
                allowedPaths: asStringArray(permissionProfile.allowedPaths),
            },
            skillMcpAllowlist: allowlist,
        },
    };
}
export function normalizeLegacyTeamConfigRow(value) {
    if (!isRecord(value))
        return value;
    const memberAgentIds = asStringArray(value.memberAgentIds);
    const roleHints = asStringArray(value.roleHints);
    const memberships = Array.isArray(value.memberships)
        ? value.memberships
            .filter(isRecord)
            .map((membership, index) => {
            const teamRoles = asStringArray(membership.teamRoles);
            const primaryRole = asString(membership.primaryRole) ?? teamRoles[0] ?? roleHints[index] ?? "member";
            return {
                ...membership,
                membershipId: asString(membership.membershipId) ?? `${asString(value.teamId) ?? "team"}:membership:${index + 1}`,
                teamId: asString(membership.teamId) ?? asString(value.teamId) ?? "team:unknown",
                agentId: asString(membership.agentId) ?? memberAgentIds[index] ?? `agent:unknown:${index + 1}`,
                teamRoles: teamRoles.length > 0 ? teamRoles : [primaryRole],
                primaryRole,
                required: asBoolean(membership.required) ?? true,
                sortOrder: asNumber(membership.sortOrder) ?? index,
                status: normalizeMembershipStatus(membership.status, "active"),
            };
        })
        : memberAgentIds.map((agentId, index) => {
            const primaryRole = roleHints[index] ?? "member";
            return {
                membershipId: `${asString(value.teamId) ?? "team"}:membership:${index + 1}`,
                teamId: asString(value.teamId) ?? "team:unknown",
                agentId,
                teamRoles: [primaryRole],
                primaryRole,
                required: true,
                sortOrder: index,
                status: normalizeMembershipStatus(undefined, value.status === "disabled" ? "inactive" : "active"),
            };
        });
    const ownerAgentId = asString(value.ownerAgentId) ?? "agent:nobie";
    const leadAgentId = asString(value.leadAgentId) ?? memberships[0]?.agentId ?? ownerAgentId;
    const requiredTeamRoles = Array.from(new Set([
        ...asStringArray(value.requiredTeamRoles),
        ...memberships.map((membership) => membership.primaryRole).filter(Boolean),
    ]));
    const memberCountMin = asNumber(value.memberCountMin) ?? memberships.filter((membership) => membership.required).length;
    const memberCountMax = asNumber(value.memberCountMax) ?? Math.max(memberCountMin, memberships.length);
    const nickname = asString(value.nickname);
    return {
        ...value,
        ...(nickname ? { normalizedNickname: asString(value.normalizedNickname) ?? normalizeNickname(nickname) } : {}),
        ownerAgentId,
        leadAgentId,
        memberCountMin,
        memberCountMax,
        requiredTeamRoles,
        requiredCapabilityTags: asStringArray(value.requiredCapabilityTags),
        resultPolicy: asString(value.resultPolicy) ?? "lead_synthesis",
        conflictPolicy: asString(value.conflictPolicy) ?? "lead_decides",
        memberships,
        memberAgentIds,
        roleHints,
    };
}
