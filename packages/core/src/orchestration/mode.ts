import { getConfig, type OrchestrationConfig } from "../config/index.js"
import { listAgentConfigs, type DbAgentConfig } from "../db/index.js"
import type { OrchestrationMode, SubAgentConfig } from "../contracts/sub-agent-orchestration.js"

export type OrchestrationRuntimeStatus = "ready" | "disabled" | "degraded"

export type OrchestrationModeReasonCode =
  | "feature_flag_off"
  | "mode_single_nobie"
  | "no_active_sub_agents"
  | "registry_load_failed"
  | "registry_load_timeout"
  | "orchestration_ready"

export interface OrchestrationRegistryAgentSnapshot {
  agentId: string
  displayName: string
  nickname?: string
  source: "db" | "config"
}

export interface OrchestrationModeSnapshot {
  mode: OrchestrationMode
  status: OrchestrationRuntimeStatus
  featureFlagEnabled: boolean
  requestedMode: OrchestrationMode
  activeSubAgentCount: number
  totalSubAgentCount: number
  disabledSubAgentCount: number
  activeSubAgents: OrchestrationRegistryAgentSnapshot[]
  reasonCode: OrchestrationModeReasonCode
  reason: string
  generatedAt: number
}

export interface RegistryLoadResult {
  activeSubAgents: OrchestrationRegistryAgentSnapshot[]
  totalSubAgentCount: number
  disabledSubAgentCount: number
}

interface ResolveOrchestrationModeDependencies {
  getConfig?: () => Pick<{ orchestration: OrchestrationConfig }, "orchestration">
  loadRegistry?: () => RegistryLoadResult | Promise<RegistryLoadResult>
  now?: () => number
  timeoutMs?: number
}

interface ResolveOrchestrationModeSyncDependencies {
  getConfig?: () => Pick<{ orchestration: OrchestrationConfig }, "orchestration">
  loadRegistry?: () => RegistryLoadResult
  now?: () => number
}

function requestedModeFromConfig(config: OrchestrationConfig): OrchestrationMode {
  return config.mode ?? "single_nobie"
}

function isOrchestrationFeatureEnabled(config: OrchestrationConfig): boolean {
  return config.featureFlagEnabled === true && requestedModeFromConfig(config) === "orchestration"
}

function configSubAgentSnapshot(agent: SubAgentConfig): OrchestrationRegistryAgentSnapshot {
  return {
    agentId: agent.agentId,
    displayName: agent.displayName,
    ...(agent.nickname ? { nickname: agent.nickname } : {}),
    source: "config",
  }
}

function dbSubAgentSnapshot(agent: DbAgentConfig): OrchestrationRegistryAgentSnapshot {
  return {
    agentId: agent.agent_id,
    displayName: agent.display_name,
    ...(agent.nickname ? { nickname: agent.nickname } : {}),
    source: "db",
  }
}

function mergeRegistryAgents(
  dbAgents: OrchestrationRegistryAgentSnapshot[],
  configAgents: OrchestrationRegistryAgentSnapshot[],
): OrchestrationRegistryAgentSnapshot[] {
  const merged = new Map<string, OrchestrationRegistryAgentSnapshot>()
  for (const agent of configAgents) merged.set(agent.agentId, agent)
  for (const agent of dbAgents) merged.set(agent.agentId, agent)
  return [...merged.values()].sort((a, b) => a.agentId.localeCompare(b.agentId))
}

function defaultRegistryLoad(config: OrchestrationConfig): RegistryLoadResult {
  const dbAgents = listAgentConfigs({ enabledOnly: true, agentType: "sub_agent" }).map(dbSubAgentSnapshot)
  const configAgents = (config.subAgents ?? [])
    .filter((agent) => agent.status === "enabled" && agent.delegation.enabled)
    .map(configSubAgentSnapshot)
  const activeSubAgents = mergeRegistryAgents(dbAgents, configAgents)
  const configSubAgentCount = config.subAgents?.length ?? 0
  const configDisabledCount = (config.subAgents ?? []).filter((agent) => agent.status !== "enabled" || !agent.delegation.enabled).length

  return {
    activeSubAgents,
    totalSubAgentCount: Math.max(configSubAgentCount, activeSubAgents.length),
    disabledSubAgentCount: configDisabledCount,
  }
}

function buildSnapshot(input: {
  mode: OrchestrationMode
  status: OrchestrationRuntimeStatus
  config: OrchestrationConfig
  activeSubAgents?: OrchestrationRegistryAgentSnapshot[]
  totalSubAgentCount?: number
  disabledSubAgentCount?: number
  reasonCode: OrchestrationModeReasonCode
  reason: string
  generatedAt: number
}): OrchestrationModeSnapshot {
  const activeSubAgents = input.activeSubAgents ?? []
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
  }
}

