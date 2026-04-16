import { buildSetupDraft, type AIBackendCard, type SetupDraft } from "../control-plane/index.js"
import {
  resolveProviderForConnection,
  type AIProvider,
  type ProviderAuditTrace,
} from "../ai/index.js"
import type { AIConnectionConfig } from "../config/types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

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
  provider?: AIProvider
  providerTrace?: ProviderAuditTrace
  workerRuntime?: WorkerRuntimeTarget
  reason: string
}

export interface RouteResolutionOptions {}

export function resolveRunRoute(input: RouteActionInput): ResolvedRunRoute {
  return resolveRunRouteFromDraft(buildSetupDraft(), input)
}

export function resolveRunRouteFromDraft(
  draft: SetupDraft,
  input: RouteActionInput,
  options?: RouteResolutionOptions,
): ResolvedRunRoute {
  const candidates = buildConfiguredCandidateTargets(draft, input)

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

  return {
    reason: "routing:no-configured-ai-backend",
  }
}

function buildConfiguredCandidateTargets(draft: SetupDraft, input: RouteActionInput): string[] {
  const result: string[] = []
  const defaultTargets = draft.routingProfiles.find((item) => item.id === "default")?.targets ?? []
  const avoided = new Set(
    (input.avoidTargets ?? [])
      .flatMap((value) => expandAvoidTargetIds(normalizeTargetId(value) ?? value))
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  )
  const add = (value: string | undefined) => {
    if (!value || result.includes(value) || avoided.has(value)) return
    result.push(value)
  }

  add(defaultTargets[0])

  return result
}

function expandAvoidTargetIds(value: string | undefined): string[] {
  if (!value) return []
  const normalized = value.trim()
  if (!normalized) return []
  if (normalized.includes(":")) return [normalized]
  return [normalized, `provider:${normalized}`]
}

function resolveBackend(
  backend: AIBackendCard,
  _fallbackModel: string | undefined,
  _options?: RouteResolutionOptions,
): Omit<ResolvedRunRoute, "targetId" | "targetLabel" | "reason"> | null {
  const connection = backendToConnection(backend)
  const resolved = resolveProviderForConnection(connection)
  if (!resolved) return null
  return {
    providerId: resolved.providerId,
    model: resolved.model,
    provider: resolved.provider,
    providerTrace: resolved.resolution.auditTrace,
  }
}

function backendToConnection(backend: AIBackendCard): AIConnectionConfig {
  const endpoint = backend.endpoint?.trim()
  return {
    provider: backend.providerType,
    model: resolveConfiguredModel(backend),
    ...(endpoint ? { endpoint } : {}),
    auth: {
      mode: backend.authMode ?? "api_key",
      ...(backend.credentials.apiKey?.trim() ? { apiKey: backend.credentials.apiKey.trim() } : {}),
      ...(backend.credentials.username?.trim() ? { username: backend.credentials.username.trim() } : {}),
      ...(backend.credentials.password ? { password: backend.credentials.password } : {}),
      ...(backend.credentials.oauthAuthFilePath?.trim() ? { oauthAuthFilePath: backend.credentials.oauthAuthFilePath.trim() } : {}),
    },
  }
}

function normalizeTargetId(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim()
  if (!normalized || normalized === "auto" || normalized === "embedded" || normalized === "local_reasoner") {
    return undefined
  }
  if (normalized === "anthropic") {
    return "provider:anthropic"
  }
  if (normalized === "openai") return "provider:openai"
  if (normalized === "gemini") return "provider:gemini"
  if (normalized === "ollama") return "provider:ollama"
  if (normalized === "llama" || normalized === "llama_cpp") return "provider:llama_cpp"
  return normalized
}

function resolveConfiguredModel(backend: AIBackendCard): string {
  if (backend.defaultModel.trim()) return backend.defaultModel.trim()
  return ""
}
