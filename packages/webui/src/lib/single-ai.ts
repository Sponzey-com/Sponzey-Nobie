import type { AIBackendCard, AIProviderType } from "../contracts/ai"
import type { SetupDraft } from "../contracts/setup"

function hasConfiguredBackend(backend: AIBackendCard): boolean {
  return Boolean(
    backend.defaultModel.trim()
    || backend.endpoint?.trim()
    || backend.credentials.apiKey?.trim()
    || backend.credentials.oauthAuthFilePath?.trim(),
  )
}

export function getPreferredSingleAiBackendId(backends: AIBackendCard[], preferredId?: string | null): string | null {
  if (preferredId && backends.some((backend) => backend.id === preferredId)) return preferredId

  const enabled = backends.find((backend) => backend.enabled)
  if (enabled) return enabled.id

  const configured = backends.find((backend) => hasConfiguredBackend(backend))
  if (configured) return configured.id

  return backends[0]?.id ?? null
}

export function setSingleAiBackendEnabled(draft: SetupDraft, backendId: string, enabled: boolean): SetupDraft {
  return {
    ...draft,
    aiBackends: draft.aiBackends.map((backend) => ({
      ...backend,
      enabled: enabled ? backend.id === backendId : false,
    })),
    routingProfiles: draft.routingProfiles.map((profile) => ({
      ...profile,
      targets: enabled ? [backendId] : [],
    })),
  }
}

export function getActiveSingleAiBackend(draft: SetupDraft, preferredId?: string | null): AIBackendCard | null {
  const backendId = getPreferredSingleAiBackendId(draft.aiBackends, preferredId)
  if (!backendId) return null
  return draft.aiBackends.find((backend) => backend.id === backendId) ?? null
}

export function getSingleAiBackendIdByProviderType(
  backends: AIBackendCard[],
  providerType: AIProviderType,
): string | null {
  return backends.find((backend) => backend.providerType === providerType)?.id ?? null
}
