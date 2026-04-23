import { normalizeSkillMcpAllowlist } from "../security/capability-isolation.js";
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string");
}
export function normalizeLegacyAgentConfigRow(value) {
    if (!isRecord(value))
        return value;
    const capabilityPolicy = isRecord(value.capabilityPolicy) ? value.capabilityPolicy : {};
    const permissionProfile = isRecord(capabilityPolicy.permissionProfile) ? capabilityPolicy.permissionProfile : {};
    const allowlist = normalizeSkillMcpAllowlist(isRecord(capabilityPolicy.skillMcpAllowlist) ? capabilityPolicy.skillMcpAllowlist : {});
    return {
        ...value,
        specialtyTags: asStringArray(value.specialtyTags),
        avoidTasks: asStringArray(value.avoidTasks),
        teamIds: asStringArray(value.teamIds),
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
    return {
        ...value,
        memberAgentIds: asStringArray(value.memberAgentIds),
        roleHints: asStringArray(value.roleHints),
    };
}
