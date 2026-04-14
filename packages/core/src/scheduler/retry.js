export const DEFAULT_SCHEDULE_RETRY_POLICY = {
    maxRetries: 3,
    baseDelayMs: 5_000,
    maxDelayMs: 60_000,
};
export function normalizeScheduleMaxRetries(value) {
    if (!Number.isFinite(value))
        return DEFAULT_SCHEDULE_RETRY_POLICY.maxRetries;
    return Math.max(0, Math.min(10, Math.floor(value ?? DEFAULT_SCHEDULE_RETRY_POLICY.maxRetries)));
}
export function computeScheduleRetryDelayMs(attempt, policy = {}) {
    const normalizedAttempt = Math.max(1, Math.floor(attempt));
    const baseDelayMs = Math.max(0, Math.floor(policy.baseDelayMs ?? DEFAULT_SCHEDULE_RETRY_POLICY.baseDelayMs));
    const maxDelayMs = Math.max(baseDelayMs, Math.floor(policy.maxDelayMs ?? DEFAULT_SCHEDULE_RETRY_POLICY.maxDelayMs));
    const delay = baseDelayMs * (2 ** Math.max(0, normalizedAttempt - 1));
    return Math.min(delay, maxDelayMs);
}
//# sourceMappingURL=retry.js.map