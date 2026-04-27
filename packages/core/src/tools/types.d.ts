import type { AgentEntityType, CapabilityPolicy, DepthScopedToolPolicy, PermissionProfile, SkillMcpAllowlist } from "../contracts/sub-agent-orchestration.js";
export type RiskLevel = "safe" | "moderate" | "dangerous";
export interface ToolContext {
    sessionId: string;
    runId: string;
    requestGroupId?: string;
    workDir: string;
    userMessage: string;
    source: "webui" | "cli" | "telegram" | "slack";
    allowWebAccess: boolean;
    onProgress: (message: string) => void;
    signal: AbortSignal;
    agentId?: string;
    agentType?: AgentEntityType;
    capabilityPolicy?: CapabilityPolicy;
    permissionProfile?: PermissionProfile;
    skillMcpAllowlist?: SkillMcpAllowlist;
    capabilityRateLimit?: CapabilityPolicy["rateLimit"];
    delegationDepth?: number;
    depthScopedToolPolicy?: DepthScopedToolPolicy;
    capabilityBindingId?: string;
    secretScopeId?: string;
    parentSecretScopeId?: string;
    allowParentSecretFallback?: boolean;
    fallbackSecretScopeAllowlist?: string[];
    auditId?: string;
    capabilityDelegationId?: string;
    capabilityResultSharing?: "data_exchange" | "result_report_artifact";
}
export interface ArtifactDeliveryResultDetails {
    kind: "artifact_delivery";
    channel: "telegram" | "webui" | "slack";
    filePath: string;
    caption?: string;
    mimeType?: string;
    size: number;
    source: ToolContext["source"];
}
export declare function isArtifactDeliveryResultDetails(value: unknown): value is ArtifactDeliveryResultDetails;
export interface ToolResult {
    success: boolean;
    output: string;
    details?: unknown;
    error?: string | undefined;
}
export interface AgentTool<TParams = unknown> {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
    riskLevel: RiskLevel;
    requiresApproval: boolean;
    availableSources?: ToolContext["source"][];
    execute(params: TParams, ctx: ToolContext): Promise<ToolResult>;
}
export type AnyTool = AgentTool<any>;
//# sourceMappingURL=types.d.ts.map