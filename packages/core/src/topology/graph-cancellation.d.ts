export interface GraphCancellationToken {
    graphExecutionPlanId: string;
    cancelled: boolean;
    reason?: "user_cancelled" | "channel_cancelled";
    cancelledAt?: string;
}
export interface NodeCancellationToken {
    graphExecutionPlanId: string;
    executorId: string;
    cancelled: boolean;
    reason?: "user_cancelled" | "node_cancelled";
    cancelledAt?: string;
}
export interface GraphCancellationController {
    graphToken: GraphCancellationToken;
    nodeTokens: Map<string, NodeCancellationToken>;
    cancelGraph: (reason?: GraphCancellationToken["reason"], at?: string) => GraphCancellationToken;
    cancelNode: (executorId: string, reason?: NodeCancellationToken["reason"], at?: string) => NodeCancellationToken;
    isGraphCancelled: () => boolean;
    isNodeCancelled: (executorId: string) => boolean;
}
export declare function createGraphCancellationController(input: {
    graphExecutionPlanId: string;
    executorIds?: string[];
}): GraphCancellationController;
//# sourceMappingURL=graph-cancellation.d.ts.map