function timeoutSnapshot(config: OrchestrationConfig, generatedAt: number): OrchestrationModeSnapshot {
  return buildSnapshot({
    mode: "single_nobie",
    status: "degraded",
    config,
    reasonCode: "registry_load_timeout",
    reason: "서브 에이전트 registry 조회가 시간 내 완료되지 않아 단일 노비 모드로 fallback했습니다.",
    generatedAt,
  })
}

function registryErrorSnapshot(config: OrchestrationConfig, generatedAt: number, error: unknown): OrchestrationModeSnapshot {
  const detail = error instanceof Error ? error.message : String(error)
  return buildSnapshot({
    mode: "single_nobie",
    status: "degraded",
    config,
    reasonCode: "registry_load_failed",
    reason: `서브 에이전트 registry 조회에 실패해 단일 노비 모드로 fallback했습니다: ${detail}`,
    generatedAt,
  })
}

function snapshotFromRegistry(config: OrchestrationConfig, generatedAt: number, registry: RegistryLoadResult): OrchestrationModeSnapshot {
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
        ? "활성화된 서브 에이전트가 없어 단일 노비 모드로 동작합니다."
        : "등록된 서브 에이전트가 없어 단일 노비 모드로 동작합니다.",
      generatedAt,
    })
  }

  return buildSnapshot({
    mode: "orchestration",
    status: "ready",
    config,
    activeSubAgents: registry.activeSubAgents,
    totalSubAgentCount: registry.totalSubAgentCount,
    disabledSubAgentCount: registry.disabledSubAgentCount,
    reasonCode: "orchestration_ready",
    reason: `활성 서브 에이전트 ${registry.activeSubAgents.length}개가 준비되어 orchestration 모드로 동작할 수 있습니다.`,
    generatedAt,
  })
}

function snapshotBeforeRegistry(config: OrchestrationConfig, generatedAt: number): OrchestrationModeSnapshot | undefined {
  const requestedMode = requestedModeFromConfig(config)

  if (requestedMode !== "orchestration") {
    return buildSnapshot({
      mode: "single_nobie",
      status: "ready",
      config,
      reasonCode: "mode_single_nobie",
      reason: "설정 모드가 single_nobie이므로 기존 단일 노비 경로로 동작합니다.",
      generatedAt,
    })
  }

  if (!isOrchestrationFeatureEnabled(config)) {
    return buildSnapshot({
      mode: "single_nobie",
      status: "ready",
      config,
      reasonCode: "feature_flag_off",
      reason: "orchestration feature flag가 꺼져 있어 기존 단일 노비 경로로 동작합니다.",
      generatedAt,
    })
  }

  return undefined
}

export function resolveOrchestrationModeSnapshotSync(
  dependencies: ResolveOrchestrationModeSyncDependencies = {},
): OrchestrationModeSnapshot {
  const cfg = dependencies.getConfig?.() ?? getConfig()
  const config = cfg.orchestration
  const generatedAt = dependencies.now?.() ?? Date.now()
  const preRegistrySnapshot = snapshotBeforeRegistry(config, generatedAt)
  if (preRegistrySnapshot) return preRegistrySnapshot

  try {
    const loadRegistry = dependencies.loadRegistry ?? (() => defaultRegistryLoad(config))
    return snapshotFromRegistry(config, generatedAt, loadRegistry())
  } catch (error) {
    return registryErrorSnapshot(config, generatedAt, error)
  }
}

export async function resolveOrchestrationModeSnapshot(
  dependencies: ResolveOrchestrationModeDependencies = {},
): Promise<OrchestrationModeSnapshot> {
  const cfg = dependencies.getConfig?.() ?? getConfig()
  const config = cfg.orchestration
  const generatedAt = dependencies.now?.() ?? Date.now()
  const preRegistrySnapshot = snapshotBeforeRegistry(config, generatedAt)
  if (preRegistrySnapshot) return preRegistrySnapshot

  try {
    const loadRegistry = dependencies.loadRegistry ?? (() => defaultRegistryLoad(config))
    const registryPromise = Promise.resolve(loadRegistry())
    const timeoutMs = Math.max(1, dependencies.timeoutMs ?? 100)
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs)
    })
    const result = await Promise.race([registryPromise, timeoutPromise])
    if (result === "timeout") return timeoutSnapshot(config, generatedAt)
    return snapshotFromRegistry(config, generatedAt, result)
  } catch (error) {
    return registryErrorSnapshot(config, generatedAt, error)
  }
}

export function orchestrationCapabilityStatus(snapshot: OrchestrationModeSnapshot): {
  status: "ready" | "disabled" | "error"
  enabled: boolean
} {
  if (snapshot.status === "degraded") return { status: "error", enabled: false }
  if (snapshot.mode === "orchestration") return { status: "ready", enabled: true }
  return { status: "ready", enabled: false }
}
