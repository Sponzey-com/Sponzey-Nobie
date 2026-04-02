export type RecoveryBudgetKind = "interpretation" | "execution" | "delivery" | "external"

export interface RecoveryBudgetState {
  kind: RecoveryBudgetKind
  used: number
  limit: number
  remaining: number
}

export type RecoveryBudgetUsage = Record<RecoveryBudgetKind, number>

export function createRecoveryBudgetUsage(): RecoveryBudgetUsage {
  return {
    interpretation: 0,
    execution: 0,
    delivery: 0,
    external: 0,
  }
}

export function getRecoveryBudgetLimit(kind: RecoveryBudgetKind, maxDelegationTurns: number): number {
  if (maxDelegationTurns <= 0) return 0

  switch (kind) {
    case "delivery":
      return Math.max(1, Math.min(maxDelegationTurns, 3))
    case "external":
      return Math.max(1, Math.min(maxDelegationTurns, 4))
    case "interpretation":
    case "execution":
    default:
      return maxDelegationTurns
  }
}

export function getRecoveryBudgetState(params: {
  usage: RecoveryBudgetUsage
  kind: RecoveryBudgetKind
  maxDelegationTurns: number
}): RecoveryBudgetState {
  const used = params.usage[params.kind] ?? 0
  const limit = getRecoveryBudgetLimit(params.kind, params.maxDelegationTurns)
  return {
    kind: params.kind,
    used,
    limit,
    remaining: limit > 0 ? Math.max(0, limit - used) : 0,
  }
}

export function canConsumeRecoveryBudget(params: {
  usage: RecoveryBudgetUsage
  kind: RecoveryBudgetKind
  maxDelegationTurns: number
}): boolean {
  const state = getRecoveryBudgetState(params)
  if (state.limit <= 0) return true
  return state.used < state.limit
}

export function consumeRecoveryBudget(params: {
  usage: RecoveryBudgetUsage
  kind: RecoveryBudgetKind
  maxDelegationTurns: number
}): RecoveryBudgetState {
  const state = getRecoveryBudgetState(params)
  if (state.limit > 0 && state.used >= state.limit) {
    return state
  }
  params.usage[params.kind] = state.used + 1
  return getRecoveryBudgetState(params)
}

export function formatRecoveryBudgetProgress(state: RecoveryBudgetState): string {
  return `${state.used}/${state.limit > 0 ? state.limit : "무제한"}`
}
