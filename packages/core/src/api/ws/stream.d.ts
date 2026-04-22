import type { FastifyInstance } from "fastify";
import type { ApprovalDecision, ApprovalResolutionReason } from "../../events/index.js";
export declare function getWebUiWsClientCount(): number;
export declare function registerApprovalFromWs(runId: string, resolve: (d: ApprovalDecision, reason?: ApprovalResolutionReason) => void, approvalId?: string): void;
export interface WebUiApprovalResponseMessage {
    type?: string;
    approvalId?: string;
    runId?: string;
    decision?: string;
    toolName?: string;
}
export interface WebUiLiveUpdateAckMessage {
    type?: string;
    eventType?: string;
    emittedAt?: number;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    source?: string;
}
export declare function resolveWebUiApprovalResponse(msg: WebUiApprovalResponseMessage): boolean;
export declare function resolveWebUiLiveUpdateAck(msg: WebUiLiveUpdateAckMessage, now?: () => number): boolean;
export declare function resetWebUiApprovalStateForTest(): void;
export declare function registerWsRoute(app: FastifyInstance): void;
//# sourceMappingURL=stream.d.ts.map