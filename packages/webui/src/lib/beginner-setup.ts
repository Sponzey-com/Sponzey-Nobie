import type { SetupChecksResponse } from "../api/adapters/types"
import type { AIAuthMode, AIBackendCard, AIBackendCredentials, AIProviderType } from "../contracts/ai"
import { getAIProviderDefaultEndpoint, hasRequiredProviderCredentials, isLocalProviderType } from "../contracts/ai"
import type { SetupDraft } from "../contracts/setup"
import type { UiShellResponse } from "../api/client"
import type { UiLanguage } from "../stores/uiLanguage"
import { formatWebUiErrorMessage, uiCatalogText } from "./message-catalog"
import { getPreferredSingleAiBackendId, setSingleAiBackendEnabled } from "./single-ai"

export type BeginnerSetupStepId = "ai" | "channels" | "computer" | "test"
export type BeginnerSetupStepStatus = "done" | "needs_attention" | "skipped"
export type BeginnerConnectionStatus = "ready" | "needs_attention" | "idle"

export interface BeginnerSetupStepView {
  id: BeginnerSetupStepId
  label: string
  description: string
  status: BeginnerSetupStepStatus
  statusLabel: string
}

export interface BeginnerConnectionCardView {
  id: "ai" | "channels" | "yeonjang" | "storage"
  title: string
  status: BeginnerConnectionStatus
  statusLabel: string
  summary: string
  actionLabel: string
  href: string
}

export interface BeginnerAiConnectionInput {
  providerType: AIProviderType
  authMode: AIAuthMode
  endpoint?: string
  defaultModel: string
  credentials: AIBackendCredentials
}

export interface BeginnerSetupSmokeResult {
  ok: boolean
  missing: BeginnerSetupStepId[]
  summary: string
}

function cloneDraft(draft: SetupDraft): SetupDraft {
  return JSON.parse(JSON.stringify(draft)) as SetupDraft
}

function statusLabel(status: BeginnerSetupStepStatus | BeginnerConnectionStatus, language: UiLanguage): string {
  switch (status) {
    case "done":
    case "ready":
      return uiCatalogText(language, "beginner.setup.status.ready")
    case "needs_attention":
      return uiCatalogText(language, "beginner.setup.status.needsAttention")
    case "skipped":
    case "idle":
      return uiCatalogText(language, "beginner.setup.status.skipped")
  }
}

export function getBeginnerActiveAiBackend(draft: SetupDraft): AIBackendCard | null {
  const backendId = getPreferredSingleAiBackendId(draft.aiBackends, null)
  return draft.aiBackends.find((backend) => backend.id === backendId) ?? draft.aiBackends[0] ?? null
}

export function isBeginnerAiConfigured(draft: SetupDraft): boolean {
  const backend = getBeginnerActiveAiBackend(draft)
  if (!backend) return false
  const endpoint = backend.endpoint?.trim() || getAIProviderDefaultEndpoint(backend.providerType)
  return Boolean(backend.enabled && endpoint && backend.defaultModel.trim() && hasRequiredProviderCredentials(backend.providerType, backend.credentials, backend.authMode))
}

export function isBeginnerChannelConfigured(draft: SetupDraft): boolean {
  const telegramReady = draft.channels.telegramEnabled && draft.channels.botToken.trim().length > 0
  const slackReady = draft.channels.slackEnabled && draft.channels.slackBotToken.trim().length > 0 && draft.channels.slackAppToken.trim().length > 0
  return telegramReady || slackReady
}

export function isBeginnerComputerConfigured(draft: SetupDraft, shell?: UiShellResponse | null): boolean {
  return Boolean(draft.mqtt.enabled || shell?.runtimeHealth.yeonjang.connectedExtensions)
}

export function buildBeginnerSetupSteps(input: {
  draft: SetupDraft
  checks: SetupChecksResponse | null
  shell?: UiShellResponse | null
  language: UiLanguage
  aiTestOk?: boolean | null
}): BeginnerSetupStepView[] {
  const aiReady = input.aiTestOk === true || isBeginnerAiConfigured(input.draft)
  const channelReady = isBeginnerChannelConfigured(input.draft)
  const computerReady = isBeginnerComputerConfigured(input.draft, input.shell)
  const testReady = aiReady && Boolean(input.checks?.setupStateFile || input.checks?.configFile)
  const steps: Array<{ id: BeginnerSetupStepId; labelKey: Parameters<typeof uiCatalogText>[1]; descKey: Parameters<typeof uiCatalogText>[1]; status: BeginnerSetupStepStatus }> = [
    { id: "ai", labelKey: "beginner.setup.step.ai", descKey: "beginner.setup.step.aiDesc", status: aiReady ? "done" : "needs_attention" },
    { id: "channels", labelKey: "beginner.setup.step.channels", descKey: "beginner.setup.step.channelsDesc", status: channelReady ? "done" : "skipped" },
    { id: "computer", labelKey: "beginner.setup.step.computer", descKey: "beginner.setup.step.computerDesc", status: computerReady ? "done" : "skipped" },
    { id: "test", labelKey: "beginner.setup.step.test", descKey: "beginner.setup.step.testDesc", status: testReady ? "done" : "needs_attention" },
  ]
  return steps.map((step) => ({
    id: step.id,
    label: uiCatalogText(input.language, step.labelKey),
    description: uiCatalogText(input.language, step.descKey),
    status: step.status,
    statusLabel: statusLabel(step.status, input.language),
  }))
}

