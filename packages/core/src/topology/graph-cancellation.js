export function createGraphCancellationController(input) {
    const graphToken = {
        graphExecutionPlanId: input.graphExecutionPlanId,
        cancelled: false,
    };
    const nodeTokens = new Map();
    for (const executorId of input.executorIds ?? []) {
        nodeTokens.set(executorId, {
            graphExecutionPlanId: input.graphExecutionPlanId,
            executorId,
            cancelled: false,
        });
    }
    return {
        graphToken,
        nodeTokens,
        cancelGraph(reason = "user_cancelled", at = new Date(0).toISOString()) {
            graphToken.cancelled = true;
            graphToken.reason = reason;
            graphToken.cancelledAt = at;
            for (const token of nodeTokens.values()) {
                token.cancelled = true;
                token.reason = reason === "channel_cancelled" ? "user_cancelled" : "user_cancelled";
                token.cancelledAt = at;
            }
            return graphToken;
        },
        cancelNode(executorId, reason = "node_cancelled", at = new Date(0).toISOString()) {
            const token = nodeTokens.get(executorId) ?? {
                graphExecutionPlanId: input.graphExecutionPlanId,
                executorId,
                cancelled: false,
            };
            token.cancelled = true;
            token.reason = reason;
            token.cancelledAt = at;
            nodeTokens.set(executorId, token);
            return token;
        },
        isGraphCancelled() {
            return graphToken.cancelled;
        },
        isNodeCancelled(executorId) {
            return graphToken.cancelled || nodeTokens.get(executorId)?.cancelled === true;
        },
    };
}
//# sourceMappingURL=graph-cancellation.js.map