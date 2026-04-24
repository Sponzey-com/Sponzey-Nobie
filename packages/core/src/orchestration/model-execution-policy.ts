import type {
  AgentPromptBundle,
  ModelExecutionSnapshot,
  ModelProfile,
} from "../contracts/sub-agent-orchestration.js"

export type ModelAvailabilityStatus = "available" | "degraded" | "unavailable"

export interface ProviderModelCapability {
  providerId: string
  modelId: string
  available: boolean
  contextWindowTokens: number | null
  maxOutputTokens: number
  inputCostPer1kTokens: number
  outputCostPer1kTokens: number
  supportedEfforts?: string[]
  reasonCodes?: string[]
}

export interface ModelAvailabilityDoctorSnapshot {
  providerId: string
  modelId: string
  status: ModelAvailabilityStatus
  reasonCodes: string[]
  checkedAt?: number
}

export interface ResolvedModelExecutionPolicy {
  status: "allowed" | "blocked"
  reasonCode: string
  userMessage: string
  snapshot?: ModelExecutionSnapshot
  primaryModel?: ProviderModelCapability
  activeModel?: ProviderModelCapability
  diagnostics: string[]
}

export interface ModelExecutionAuditSummary extends ModelExecutionSnapshot {
  status: "completed" | "failed" | "blocked"
  tokenUsage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimated: true
  }
}

export const DEFAULT_MODEL_TIMEOUT_MS = 30_000
export const DEFAULT_MODEL_RETRY_COUNT = 0

export const DEFAULT_PROVIDER_MODEL_CAPABILITY_MATRIX: ProviderModelCapability[] = [
  {
    providerId: "openai",
    modelId: "gpt-5.4",
    available: true,
    contextWindowTokens: 400_000,
    maxOutputTokens: 32_768,
    inputCostPer1kTokens: 0.01,
    outputCostPer1kTokens: 0.03,
    supportedEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    providerId: "openai",
    modelId: "gpt-5.4-mini",
    available: true,
    contextWindowTokens: 400_000,
    maxOutputTokens: 32_768,
    inputCostPer1kTokens: 0.002,
    outputCostPer1kTokens: 0.008,
    supportedEfforts: ["low", "medium", "high"],
  },
  {
    providerId: "openai",
    modelId: "gpt-5.3-codex",
    available: true,
    contextWindowTokens: 400_000,
    maxOutputTokens: 32_768,
    inputCostPer1kTokens: 0.012,
    outputCostPer1kTokens: 0.036,
    supportedEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    providerId: "anthropic",
    modelId: "claude-3.5-sonnet",
    available: true,
    contextWindowTokens: 200_000,
    maxOutputTokens: 8192,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
  },
  {
    providerId: "gemini",
    modelId: "gemini-2.5-pro",
    available: true,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 8192,
    inputCostPer1kTokens: 0.00125,
    outputCostPer1kTokens: 0.01,
  },
  {
    providerId: "ollama",
    modelId: "*",
    available: true,
    contextWindowTokens: null,
    maxOutputTokens: 8192,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
  },
  {
    providerId: "custom",
    modelId: "*",
    available: true,
    contextWindowTokens: null,
    maxOutputTokens: 8192,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
  },
]

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

export function estimateTokenCount(text: string | undefined): number {
  const normalized = text?.trim() ?? ""
  if (!normalized) return 0
  return Math.max(1, Math.ceil(normalized.length / 4))
}

function findModelCapability(
  matrix: ProviderModelCapability[],
  providerId: string,
  modelId: string,
): ProviderModelCapability | undefined {
  const provider = normalize(providerId)
  const model = normalize(modelId)
  return matrix.find(
    (entry) =>
      normalize(entry.providerId) === provider &&
      (normalize(entry.modelId) === model || entry.modelId === "*"),
  )
}

function findDoctorSnapshot(
  doctor: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[] | undefined,
  providerId: string,
  modelId: string,
): ModelAvailabilityDoctorSnapshot | undefined {
  const rows = Array.isArray(doctor) ? doctor : doctor ? [doctor] : []
  const provider = normalize(providerId)
  const model = normalize(modelId)
  return rows.find(
    (entry) => normalize(entry.providerId) === provider && normalize(entry.modelId) === model,
  )
}

export function estimateModelExecutionCost(input: {
  capability: ProviderModelCapability
  inputTokens: number
  outputTokens: number
}): number {
  return Number(
    (
      (Math.max(0, input.inputTokens) / 1000) * input.capability.inputCostPer1kTokens +
      (Math.max(0, input.outputTokens) / 1000) * input.capability.outputCostPer1kTokens
    ).toFixed(6),
  )
}

function modelBlocked(input: {
  reasonCode: string
  userMessage: string
  diagnostics?: string[]
}): ResolvedModelExecutionPolicy {
  return {
    status: "blocked",
    reasonCode: input.reasonCode,
    userMessage: input.userMessage,
    diagnostics: unique([input.reasonCode, ...(input.diagnostics ?? [])]),
  }
}

