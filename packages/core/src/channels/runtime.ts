import type { NobieConfig } from "../config/types.js"
import {
  insertChannelRuntimeEvent,
  type DbChannelConnectionHealthStatus,
} from "../db/index.js"
import { getFeatureFlag, shouldUseNewPath, type RuntimeFeatureFlag } from "../runtime/rollout-safety.js"
import {
  type ChannelConnectionRecord,
  persistChannelConnections,
} from "./connections.js"
import type { ChannelCapabilities, ChannelProvider } from "./contracts.js"

export const CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY = "channel_registry_runtime"

export type ChannelRegistryRuntimeMode = "legacy" | "registry"
export type ChannelRuntimeStartDisposition =
  | "ready"
  | "started"
  | "skipped_disabled"
  | "skipped_unconfigured"
  | "unsupported_provider"
  | "failed"

export interface ChannelRuntimeAdapter {
  readonly provider: ChannelProvider
  readonly connectionId: string
  start(): Promise<void>
  stop(): Promise<void> | void
  healthCheck(): Promise<ChannelRuntimeHealth>
  getCapabilities(): ChannelCapabilities
}

export interface ChannelRuntimeHealth {
  status: DbChannelConnectionHealthStatus
  message: string | null
  checkedAt: number
  detail?: Record<string, unknown>
}

export interface ChannelProviderFactoryContext {
  config: NobieConfig
  connection: ChannelConnectionRecord
}

export interface ChannelProviderFactory {
  readonly provider: ChannelProvider
  create(context: ChannelProviderFactoryContext): ChannelRuntimeAdapter
}

export interface ChannelRuntimeSummary {
  connectionId: string
  provider: ChannelProvider
  displayName: string
  enabled: boolean
  configured: boolean
  supported: boolean
  disposition: ChannelRuntimeStartDisposition
  health: ChannelRuntimeHealth
  capabilities: ChannelCapabilities
  diagnostics: {
    connectionMode: ChannelConnectionRecord["connectionMode"]
    requiresLocalBridge: boolean
    requiresUserSession: boolean
    riskLevel: ChannelCapabilities["riskLevel"]
    manualConfirmationRequired: boolean
    configSource: ChannelConnectionRecord["configSource"]
  }
}

export interface ChannelRuntimeStartResult {
  mode: ChannelRegistryRuntimeMode
  featureFlag: Pick<RuntimeFeatureFlag, "featureKey" | "mode" | "compatibilityMode">
  summaries: ChannelRuntimeSummary[]
}

export function resolveChannelRegistryRuntimeMode(
  flag: RuntimeFeatureFlag = getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY),
): ChannelRegistryRuntimeMode {
  return shouldUseNewPath(flag) ? "registry" : "legacy"
}

export function recordChannelRuntimeEvent(input: {
  connection: ChannelConnectionRecord
  eventKind: string
  healthStatus?: DbChannelConnectionHealthStatus | null
  summary: string
  detail?: Record<string, unknown>
  now?: number
}): string {
  return insertChannelRuntimeEvent({
    connectionId: input.connection.connectionId,
    provider: input.connection.provider,
    eventKind: input.eventKind,
    healthStatus: input.healthStatus ?? null,
    summary: input.summary,
    detail: input.detail ?? {},
    createdAt: input.now ?? Date.now(),
  })
}

export function updateConnectionRuntimeHealth(
  connection: ChannelConnectionRecord,
  health: ChannelRuntimeHealth,
): ChannelConnectionRecord {
  const updated: ChannelConnectionRecord = {
    ...connection,
    health: {
      status: health.status,
      message: health.message,
      checkedAt: health.checkedAt,
    },
    updatedAt: health.checkedAt,
  }
  persistChannelConnections([updated])
  return updated
}

export function buildChannelRuntimeSummary(input: {
  connection: ChannelConnectionRecord
  capabilities?: ChannelCapabilities
  health: ChannelRuntimeHealth
  supported: boolean
  disposition: ChannelRuntimeStartDisposition
}): ChannelRuntimeSummary {
  const capabilities = input.capabilities ?? input.connection.capabilityManifest
  return {
    connectionId: input.connection.connectionId,
    provider: input.connection.provider,
    displayName: input.connection.displayName,
    enabled: input.connection.enabled,
    configured: input.connection.configured,
    supported: input.supported,
    disposition: input.disposition,
    health: input.health,
    capabilities,
    diagnostics: {
      connectionMode: input.connection.connectionMode,
      requiresLocalBridge: capabilities.requiresLocalBridge,
      requiresUserSession: capabilities.requiresUserSession,
      riskLevel: capabilities.riskLevel,
      manualConfirmationRequired: capabilities.manualConfirmationRequired === true,
      configSource: input.connection.configSource,
    },
  }
}
