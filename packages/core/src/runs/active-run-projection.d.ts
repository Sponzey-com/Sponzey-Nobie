import { type ActionType, type DeliveryContract, type IntentContract, type IntentType, type JsonObject, type ToolTargetContract } from "../contracts/index.js";
import type { RootRun } from "./types.js";
export type ActiveRunProjectionDecisionSource = "explicit_id" | "contract_projection" | "legacy_projection";
export type ExplicitActiveRunTargetKind = "runId" | "requestGroupId" | "approvalId";
export interface ActiveRunContractProjection {
    runId: string;
    requestGroupId: string;
    lineageRootRunId: string;
    approvalId?: string;
    status: RootRun["status"];
    source: RootRun["source"];
    displayName: string;
    orchestrationMode?: RootRun["orchestrationMode"];
    agentDisplayName?: string;
    agentNickname?: string;
    subSessionIds?: string[];
    subSessions?: Array<{
        subSessionId: string;
        parentRunId: string;
        agentId: string;
        agentDisplayName: string;
        agentNickname?: string;
        status: string;
        retryBudgetRemaining: number;
    }>;
    updatedAt: number;
    legacy: boolean;
    legacyReason?: string;
    intentContract: IntentContract;
    targetContract: ToolTargetContract;
    deliveryContract: DeliveryContract;
    comparisonProjection: JsonObject;
    comparisonHash: string;
}
export interface ExplicitActiveRunTargetResolution {
    kind: ExplicitActiveRunTargetKind;
    target: ActiveRunContractProjection;
    decisionSource: "explicit_id";
}
export declare function buildDerivedTargetContract(run: Pick<RootRun, "targetId" | "targetLabel">): ToolTargetContract;
export declare function buildDeliveryContractForRun(run: Pick<RootRun, "source" | "sessionId">): DeliveryContract;
export declare function buildIncomingIntentContract(params: {
    source?: RootRun["source"];
    sessionId: string;
    targetId?: string;
    targetLabel?: string;
    intentType?: IntentType;
    actionType?: ActionType;
}): IntentContract;
export declare function buildIntentComparisonProjection(intent: IntentContract): JsonObject;
export declare function buildActiveRunProjection(run: RootRun): ActiveRunContractProjection;
export declare function buildActiveRunProjections(runs: RootRun[]): ActiveRunContractProjection[];
export declare function resolveExplicitActiveRunTarget(params: {
    candidates: ActiveRunContractProjection[];
    runId?: string;
    requestGroupId?: string;
    approvalId?: string;
}): ExplicitActiveRunTargetResolution | undefined;
export declare function serializeActiveRunCandidateForComparison(candidate: ActiveRunContractProjection): JsonObject;
export declare function hasPersistedComparableContract(candidate: ActiveRunContractProjection): boolean;
//# sourceMappingURL=active-run-projection.d.ts.map