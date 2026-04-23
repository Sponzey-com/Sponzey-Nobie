import { getConfig } from "../config/index.js";
import { disableAgentConfig, getAgentConfig, getDb, getTeamConfig, listAgentConfigs, listAgentTeamMemberships, listTeamConfigs, upsertAgentConfig, upsertTeamConfig, } from "../db/index.js";
import { validateAgentConfig, validateTeamConfig, } from "../contracts/sub-agent-orchestration.js";
import { normalizeSkillMcpAllowlist } from "../security/capability-isolation.js";
import { normalizeLegacyAgentConfigRow, normalizeLegacyTeamConfigRow } from "./config-normalization.js";
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
    const activeSubSessions = (countByStatus.get("created") ?? 0)
        + (countByStatus.get("queued") ?? 0)
        + (countByStatus.get("running") ?? 0)
        + (countByStatus.get("waiting_for_input") ?? 0)
        + (countByStatus.get("awaiting_approval") ?? 0)
        + (countByStatus.get("needs_revision") ?? 0);
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
function agentSkillMcpSummary(config) {
    const allowlist = normalizeSkillMcpAllowlist(config.capabilityPolicy.skillMcpAllowlist);
    return {
        enabledSkillIds: [...allowlist.enabledSkillIds],
        enabledMcpServerIds: [...allowlist.enabledMcpServerIds],
        enabledToolNames: [...allowlist.enabledToolNames],
        disabledToolNames: [...allowlist.disabledToolNames],
        ...(allowlist.secretScopeId ? { secretScopeId: allowlist.secretScopeId } : {}),
    };
}
function agentEntry(config, source, now, failureWindowMs) {
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
        retryBudget: config.delegation.retryBudget,
        source,
        config,
        permissionProfile: config.capabilityPolicy.permissionProfile,
        capabilityPolicy: config.capabilityPolicy,
        skillMcpSummary: agentSkillMcpSummary(config),
        currentLoad: runtimeLoadForAgent(config),
        failureRate: failureRateForAgent(config.agentId, now, failureWindowMs),
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
export function buildOrchestrationRegistrySnapshot(dependencies = {}) {
    const cfg = dependencies.getConfig?.() ?? getConfig();
    const now = dependencies.now?.() ?? Date.now();
    const failureWindowMs = dependencies.failureWindowMs ?? 7 * 24 * 60 * 60 * 1000;
    const diagnostics = [];
    const agentsById = new Map();
    const teamsById = new Map();
    const archivedAgentIds = new Set(listAgentConfigs({ includeArchived: true, agentType: "sub_agent" })
        .filter((row) => row.status === "archived")
        .map((row) => row.agent_id));
    const archivedTeamIds = new Set(listTeamConfigs({ includeArchived: true })
        .filter((row) => row.status === "archived")
        .map((row) => row.team_id));
    for (const agent of cfg.orchestration.subAgents ?? []) {
        if (archivedAgentIds.has(agent.agentId))
            continue;
        agentsById.set(agent.agentId, agentEntry(agent, "config", now, failureWindowMs));
    }
    for (const row of listAgentConfigs({ includeArchived: false, agentType: "sub_agent" })) {
        const config = parseAgentConfigRow(row);
        const subAgent = config ? subAgentFromAgentConfig(config) : undefined;
        if (!subAgent) {
            diagnostics.push({ code: "invalid_agent_config_row", message: `agent_configs row ${row.agent_id} could not be parsed.` });
            continue;
        }
        agentsById.set(subAgent.agentId, agentEntry(subAgent, "db", now, failureWindowMs));
    }
    for (const team of cfg.orchestration.teams ?? []) {
        if (archivedTeamIds.has(team.teamId))
            continue;
        teamsById.set(team.teamId, { ...team, source: "config" });
    }
    for (const row of listTeamConfigs({ includeArchived: false })) {
        const config = parseTeamConfigRow(row);
        if (!config) {
            diagnostics.push({ code: "invalid_team_config_row", message: `team_configs row ${row.team_id} could not be parsed.` });
            continue;
        }
        teamsById.set(config.teamId, { ...config, source: "db" });
    }
    const activeAgentIds = new Set([...agentsById.values()]
        .filter((agent) => agent.status === "enabled" && agent.delegationEnabled)
        .map((agent) => agent.agentId));
    const teams = [...teamsById.values()]
        .map((team) => teamEntry(team, team.source, activeAgentIds))
        .sort((a, b) => a.teamId.localeCompare(b.teamId));
    const membershipEdges = listAgentTeamMemberships()
        .filter((membership) => membership.status !== "removed")
        .map((membership) => ({
        teamId: membership.team_id,
        agentId: membership.agent_id,
        status: membership.status,
        ...(membership.role_hint ? { roleHint: membership.role_hint } : {}),
    }));
    for (const team of teams) {
        for (const agentId of team.memberAgentIds) {
            if (!agentsById.has(agentId)) {
                diagnostics.push({ code: "unresolved_team_member", message: `${team.teamId} references missing agent ${agentId}.` });
            }
        }
    }
    return {
        generatedAt: now,
        agents: [...agentsById.values()].sort((a, b) => a.agentId.localeCompare(b.agentId)),
        teams,
        membershipEdges,
        diagnostics,
    };
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
            upsertAgentConfig({ ...current, status: "archived", updatedAt: now() }, { source: "manual", now: now() });
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
    };
}
//# sourceMappingURL=registry.js.map
