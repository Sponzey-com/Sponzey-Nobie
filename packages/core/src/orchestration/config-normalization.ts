import { normalizeSkillMcpAllowlist } from "../security/capability-isolation.js"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export function normalizeLegacyAgentConfigRow(value: unknown): unknown {
  if (!isRecord(value)) return value
  const capabilityPolicy = isRecord(value.capabilityPolicy) ? value.capabilityPolicy : {}
  const permissionProfile = isRecord(capabilityPolicy.permissionProfile) ? capabilityPolicy.permissionProfile : {}
  const allowlist = normalizeSkillMcpAllowlist(
    isRecord(capabilityPolicy.skillMcpAllowlist) ? capabilityPolicy.skillMcpAllowlist : {},
  )
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
  }
}

export function normalizeLegacyTeamConfigRow(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    memberAgentIds: asStringArray(value.memberAgentIds),
    roleHints: asStringArray(value.roleHints),
  }
}

