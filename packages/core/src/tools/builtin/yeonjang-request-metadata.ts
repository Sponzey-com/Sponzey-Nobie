import type { YeonjangClientOptions, YeonjangRequestMetadata } from "../../yeonjang/mqtt-client.js"
import type { ToolContext } from "../types.js"

export function buildYeonjangRequestMetadata(ctx: ToolContext): YeonjangRequestMetadata {
  return {
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    source: ctx.source,
    ...(ctx.requestGroupId ? { requestGroupId: ctx.requestGroupId } : {}),
    ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    ...(ctx.auditId ? { auditId: ctx.auditId } : {}),
    ...(ctx.capabilityDelegationId ? { capabilityDelegationId: ctx.capabilityDelegationId } : {}),
  }
}

export function withYeonjangRequestMetadata(
  ctx: ToolContext,
  options: YeonjangClientOptions = {},
): YeonjangClientOptions {
  return {
    ...options,
    metadata: {
      ...(options.metadata ?? {}),
      ...buildYeonjangRequestMetadata(ctx),
    },
  }
}
