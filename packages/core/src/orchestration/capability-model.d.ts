import type { CapabilityPolicy, CapabilityRiskLevel, SubAgentConfig } from "../contracts/sub-agent-orchestration.js";
import { type DbAgentCapabilityBinding, type DbAgentCapabilityKind, type DbCapabilityCatalogStatus } from "../db/index.js";
import type { ModelAvailabilityDoctorSnapshot } from "./model-execution-policy.js";
export type CapabilityModelDiagnosticSeverity = "info" | "warning" | "invalid";
export type CapabilityModelAvailabilityStatus = "available" | "degraded" | "unavailable";
export type AgentCapabilityCatalogStatus = DbCapabilityCatalogStatus | "unknown";
export type AgentCapabilityBindingStatus = DbAgentCapabilityBinding["status"] | "implicit";
export interface CapabilityModelDiagnostic {
    reasonCode: string;
    severity: CapabilityModelDiagnosticSeverity;
    message: string;
    agentId: string;
    bindingId?: string;
    catalogKind?: DbAgentCapabilityKind;
    catalogId?: string;
}
export interface AgentSecretScopeSummary {
    configured: boolean;
    scopeId?: string;
}
export interface AgentCapabilityBindingSummary {
    bindingId: string;
    agentId: string;
    catalogKind: DbAgentCapabilityKind;
    catalogId: string;
    catalogDisplayName?: string;
    catalogStatus: AgentCapabilityCatalogStatus;
    bindingStatus: AgentCapabilityBindingStatus;
    available: boolean;
    availability: CapabilityModelAvailabilityStatus;
    reasonCodes: string[];
    enabledToolNames: string[];
    disabledToolNames: string[];
    secretScope: AgentSecretScopeSummary;
    risk: CapabilityRiskLevel;
    riskCeiling: CapabilityRiskLevel;
    approvalRequiredFrom: CapabilityRiskLevel;
    rateLimit: CapabilityPolicy["rateLimit"];
}
export interface AgentCapabilitySummary {
    agentId: string;
    available: boolean;
    availability: CapabilityModelAvailabilityStatus;
    enabledSkillIds: string[];
    disabledSkillIds: string[];
    enabledMcpServerIds: string[];
    disabledMcpServerIds: string[];
    enabledToolNames: string[];
    disabledToolNames: string[];
    secretScopes: AgentSecretScopeSummary[];
    skillBindings: AgentCapabilityBindingSummary[];
    mcpServerBindings: AgentCapabilityBindingSummary[];
    diagnostics: CapabilityModelDiagnostic[];
    diagnosticReasonCodes: string[];
}
export interface AgentSkillMcpSummaryResolved {
    enabledSkillIds: string[];
    enabledMcpServerIds: string[];
    enabledToolNames: string[];
    disabledToolNames: string[];
    secretScopeId?: string;
}
export interface AgentModelSummary {
    agentId: string;
    configured: boolean;
    available: boolean;
    availability: CapabilityModelAvailabilityStatus;
    providerId?: string;
    modelId?: string;
    timeoutMs?: number;
    retryCount?: number;
    costBudget?: number;
    fallbackModelId?: string;
    diagnostics: CapabilityModelDiagnostic[];
    diagnosticReasonCodes: string[];
}
export interface AgentModelSummaryOptions {
    doctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[];
}
export interface AgentCapabilityModelSummary {
    agentId: string;
    capabilitySummary: AgentCapabilitySummary;
    modelSummary: AgentModelSummary;
    skillMcpSummary: AgentSkillMcpSummaryResolved;
    degradedReasonCodes: string[];
}
export declare function buildAgentCapabilitySummary(config: SubAgentConfig): AgentCapabilitySummary;
export declare function buildAgentModelSummary(config: SubAgentConfig, options?: AgentModelSummaryOptions): AgentModelSummary;
export declare function resolveAgentCapabilityModelSummary(config: SubAgentConfig, options?: AgentModelSummaryOptions): AgentCapabilityModelSummary;
//# sourceMappingURL=capability-model.d.ts.map