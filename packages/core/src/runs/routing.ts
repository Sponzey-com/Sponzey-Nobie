import { buildSetupDraft, type AIBackendCard, type RoutingProfile, type SetupDraft } from "../control-plane/index.js"
import { getConfig } from "../config/index.js"
import { getDefaultModel, inferProviderId, type LLMProvider } from "../llm/index.js"
import { AnthropicProvider } from "../llm/providers/anthropic.js"
import { OpenAIProvider } from "../llm/providers/openai.js"
import type { AuthProfile } from "../llm/types.js"
import {
  isWorkerRuntimeAvailable,
  resolveWorkerRuntimeTarget,
  type WorkerAvailabilityOverrides,
  type WorkerRuntimeTarget,
} from "./worker-runtime.js"

export interface RouteActionInput {
  preferredTarget?: string | undefined
  taskProfile?: string | undefined
  fallbackModel?: string | undefined
  avoidTargets?: string[] | undefined
}

export interface ResolvedRunRoute {
  targetId?: string
  targetLabel?: string
  providerId?: string
  model?: string
  provider?: LLMProvider
  workerRuntime?: WorkerRuntimeTarget
  reason: string
}

export interface RouteResolutionOptions {
  workerAvailability?: WorkerAvailabilityOverrides
}

export function resolveRunRoute(input: RouteActionInput): ResolvedRunRoute {
  return resolveRunRouteFromDraft(buildSetupDraft(), input)
}

export function resolveRunRouteFromDraft(
  draft: SetupDraft,
  input: RouteActionInput,
  options?: RouteResolutionOptions,
): ResolvedRunRoute {
  const candidates = buildCandidateTargets(draft, input)

  for (const targetId of candidates) {
    const backend = draft.aiBackends.find((item) => item.id === targetId)
    if (!backend || !backend.enabled) continue
    const resolved = resolveBackend(backend, input.fallbackModel, options)
    if (resolved) {
      return {
        targetId: backend.id,
        targetLabel: backend.label,
        ...resolved,
        reason: `routing:${backend.id}`,
      }
    }
  }

  const fallbackModel = input.fallbackModel ?? getDefaultModel()
  return {
    providerId: inferProviderId(fallbackModel),
    model: fallbackModel,
    reason: "routing:fallback-default-model",
  }
}

function buildCandidateTargets(draft: SetupDraft, input: RouteActionInput): string[] {
  const result: string[] = []
  const avoided = new Set(
    (input.avoidTargets ?? [])
      .flatMap((value) => expandAvoidTargetIds(normalizeTargetId(value) ?? value))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  )
  const add = (value: string | undefined) => {
    if (!value || result.includes(value) || avoided.has(value)) return
    result.push(value)
  }

  const preferred = normalizeTargetId(input.preferredTarget)
  if (preferred) add(preferred)

  const taskProfile = isRoutingProfileId(input.taskProfile) ? input.taskProfile : "default"
  const profile = draft.routingProfiles.find((item) => item.id === taskProfile)
  const defaultProfile = draft.routingProfiles.find((item) => item.id === "default")

  for (const target of profile?.targets ?? []) add(target)
  for (const target of defaultProfile?.targets ?? []) add(target)

  for (const backend of draft.aiBackends) {
    if (backend.enabled) add(backend.id)
  }

  return result
}

function expandAvoidTargetIds(value: string | undefined): string[] {
  if (!value) return []
  const normalized = value.trim()
  if (!normalized) return []
  if (normalized.includes(":")) return [normalized]
  return [normalized, `provider:${normalized}`, `worker:${normalized}`]
}

function resolveBackend(
  backend: AIBackendCard,
  fallbackModel: string | undefined,
  options?: RouteResolutionOptions,
): Omit<ResolvedRunRoute, "targetId" | "targetLabel" | "reason"> | null {
  const workerRuntime = resolveWorkerRuntimeForBackend(backend, options?.workerAvailability)
  if (workerRuntime) {
    const providerId = inferWorkerRuntimeProviderId(backend)
    const model = backend.defaultModel.trim() || fallbackModel
    return {
      workerRuntime,
      ...(providerId ? { providerId } : {}),
      ...(model ? { model } : {}),
    }
  }

  switch (backend.providerType) {
    case "claude": {
      const apiKey = backend.credentials.apiKey?.trim()
      if (!apiKey) return null
      return {
        providerId: "anthropic",
        model: backend.defaultModel.trim() || fallbackModel || getAnthropicFallbackModel(),
        provider: new AnthropicProvider(buildProfile([apiKey])),
      }
    }

    case "openai": {
      const profile = buildProfile([backend.credentials.apiKey?.trim() || "nobie-local"])
      const model = backend.defaultModel.trim() || fallbackModel || getDefaultModel()
      return {
        providerId: "openai",
        model,
        provider: new OpenAIProvider(profile, backend.endpoint?.trim() || undefined),
      }
    }

    case "ollama":
    case "llama": {
      const endpoint = backend.endpoint?.trim()
        || (backend.providerType === "ollama" ? getConfig().llm.providers.ollama?.baseUrl?.trim() : undefined)
      if (!endpoint) return null
      const profile = buildProfile([backend.credentials.apiKey?.trim() || "nobie-local"])
      const model = backend.defaultModel.trim() || fallbackModel
      if (!model) return null
      return {
        providerId: "openai",
        model,
        provider: new OpenAIProvider(profile, endpoint),
      }
    }

    case "custom": {
      const endpoint = backend.endpoint?.trim()
      if (!endpoint) return null
      const apiKey = backend.credentials.apiKey?.trim() || "nobie-custom"
      const model = backend.defaultModel.trim() || fallbackModel
      if (!model) return null
      return {
        providerId: "openai",
        model,
        provider: new OpenAIProvider(buildProfile([apiKey]), endpoint),
      }
    }

    case "gemini":
      return null
  }
}

function buildProfile(apiKeys: string[]): AuthProfile {
  return {
    apiKeys,
    currentKeyIndex: 0,
    cooldowns: new Map(),
  }
}

function normalizeTargetId(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim()
  if (!normalized || normalized === "auto" || normalized === "embedded" || normalized === "local_reasoner") {
    return undefined
  }
  return normalized
}

function isRoutingProfileId(value: string | undefined): value is RoutingProfile["id"] {
  return value === "default"
    || value === "general_chat"
    || value === "planning"
    || value === "coding"
    || value === "review"
    || value === "research"
    || value === "private_local"
    || value === "summarization"
    || value === "operations"
}

function resolveWorkerRuntimeForBackend(
  backend: AIBackendCard,
  overrides?: WorkerAvailabilityOverrides,
): WorkerRuntimeTarget | undefined {
  if (backend.id === "worker:claude_code" && isWorkerRuntimeAvailable("claude_code", overrides)) {
    return resolveWorkerRuntimeTarget("claude_code")
  }
  if (backend.id === "worker:codex_cli" && isWorkerRuntimeAvailable("codex_cli", overrides)) {
    return resolveWorkerRuntimeTarget("codex_cli")
  }
  return undefined
}

function inferWorkerRuntimeProviderId(backend: AIBackendCard): string | undefined {
  if (backend.providerType === "claude") return "anthropic"
  if (backend.providerType === "openai" || backend.providerType === "custom") return "openai"
  return undefined
}

function getAnthropicFallbackModel(): string {
  const config = getConfig()
  if (config.llm.defaultProvider === "anthropic" && config.llm.defaultModel.trim()) {
    return config.llm.defaultModel
  }
  return "claude-3-5-haiku-20241022"
}
