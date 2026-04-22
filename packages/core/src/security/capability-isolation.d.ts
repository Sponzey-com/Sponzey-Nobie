import { type JsonObject } from "../contracts/index.js";
import type { RiskLevel, ToolContext } from "../tools/types.js";
import type { CapabilityDelegationRequest, CapabilityPolicy, CapabilityRiskLevel, DataExchangePackage, OwnerScope, PermissionProfile, SkillMcpAllowlist } from "../contracts/sub-agent-orchestration.js";
export declare const CAPABILITY_RISK_ORDER: Record<CapabilityRiskLevel, number>;
export interface McpRegisteredToolRef {
    registeredName: string;
    serverId: string;
    toolName: string;
}
export interface AgentCapabilityCallContext {
    agentId: string;
    sessionId: string;
    permissionProfile: PermissionProfile;
    skillMcpAllowlist: SkillMcpAllowlist;
    secretScopeId: string;
    auditId: string;
    runId?: string;
    requestGroupId?: string;
    capabilityDelegationId?: string;
}
export interface AgentCapabilityPolicyDecision {
    allowed: boolean;
    toolName: string;
    capabilityRisk: CapabilityRiskLevel;
    approvalRequired: boolean;
    reasonCode: string;
    userMessage?: string;
    agentId?: string;
    permissionProfileId?: string;
    secretScopeId?: string;
    rateLimitKey?: string;
    rateLimit?: CapabilityPolicy["rateLimit"];
    mcpTool?: McpRegisteredToolRef;
    diagnostic: Record<string, unknown>;
}
export interface CapabilityPolicySnapshot {
    snapshotId: string;
    sourceProfileId: string;
    permissionProfile: PermissionProfile;
    skillMcpAllowlist: SkillMcpAllowlist;
    rateLimit: CapabilityPolicy["rateLimit"];
    checksum: string;
    createdAt: number;
}
export interface CapabilityApprovalAggregationEvent {
    kind: "capability_approval_required";
    eventId: string;
    runId?: string;
    requestGroupId?: string;
    sessionId?: string;
    agentId?: string;
    toolName: string;
    capabilityRisk: CapabilityRiskLevel;
    reasonCode: string;
    auditId?: string;
    createdAt: number;
}
export interface AgentCapabilityRateLimitLease {
    key: string;
    release: () => void;
}
export declare function parseMcpRegisteredToolName(toolName: string): McpRegisteredToolRef | null;
export declare function resolveToolCapabilityRisk(toolName: string, fallback?: RiskLevel | CapabilityRiskLevel): CapabilityRiskLevel;
export declare function isToolAllowedBySkillMcpAllowlist(input: {
    toolName: string;
    allowlist: SkillMcpAllowlist;
    mcpTool?: McpRegisteredToolRef | null;
}): boolean;
export declare function isMcpServerAllowed(input: {
    serverId: string;
    allowlist: SkillMcpAllowlist;
}): boolean;
export declare function evaluateAgentToolCapabilityPolicy(input: {
    toolName: string;
    riskLevel?: RiskLevel | CapabilityRiskLevel;
    ctx: ToolContext;
}): AgentCapabilityPolicyDecision;
export declare function toAgentCapabilityCallContext(ctx: ToolContext): AgentCapabilityCallContext | null;
export declare function acquireAgentCapabilityRateLimit(input: {
    decision: AgentCapabilityPolicyDecision;
    now?: number;
}): AgentCapabilityRateLimitLease;
export declare function resetAgentCapabilityRateLimitsForTest(): void;
export declare function createCapabilityPolicySnapshot(input: {
    policy: CapabilityPolicy;
    snapshotId?: string;
    now?: number;
}): CapabilityPolicySnapshot;
export declare function buildCapabilityDelegationRequest(input: {
    requester: OwnerScope;
    provider: OwnerScope;
    capability: string;
    risk: CapabilityRiskLevel;
    inputPackageIds: string[];
    delegationId?: string;
    approvalId?: string;
    status?: CapabilityDelegationRequest["status"];
    parentRunId?: string;
    parentSessionId?: string;
    parentSubSessionId?: string;
    parentRequestId?: string;
    auditCorrelationId?: string;
    idempotencyKey?: string;
}): CapabilityDelegationRequest;
export declare function recordCapabilityDelegationRequest(delegation: CapabilityDelegationRequest, options?: {
    auditId?: string | null;
    now?: number;
}): boolean;
export declare function buildCapabilityResultDataExchange(input: {
    delegation: CapabilityDelegationRequest;
    payload: JsonObject;
    provenanceRefs?: string[];
    exchangeId?: string;
    idempotencyKey?: string;
    now?: () => number;
    expiresAt?: number | null;
}): DataExchangePackage;
export declare function persistCapabilityResultDataExchange(exchange: DataExchangePackage, options?: {
    now?: number;
    auditId?: string | null;
}): boolean;
export declare function buildCapabilityApprovalAggregationEvent(input: {
    decision: AgentCapabilityPolicyDecision;
    runId?: string;
    requestGroupId?: string;
    sessionId?: string;
    auditId?: string;
    now?: number;
}): CapabilityApprovalAggregationEvent;
//# sourceMappingURL=capability-isolation.d.ts.map