export function buildBeginnerConnectionCards(input: {
  draft: SetupDraft
  checks: SetupChecksResponse | null
  shell?: UiShellResponse | null
  language: UiLanguage
}): BeginnerConnectionCardView[] {
  const aiReady = isBeginnerAiConfigured(input.draft) || input.shell?.runtimeHealth.ai.configured === true
  const channelReady = isBeginnerChannelConfigured(input.draft) || input.shell?.runtimeHealth.channels.telegramEnabled === true || input.shell?.runtimeHealth.channels.slackEnabled === true
  const yeonjangReady = Boolean(input.shell?.runtimeHealth.yeonjang.connectedExtensions)
  const storageReady = Boolean(input.checks?.configFile && input.checks?.setupStateFile)
  const values: Array<{ id: BeginnerConnectionCardView["id"]; titleKey: Parameters<typeof uiCatalogText>[1]; ready: boolean; idle?: boolean; readySummary: Parameters<typeof uiCatalogText>[1]; attentionSummary: Parameters<typeof uiCatalogText>[1]; actionKey: Parameters<typeof uiCatalogText>[1]; href: string }> = [
    { id: "ai", titleKey: "beginner.connection.ai", ready: aiReady, readySummary: "beginner.connection.aiReady", attentionSummary: "beginner.connection.aiActionNeeded", actionKey: "beginner.connection.aiAction", href: "#setup-ai" },
    { id: "channels", titleKey: "beginner.connection.channels", ready: channelReady, idle: true, readySummary: "beginner.connection.channelsReady", attentionSummary: "beginner.connection.channelsOptional", actionKey: "beginner.connection.channelsAction", href: "#setup-channels" },
    { id: "yeonjang", titleKey: "beginner.connection.yeonjang", ready: yeonjangReady, idle: true, readySummary: "beginner.connection.yeonjangReady", attentionSummary: "beginner.connection.yeonjangOptional", actionKey: "beginner.connection.yeonjangAction", href: "#setup-computer" },
    { id: "storage", titleKey: "beginner.connection.storage", ready: storageReady, readySummary: "beginner.connection.storageReady", attentionSummary: "beginner.connection.storageActionNeeded", actionKey: "beginner.connection.storageAction", href: "#setup-test" },
  ]

  return values.map((value) => {
    const status: BeginnerConnectionStatus = value.ready ? "ready" : value.idle ? "idle" : "needs_attention"
    return {
      id: value.id,
      title: uiCatalogText(input.language, value.titleKey),
      status,
      statusLabel: statusLabel(status, input.language),
      summary: uiCatalogText(input.language, value.ready ? value.readySummary : value.attentionSummary),
      actionLabel: uiCatalogText(input.language, value.actionKey),
      href: value.href,
    }
  })
}

export function upsertBeginnerAiBackend(draft: SetupDraft, input: BeginnerAiConnectionInput): SetupDraft {
  const next = cloneDraft(draft)
  const existing = getBeginnerActiveAiBackend(next)
  const endpoint = input.endpoint?.trim() || getAIProviderDefaultEndpoint(input.providerType)
  const backend: AIBackendCard = {
    id: existing?.id ?? `provider:${input.providerType}`,
    label: existing?.label || input.providerType.toUpperCase(),
    kind: "provider",
    providerType: input.providerType,
    authMode: input.authMode,
    credentials: { ...input.credentials },
    local: isLocalProviderType(input.providerType),
    enabled: true,
    availableModels: existing?.availableModels ?? [],
    defaultModel: input.defaultModel.trim(),
    status: input.defaultModel.trim() && endpoint ? "ready" : "disabled",
    summary: existing?.summary || "Primary AI connection",
    tags: existing?.tags ?? ["primary"],
    ...(endpoint ? { endpoint } : {}),
  }
  const exists = next.aiBackends.some((item) => item.id === backend.id)
  const withBackend = {
    ...next,
    aiBackends: exists ? next.aiBackends.map((item) => (item.id === backend.id ? backend : item)) : [...next.aiBackends, backend],
  }
  const enabled = setSingleAiBackendEnabled(withBackend, backend.id, true)
  if (enabled.routingProfiles.length === 0) {
    return {
      ...enabled,
      routingProfiles: [{ id: "default", label: "Default", targets: [backend.id] }],
    }
  }
  return enabled
}

export function markBeginnerAiTestResult(draft: SetupDraft, backendId: string, result: { ok: boolean; models?: string[]; message?: string }): SetupDraft {
  const next = cloneDraft(draft)
  return {
    ...next,
    aiBackends: next.aiBackends.map((backend) => backend.id === backendId
      ? {
          ...backend,
          status: result.ok ? "ready" : "error",
          ...(result.models ? { availableModels: result.models } : {}),
          ...(result.ok && result.models?.length && !result.models.includes(backend.defaultModel) ? { defaultModel: result.models[0] ?? backend.defaultModel } : {}),
          ...(result.message ? { reason: result.message } : {}),
        }
      : backend),
  }
}

export function sanitizeBeginnerSetupError(error: unknown, language: UiLanguage): string {
  const raw = error instanceof Error ? error.message : String(error ?? "")
  return formatWebUiErrorMessage(raw, language).message
}

export function buildBeginnerSetupSmokeResult(input: { draft: SetupDraft; checks: SetupChecksResponse | null; shell?: UiShellResponse | null; language: UiLanguage }): BeginnerSetupSmokeResult {
  const steps = buildBeginnerSetupSteps({ ...input, aiTestOk: null })
  const missing = steps.filter((step) => step.status === "needs_attention").map((step) => step.id)
  return {
    ok: missing.length === 0,
    missing,
    summary: missing.length === 0
      ? uiCatalogText(input.language, "beginner.setup.smokeReady")
      : uiCatalogText(input.language, "beginner.setup.smokeNeedsAction"),
  }
}