function buildSnapshot(input: {
  profile: ModelProfile
  active: ProviderModelCapability
  inputTokens: number
  outputTokens: number
  fallbackApplied: boolean
  fallbackFromModelId?: string
  fallbackReasonCode?: string
  reasonCodes: string[]
}): ModelExecutionSnapshot {
  const timeoutMs = input.profile.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS
  const retryCount = Math.max(0, Math.floor(input.profile.retryCount ?? DEFAULT_MODEL_RETRY_COUNT))
  return {
    providerId: input.profile.providerId,
    modelId: input.active.modelId === "*" ? input.profile.modelId : input.active.modelId,
    ...(input.profile.effort ? { effort: input.profile.effort } : {}),
    fallbackApplied: input.fallbackApplied,
    ...(input.fallbackFromModelId ? { fallbackFromModelId: input.fallbackFromModelId } : {}),
    ...(input.fallbackReasonCode ? { fallbackReasonCode: input.fallbackReasonCode } : {}),
    timeoutMs,
    retryCount,
    ...(input.profile.costBudget !== undefined ? { costBudget: input.profile.costBudget } : {}),
    maxOutputTokens: Math.min(
      input.profile.maxOutputTokens ?? input.active.maxOutputTokens,
      input.active.maxOutputTokens,
    ),
    estimatedInputTokens: input.inputTokens,
    estimatedOutputTokens: input.outputTokens,
    estimatedCost: estimateModelExecutionCost({
      capability: input.active,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    }),
    reasonCodes: unique(input.reasonCodes),
  }
}

function resolveActiveModel(input: {
  profile: ModelProfile
  matrix: ProviderModelCapability[]
  doctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[]
  inputTokens: number
  outputTokens: number
  forceFallbackReasonCode?: string
}): ResolvedModelExecutionPolicy {
  const primary = findModelCapability(input.matrix, input.profile.providerId, input.profile.modelId)
  const fallbackModelId = input.profile.fallbackModelId
  const fallback =
    fallbackModelId && fallbackModelId !== input.profile.modelId
      ? findModelCapability(input.matrix, input.profile.providerId, fallbackModelId)
      : undefined
  const primaryDoctor = findDoctorSnapshot(
    input.doctor,
    input.profile.providerId,
    input.profile.modelId,
  )
  const primaryReasonCodes = unique([
    ...(primary?.reasonCodes ?? []),
    ...(primaryDoctor?.reasonCodes ?? []),
  ])
  const primaryBlockedReason =
    input.forceFallbackReasonCode ??
    (!primary
      ? "model_not_supported"
      : !primary.available
        ? "model_unavailable"
        : primaryDoctor?.status === "unavailable"
          ? "model_doctor_unavailable"
          : undefined)

  let active = primary
  let fallbackReasonCode: string | undefined
  if (primaryBlockedReason && fallback?.available && fallbackModelId) {
    const fallbackDoctor = findDoctorSnapshot(
      input.doctor,
      input.profile.providerId,
      fallbackModelId,
    )
    if (fallbackDoctor?.status !== "unavailable") {
      active = fallback
      fallbackReasonCode = primaryBlockedReason
    }
  }

  if (!active) {
    return modelBlocked({
      reasonCode: primaryBlockedReason ?? "model_not_supported",
      userMessage: "Agent model profile references a model that is not supported.",
      diagnostics: primaryReasonCodes,
    })
  }
  if (!active.available) {
    return modelBlocked({
      reasonCode: primaryBlockedReason ?? "model_unavailable",
      userMessage: "Agent model is unavailable.",
      diagnostics: primaryReasonCodes,
    })
  }

  const fallbackApplied = Boolean(fallbackReasonCode)
  const profile =
    fallbackApplied && input.profile.fallbackModelId
      ? { ...input.profile, modelId: fallbackModelId ?? input.profile.modelId }
      : input.profile
  const reasonCodes = unique([
    ...(fallbackApplied ? ["model_fallback_applied", fallbackReasonCode] : []),
    ...(primaryDoctor?.status === "degraded" ? ["model_doctor_degraded"] : []),
    ...primaryReasonCodes,
  ])
  const snapshot = buildSnapshot({
    profile,
    active,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    fallbackApplied,
    ...(fallbackApplied ? { fallbackFromModelId: input.profile.modelId } : {}),
    ...(fallbackReasonCode ? { fallbackReasonCode } : {}),
    reasonCodes,
  })
  if (
    snapshot.costBudget !== undefined &&
    snapshot.costBudget >= 0 &&
    snapshot.estimatedCost > snapshot.costBudget
  ) {
    return modelBlocked({
      reasonCode: "cost_budget_exceeded",
      userMessage: "Agent model execution cost estimate exceeds the configured cost budget.",
      diagnostics: [...reasonCodes, "cost_budget_exceeded"],
    })
  }

  return {
    status: "allowed",
    reasonCode: fallbackApplied ? "model_fallback_applied" : "model_execution_allowed",
    userMessage: fallbackApplied
      ? "Agent model fallback was applied within the configured policy."
      : "Agent model execution policy allows this model.",
    snapshot,
    ...(primary ? { primaryModel: primary } : {}),
    activeModel: active,
    diagnostics: reasonCodes,
  }
}

