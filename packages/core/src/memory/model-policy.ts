import type { AIProvider } from "../ai/types.js"
import { getConfig } from "../config/index.js"

export type MemoryCompactionModelSource = "explicit_override" | "fallback_override" | "execution_model"
export type MemoryCompactionModelAttemptStatus =
  | "selected"
  | "provider_budget_blocked"
  | "provider_call_failed"
  | "invalid_json"
  | "skipped_duplicate"

export interface MemoryCompactionModelAttempt {
  modelId: string
  source: MemoryCompactionModelSource
  maxContextTokens: number
  status: MemoryCompactionModelAttemptStatus
  error?: string
}

export interface MemoryCompactionPolicySnapshot {
  executionModelId: string
  selectedModelId: string
  selectionSource: MemoryCompactionModelSource
  fallbackModelId?: string
  minContextTokens: number
  providerBudgetBlocked: boolean
}

export interface MemoryCompactionModelAudit {
  executionModelId: string
  selectedModelId?: string
  selectionSource?: MemoryCompactionModelSource
  fallbackModelId?: string
  minContextTokens: number
  providerBudgetBlocked: boolean
  fallbackApplied: boolean
  heuristicFallbackApplied: boolean
  deterministicStateProtected: true
  attempts: MemoryCompactionModelAttempt[]
}

export interface ResolvedMemoryCompactionPolicy {
  snapshot: MemoryCompactionPolicySnapshot
  candidates: Array<{ modelId: string; source: MemoryCompactionModelSource; maxContextTokens: number }>
}

function safeResolveContextTokens(provider: AIProvider, modelId: string): number {
  try {
    const resolved = provider.maxContextTokens(modelId)
    if (!Number.isFinite(resolved) || resolved <= 0) return 0
    return Math.floor(resolved)
  } catch {
    return 0
  }
}

function normalizeModelId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolveMemoryCompactionPolicy(input: {
  provider: AIProvider
  executionModelId: string
}): ResolvedMemoryCompactionPolicy {
  const config = getConfig()
  const explicitModelId = normalizeModelId(config.memory.compaction?.modelId)
  const fallbackModelId = normalizeModelId(config.memory.compaction?.fallbackModelId)
  const minContextTokens = Math.max(
    512,
    Math.floor(config.memory.compaction?.minContextTokens ?? 3000),
  )
  const selectedModelId = explicitModelId ?? input.executionModelId
  const selectionSource: MemoryCompactionModelSource = explicitModelId
    ? "explicit_override"
    : "execution_model"
  const providerBudgetBlocked =
    safeResolveContextTokens(input.provider, selectedModelId) > 0
    && safeResolveContextTokens(input.provider, selectedModelId) < minContextTokens

  const orderedCandidates: Array<{ modelId: string; source: MemoryCompactionModelSource }> = [
    { modelId: selectedModelId, source: selectionSource },
  ]
  if (fallbackModelId && fallbackModelId !== selectedModelId) {
    orderedCandidates.push({ modelId: fallbackModelId, source: "fallback_override" })
  }
  if (input.executionModelId !== selectedModelId && input.executionModelId !== fallbackModelId) {
    orderedCandidates.push({ modelId: input.executionModelId, source: "execution_model" })
  }

  return {
    snapshot: {
      executionModelId: input.executionModelId,
      selectedModelId,
      selectionSource,
      ...(fallbackModelId ? { fallbackModelId } : {}),
      minContextTokens,
      providerBudgetBlocked,
    },
    candidates: orderedCandidates.map((candidate) => ({
      ...candidate,
      maxContextTokens: safeResolveContextTokens(input.provider, candidate.modelId),
    })),
  }
}

export function buildDefaultMemoryCompactionAudit(input: {
  executionModelId: string
  selectedModelId?: string
  selectionSource?: MemoryCompactionModelSource
  fallbackModelId?: string
  minContextTokens: number
  providerBudgetBlocked: boolean
  attempts?: MemoryCompactionModelAttempt[]
  fallbackApplied?: boolean
  heuristicFallbackApplied?: boolean
}): MemoryCompactionModelAudit {
  return {
    executionModelId: input.executionModelId,
    ...(input.selectedModelId ? { selectedModelId: input.selectedModelId } : {}),
    ...(input.selectionSource ? { selectionSource: input.selectionSource } : {}),
    ...(input.fallbackModelId ? { fallbackModelId: input.fallbackModelId } : {}),
    minContextTokens: input.minContextTokens,
    providerBudgetBlocked: input.providerBudgetBlocked,
    fallbackApplied: input.fallbackApplied === true,
    heuristicFallbackApplied: input.heuristicFallbackApplied === true,
    deterministicStateProtected: true,
    attempts: input.attempts ?? [],
  }
}
