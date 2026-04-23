export function buildYeonjangRequestMetadata(ctx) {
    return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        source: ctx.source,
        ...(ctx.requestGroupId ? { requestGroupId: ctx.requestGroupId } : {}),
        ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
        ...(ctx.auditId ? { auditId: ctx.auditId } : {}),
        ...(ctx.capabilityDelegationId ? { capabilityDelegationId: ctx.capabilityDelegationId } : {}),
    };
}
export function withYeonjangRequestMetadata(ctx, options = {}) {
    return {
        ...options,
        metadata: {
            ...(options.metadata ?? {}),
            ...buildYeonjangRequestMetadata(ctx),
        },
    };
}
