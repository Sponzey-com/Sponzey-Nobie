export function createRecoveryBudgetUsage() {
    return {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
    };
}
export function getRecoveryBudgetLimit(kind, maxDelegationTurns) {
    if (maxDelegationTurns <= 0)
        return 0;
    switch (kind) {
        case "interpretation":
        case "execution":
        case "delivery":
        case "external":
        default:
            return maxDelegationTurns;
    }
}
export function getRecoveryBudgetState(params) {
    const used = params.usage[params.kind] ?? 0;
    const limit = getRecoveryBudgetLimit(params.kind, params.maxDelegationTurns);
    return {
        kind: params.kind,
        used,
        limit,
        remaining: limit > 0 ? Math.max(0, limit - used) : 0,
    };
}
export function canConsumeRecoveryBudget(params) {
    const state = getRecoveryBudgetState(params);
    if (state.limit <= 0)
        return true;
    return state.used < state.limit;
}
export function consumeRecoveryBudget(params) {
    const state = getRecoveryBudgetState(params);
    if (state.limit > 0 && state.used >= state.limit) {
        return state;
    }
    params.usage[params.kind] = state.used + 1;
    return getRecoveryBudgetState(params);
}
export function formatRecoveryBudgetProgress(state) {
    return `${state.used}/${state.limit > 0 ? state.limit : "무제한"}`;
}
//# sourceMappingURL=recovery-budget.js.map