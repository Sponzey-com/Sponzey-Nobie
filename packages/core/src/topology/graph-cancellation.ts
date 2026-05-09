export interface GraphCancellationToken {
  graphExecutionPlanId: string
  cancelled: boolean
  reason?: "user_cancelled" | "channel_cancelled"
  cancelledAt?: string
}

export interface NodeCancellationToken {
  graphExecutionPlanId: string
  executorId: string
  cancelled: boolean
  reason?: "user_cancelled" | "node_cancelled"
  cancelledAt?: string
}

export interface GraphCancellationController {
  graphToken: GraphCancellationToken
  nodeTokens: Map<string, NodeCancellationToken>
  cancelGraph: (reason?: GraphCancellationToken["reason"], at?: string) => GraphCancellationToken
  cancelNode: (executorId: string, reason?: NodeCancellationToken["reason"], at?: string) => NodeCancellationToken
  isGraphCancelled: () => boolean
  isNodeCancelled: (executorId: string) => boolean
}

export function createGraphCancellationController(input: {
  graphExecutionPlanId: string
  executorIds?: string[]
}): GraphCancellationController {
  const graphToken: GraphCancellationToken = {
    graphExecutionPlanId: input.graphExecutionPlanId,
    cancelled: false,
  }
  const nodeTokens = new Map<string, NodeCancellationToken>()
  for (const executorId of input.executorIds ?? []) {
    nodeTokens.set(executorId, {
      graphExecutionPlanId: input.graphExecutionPlanId,
      executorId,
      cancelled: false,
    })
  }
  return {
    graphToken,
    nodeTokens,
    cancelGraph(reason = "user_cancelled", at = new Date(0).toISOString()) {
      graphToken.cancelled = true
      graphToken.reason = reason
      graphToken.cancelledAt = at
      for (const token of nodeTokens.values()) {
        token.cancelled = true
        token.reason = reason === "channel_cancelled" ? "user_cancelled" : "user_cancelled"
        token.cancelledAt = at
      }
      return graphToken
    },
    cancelNode(executorId, reason = "node_cancelled", at = new Date(0).toISOString()) {
      const token = nodeTokens.get(executorId) ?? {
        graphExecutionPlanId: input.graphExecutionPlanId,
        executorId,
        cancelled: false,
      }
      token.cancelled = true
      token.reason = reason
      token.cancelledAt = at
      nodeTokens.set(executorId, token)
      return token
    },
    isGraphCancelled() {
      return graphToken.cancelled
    },
    isNodeCancelled(executorId) {
      return graphToken.cancelled || nodeTokens.get(executorId)?.cancelled === true
    },
  }
}
