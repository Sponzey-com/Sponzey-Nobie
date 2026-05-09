import { getConfig } from "../config/index.js";
import { listAgentConfigs } from "../db/index.js";
import { createEnterpriseTopologyRegistry } from "../topology/registry.js";
function requestedModeFromConfig(config) {
    return config.mode ?? "single_nobie";
}
function isOrchestrationFeatureEnabled(config) {
    return config.featureFlagEnabled === true && requestedModeFromConfig(config) === "orchestration";
}
function configSubAgentSnapshot(agent) {
    return {
        agentId: agent.agentId,
        displayName: agent.displayName,
        ...(agent.nickname ? { nickname: agent.nickname } : {}),
        source: "config",
    };
}
function dbSubAgentSnapshot(agent) {
    return {
        agentId: agent.agent_id,
        displayName: agent.display_name,
        ...(agent.nickname ? { nickname: agent.nickname } : {}),
        source: "db",
    };
}
function dbDelegationEnabled(agent) {
    try {
        const parsed = JSON.parse(agent.config_json);
        return parsed.delegation?.enabled !== false;
    }
    catch {
        return true;
    }
}
function timestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
function topologyAgentId(topologyId, executorId) {
    return `${topologyId}:${executorId}`;
}
function topologyExecutorCandidates() {
    const registry = createEnterpriseTopologyRegistry();
    const topologies = registry
        .listTopologies()
        .filter((topology) => topology.status !== "archived")
        .sort((a, b) => timestampMs(b.updatedAt) - timestampMs(a.updatedAt) || a.topologyId.localeCompare(b.topologyId));
    const candidates = [];
    for (const topologyRecord of topologies) {
        const exported = registry.exportTopology(topologyRecord.topologyId);
        if (!exported)
            continue;
        for (const node of exported.version.topology.nodes) {
            if (node.status === "archived")
                continue;
            const displayName = node.displayName?.trim() || node.name.trim();
            if (!displayName)
                continue;
            candidates.push({
                snapshot: {
                    agentId: topologyAgentId(topologyRecord.topologyId, node.id),
                    displayName,
                    topologyId: topologyRecord.topologyId,
                    executorId: node.id,
                    source: "topology",
                },
                active: true,
            });
        }
    }
    return candidates;
}
function mergeRegistryCandidates(...candidateGroups) {
    const merged = new Map();
    for (const candidates of candidateGroups) {
        for (const agent of candidates)
            merged.set(agent.snapshot.agentId, agent);
    }
    return [...merged.values()].sort((a, b) => a.snapshot.agentId.localeCompare(b.snapshot.agentId));
}
function defaultRegistryLoad(config) {
    const topologyAgents = topologyExecutorCandidates();
    const dbAgents = listAgentConfigs({ includeArchived: false, agentType: "sub_agent" }).map((agent) => ({
        snapshot: dbSubAgentSnapshot(agent),
        active: agent.status === "enabled" && dbDelegationEnabled(agent),
    }));
    const existingAgentIds = new Set([
        ...topologyAgents.map((agent) => agent.snapshot.agentId),
        ...dbAgents.map((agent) => agent.snapshot.agentId),
    ]);
    const configAgents = (config.subAgents ?? [])
        .filter((agent) => !existingAgentIds.has(agent.agentId))
        .map((agent) => ({
        snapshot: configSubAgentSnapshot(agent),
        active: agent.status === "enabled" && agent.delegation.enabled,
    }));
    const candidates = mergeRegistryCandidates(configAgents, dbAgents, topologyAgents);
    const activeSubAgents = candidates
        .filter((agent) => agent.active)
        .map((agent) => agent.snapshot);
    return {
        activeSubAgents,
        totalSubAgentCount: candidates.length,
        disabledSubAgentCount: candidates.length - activeSubAgents.length,
    };
}
function buildSnapshot(input) {
    const activeSubAgents = input.activeSubAgents ?? [];
    return {
        mode: input.mode,
        status: input.status,
        featureFlagEnabled: input.config.featureFlagEnabled === true,
        requestedMode: requestedModeFromConfig(input.config),
        activeSubAgentCount: activeSubAgents.length,
        totalSubAgentCount: input.totalSubAgentCount ?? activeSubAgents.length,
        disabledSubAgentCount: input.disabledSubAgentCount ?? 0,
        activeSubAgents,
        reasonCode: input.reasonCode,
        reason: input.reason,
        generatedAt: input.generatedAt,
    };
}
function timeoutSnapshot(config, generatedAt) {
    return buildSnapshot({
        mode: "single_nobie",
        status: "degraded",
        config,
        reasonCode: "registry_load_timeout",
        reason: "토폴로지 실행자 조회가 시간 내 완료되지 않아 단일 노비 모드로 fallback했습니다.",
        generatedAt,
    });
}
function registryErrorSnapshot(config, generatedAt, error) {
    const detail = error instanceof Error ? error.message : String(error);
    return buildSnapshot({
        mode: "single_nobie",
        status: "degraded",
        config,
        reasonCode: "registry_load_failed",
        reason: `토폴로지 실행자 조회에 실패해 단일 노비 모드로 fallback했습니다: ${detail}`,
        generatedAt,
    });
}
function snapshotFromRegistry(config, generatedAt, registry) {
    if (registry.activeSubAgents.length === 0) {
        return buildSnapshot({
            mode: "single_nobie",
            status: "ready",
            config,
            activeSubAgents: [],
            totalSubAgentCount: registry.totalSubAgentCount,
            disabledSubAgentCount: registry.disabledSubAgentCount,
            reasonCode: "no_active_sub_agents",
            reason: registry.totalSubAgentCount > 0
                ? "활성화된 토폴로지 실행자 노드가 없어 단일 노비 모드로 동작합니다."
                : "저장된 토폴로지 실행자 노드가 없어 단일 노비 모드로 동작합니다.",
            generatedAt,
        });
    }
    return buildSnapshot({
        mode: "orchestration",
        status: "ready",
        config,
        activeSubAgents: registry.activeSubAgents,
        totalSubAgentCount: registry.totalSubAgentCount,
        disabledSubAgentCount: registry.disabledSubAgentCount,
        reasonCode: "orchestration_ready",
        reason: `토폴로지 실행자 ${registry.activeSubAgents.length}개가 준비되어 orchestration 모드로 동작할 수 있습니다.`,
        generatedAt,
    });
}
function snapshotBeforeRegistry(config, generatedAt) {
    const requestedMode = requestedModeFromConfig(config);
    if (requestedMode !== "orchestration") {
        return buildSnapshot({
            mode: "single_nobie",
            status: "ready",
            config,
            reasonCode: "mode_single_nobie",
            reason: "설정 모드가 single_nobie이므로 기존 단일 노비 경로로 동작합니다.",
            generatedAt,
        });
    }
    if (!isOrchestrationFeatureEnabled(config)) {
        return buildSnapshot({
            mode: "single_nobie",
            status: "ready",
            config,
            reasonCode: "feature_flag_off",
            reason: "orchestration feature flag가 꺼져 있어 기존 단일 노비 경로로 동작합니다.",
            generatedAt,
        });
    }
    return undefined;
}
export function resolveOrchestrationModeSnapshotSync(dependencies = {}) {
    const cfg = dependencies.getConfig?.() ?? getConfig();
    const config = cfg.orchestration;
    const generatedAt = dependencies.now?.() ?? Date.now();
    const preRegistrySnapshot = snapshotBeforeRegistry(config, generatedAt);
    if (preRegistrySnapshot)
        return preRegistrySnapshot;
    try {
        const loadRegistry = dependencies.loadRegistry ?? (() => defaultRegistryLoad(config));
        return snapshotFromRegistry(config, generatedAt, loadRegistry());
    }
    catch (error) {
        return registryErrorSnapshot(config, generatedAt, error);
    }
}
export async function resolveOrchestrationModeSnapshot(dependencies = {}) {
    const cfg = dependencies.getConfig?.() ?? getConfig();
    const config = cfg.orchestration;
    const generatedAt = dependencies.now?.() ?? Date.now();
    const preRegistrySnapshot = snapshotBeforeRegistry(config, generatedAt);
    if (preRegistrySnapshot)
        return preRegistrySnapshot;
    try {
        const loadRegistry = dependencies.loadRegistry ?? (() => defaultRegistryLoad(config));
        const registryPromise = Promise.resolve(loadRegistry());
        const timeoutMs = Math.max(1, dependencies.timeoutMs ?? 100);
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve("timeout"), timeoutMs);
        });
        const result = await Promise.race([registryPromise, timeoutPromise]);
        if (result === "timeout")
            return timeoutSnapshot(config, generatedAt);
        return snapshotFromRegistry(config, generatedAt, result);
    }
    catch (error) {
        return registryErrorSnapshot(config, generatedAt, error);
    }
}
export function orchestrationCapabilityStatus(snapshot) {
    if (snapshot.status === "degraded")
        return { status: "error", enabled: false };
    if (snapshot.mode === "orchestration")
        return { status: "ready", enabled: true };
    return { status: "ready", enabled: false };
}
//# sourceMappingURL=mode.js.map