export function resolveModelExecutionPolicy(input: {
  agentId: string
  promptBundle?: AgentPromptBundle
  modelProfile?: ModelProfile
  providerMatrix?: ProviderModelCapability[]
  doctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[]
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
  forceFallbackReasonCode?: string
}): ResolvedModelExecutionPolicy {
  const profile = input.modelProfile ?? input.promptBundle?.modelProfileSnapshot
  if (!profile) {
    return modelBlocked({
      reasonCode: "model_profile_missing",
      userMessage: "Agent model profile is missing.",
    })
  }
  if (!profile.providerId?.trim()) {
    return modelBlocked({
      reasonCode: "model_provider_missing",
      userMessage: "Agent model provider is missing.",
    })
  }
  if (!profile.modelId?.trim()) {
    return modelBlocked({
      reasonCode: "model_id_missing",
      userMessage: "Agent model id is missing.",
    })
  }
  const matrix = input.providerMatrix ?? DEFAULT_PROVIDER_MODEL_CAPABILITY_MATRIX
  const estimatedInputTokens =
    input.estimatedInputTokens ??
    estimateTokenCount(input.promptBundle?.renderedPrompt ?? input.promptBundle?.promptChecksum)
  const estimatedOutputTokens =
    input.estimatedOutputTokens ?? Math.max(1, Math.ceil((profile.maxOutputTokens ?? 1024) * 0.25))
  return resolveActiveModel({
    profile,
    matrix,
    ...(input.doctor ? { doctor: input.doctor } : {}),
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
    ...(input.forceFallbackReasonCode
      ? { forceFallbackReasonCode: input.forceFallbackReasonCode }
      : {}),
  })
}

export function resolveFallbackModelExecutionPolicy(input: {
  current: ResolvedModelExecutionPolicy
  reasonCode: string
  promptBundle?: AgentPromptBundle
  providerMatrix?: ProviderModelCapability[]
  doctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[]
}): ResolvedModelExecutionPolicy {
  const profile = input.promptBundle?.modelProfileSnapshot
  if (!profile?.fallbackModelId || input.current.snapshot?.fallbackApplied) return input.current
  return resolveModelExecutionPolicy({
    agentId: input.promptBundle?.agentId ?? "",
    ...(input.promptBundle ? { promptBundle: input.promptBundle } : {}),
    ...(input.providerMatrix ? { providerMatrix: input.providerMatrix } : {}),
    ...(input.doctor ? { doctor: input.doctor } : {}),
    ...(input.current.snapshot?.estimatedInputTokens !== undefined
      ? { estimatedInputTokens: input.current.snapshot.estimatedInputTokens }
      : {}),
    ...(input.current.snapshot?.estimatedOutputTokens !== undefined
      ? { estimatedOutputTokens: input.current.snapshot.estimatedOutputTokens }
      : {}),
    forceFallbackReasonCode: input.reasonCode,
  })
}

export function buildModelExecutionAuditSummary(input: {
  snapshot: ModelExecutionSnapshot
  status: ModelExecutionAuditSummary["status"]
  attemptCount: number
  latencyMs: number
  outputText?: string
}): ModelExecutionAuditSummary {
  const outputTokens = Math.max(
    input.snapshot.estimatedOutputTokens,
    estimateTokenCount(input.outputText),
  )
  return {
    ...input.snapshot,
    attemptCount: input.attemptCount,
    latencyMs: Math.max(0, input.latencyMs),
    estimatedOutputTokens: outputTokens,
    estimatedCost: estimateModelExecutionCost({
      capability: {
        providerId: input.snapshot.providerId,
        modelId: input.snapshot.modelId,
        available: true,
        contextWindowTokens: null,
        maxOutputTokens: input.snapshot.maxOutputTokens ?? outputTokens,
        inputCostPer1kTokens:
          input.snapshot.estimatedInputTokens > 0
            ? (input.snapshot.estimatedCost / input.snapshot.estimatedInputTokens) * 1000
            : 0,
        outputCostPer1kTokens: 0,
      },
      inputTokens: input.snapshot.estimatedInputTokens,
      outputTokens,
    }),
    status: input.status,
    tokenUsage: {
      inputTokens: input.snapshot.estimatedInputTokens,
      outputTokens,
      totalTokens: input.snapshot.estimatedInputTokens + outputTokens,
      estimated: true,
    },
  }
}

export function buildModelAvailabilityDoctorSnapshot(input: {
  providerId: string
  modelId: string
  status: ModelAvailabilityStatus
  reasonCodes?: string[]
  checkedAt?: number
}): ModelAvailabilityDoctorSnapshot {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    status: input.status,
    reasonCodes: unique(input.reasonCodes ?? []),
    ...(input.checkedAt !== undefined ? { checkedAt: input.checkedAt } : {}),
  }
}
