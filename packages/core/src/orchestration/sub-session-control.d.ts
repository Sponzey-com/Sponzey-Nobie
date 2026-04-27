import { type AgentPromptBundle, type FeedbackRequest, type SubSessionContract, type SubSessionStatus } from "../contracts/sub-agent-orchestration.js";
export type SubSessionSpawnAckStatus = "accepted" | "queued" | "blocked_by_approval" | "rejected";
export type SubSessionControlAction = "send" | "steer" | "retry" | "feedback" | "redelegate" | "cancel" | "kill";
export interface SubSessionSpawnAck {
    ok: boolean;
    status: SubSessionSpawnAckStatus;
    reasonCode: string;
    subSessionId?: string;
    parentRunId?: string;
    replayed?: boolean;
    ackStartedAt: number;
    ackCompletedAt: number;
    ackLatencyMs: number;
}
export interface SubSessionInfo {
    subSessionId: string;
    parentRunId: string;
    parentSessionId: string;
    parentAgentId?: string;
    parentAgentDisplayName?: string;
    parentAgentNickname?: string;
    agentId: string;
    agentDisplayName: string;
    agentNickname?: string;
    commandRequestId: string;
    status: SubSessionStatus;
    retryBudgetRemaining: number;
    promptBundleId: string;
    idempotencyKey: string;
    auditCorrelationId?: string;
    startedAt?: number;
    finishedAt?: number;
    promptBundle?: {
        bundleId: string;
        agentId: string;
        agentType: AgentPromptBundle["agentType"];
        cacheKey?: string;
        promptChecksum?: string;
        profileVersionSnapshot?: number;
        validation?: AgentPromptBundle["validation"];
    };
}
export interface SubSessionLogEntry {
    id: string;
    at: number;
    kind: "run_event" | "control_event";
    eventType?: string;
    summary: string;
    detail?: unknown;
}
export interface SubSessionControlResult {
    ok: boolean;
    accepted: boolean;
    action: SubSessionControlAction | "kill_all";
    subSessionId?: string;
    redelegatedSubSessionId?: string;
    parentRunId?: string;
    status?: SubSessionStatus;
    reasonCode: string;
    controlEventId?: string | null;
    affectedSubSessionIds?: string[];
    feedbackRequest?: FeedbackRequest;
    synthesizedContextExchangeId?: string;
}
export declare function sanitizeSubSessionControlText(value: string): string;
export declare function spawnSubSessionAck(body: unknown): SubSessionSpawnAck;
export declare function requireSubSessionAccess(subSessionId: string, expectedParentRunId?: string): {
    ok: true;
    subSession: SubSessionContract;
} | {
    ok: false;
    statusCode: 403 | 404;
    reasonCode: string;
};
export declare function getSubSessionInfo(subSessionId: string, expectedParentRunId?: string): {
    ok: true;
    info: SubSessionInfo;
} | {
    ok: false;
    statusCode: 403 | 404;
    reasonCode: string;
};
export declare function listSubSessionLogs(input: {
    subSessionId: string;
    parentRunId?: string;
    limit?: unknown;
}): {
    ok: true;
    logs: SubSessionLogEntry[];
} | {
    ok: false;
    statusCode: 403 | 404;
    reasonCode: string;
};
export declare function controlSubSession(input: {
    subSessionId: string;
    action: SubSessionControlAction;
    body?: unknown;
    parentRunId?: string;
}): SubSessionControlResult | {
    ok: false;
    statusCode: 403 | 404 | 409;
    reasonCode: string;
};
export declare function killAllSubSessionsForRun(input: {
    parentRunId: string;
    body?: unknown;
}): SubSessionControlResult;
//# sourceMappingURL=sub-session-control.d.ts.map