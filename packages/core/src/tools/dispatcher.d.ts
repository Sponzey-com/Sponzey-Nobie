import type { ApprovalDecision, ApprovalKind } from "../events/index.js";
import type { AnyTool, ToolContext, ToolResult } from "./types.js";
export declare class ToolDispatcher {
    private tools;
    private runApprovalScopes;
    private runSingleApprovalScopes;
    private pendingInteractionKinds;
    constructor();
    private getApprovalOwnerKey;
    private clearApprovalScopesForCompletedRun;
    register(tool: AnyTool): void;
    grantRunApprovalScope(runId: string): void;
    grantRunSingleApproval(runId: string): void;
    registerAll(tools: AnyTool[]): void;
    unregister(name: string): void;
    getAll(options?: {
        includeIsolated?: boolean;
    }): AnyTool[];
    get(name: string): AnyTool | undefined;
    isToolAvailableForSource(tool: AnyTool, source: ToolContext["source"]): boolean;
    dispatch(name: string, params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
    private getInteractionGuidance;
    private shouldRequireApproval;
    private requestApproval;
    resolvePendingInteraction(runId: string, decision: ApprovalDecision): boolean;
    listPendingInteractions(): Array<{
        approvalId?: string;
        runId: string;
        toolName: string;
        kind: ApprovalKind;
        guidance?: string;
    }>;
    private finishApproval;
    private writeAudit;
}
export declare const toolDispatcher: ToolDispatcher;
export declare function grantRunApprovalScope(runId: string): void;
export declare function grantRunSingleApproval(runId: string): void;
export declare function resolvePendingInteraction(runId: string, decision: ApprovalDecision): boolean;
export declare function listPendingInteractions(): Array<{
    runId: string;
    toolName: string;
    kind: ApprovalKind;
    guidance?: string;
}>;
export type { AgentTool, AnyTool, ToolContext, ToolResult, RiskLevel } from "./types.js";
//# sourceMappingURL=dispatcher.d.ts.map