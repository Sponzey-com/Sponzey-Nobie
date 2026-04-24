import { type AgentConfig, type CapabilityRiskLevel, type TeamConfig, type TeamMembership } from "../contracts/sub-agent-orchestration.js";
import { type RegistryServiceDependencies } from "./registry.js";
export type TeamCompositionDiagnosticSeverity = "info" | "warning" | "invalid";
export type TeamHealthStatus = "healthy" | "degraded" | "invalid";
export type TeamMemberExecutionState = "active" | "reference" | "unresolved" | "excluded" | "fallback";
export interface TeamCompositionDiagnostic {
    reasonCode: string;
    severity: TeamCompositionDiagnosticSeverity;
    message: string;
    teamId: string;
    agentId?: string;
    ownerAgentId?: string;
    fallbackForAgentId?: string;
    missing?: string[];
}
export interface TeamCompositionMemberCoverage {
    agentId: string;
    membershipId: string;
    primaryRole: string;
    teamRoles: string[];
    required: boolean;
    membershipStatus: TeamMembership["status"] | "unresolved";
    executionState: TeamMemberExecutionState;
    active: boolean;
    directChild: boolean;
    fallbackCandidate: boolean;
    fallbackForAgentId?: string;
    excludedReasonCodes: string[];
    agentStatus?: AgentConfig["status"];
    specialtyTags: string[];
    riskCeiling?: CapabilityRiskLevel;
    load?: {
        utilization: number;
        activeSubSessions: number;
        maxParallelSessions: number;
    };
}
export interface TeamCoverageDimension {
    required: string[];
    covered: string[];
    missing: string[];
    providers: Record<string, string[]>;
}
export interface TeamCoverageReport {
    teamId: string;
    ownerAgentId: string;
    leadAgentId?: string;
    generatedAt: number;
    executionCandidate: boolean;
    activeMemberAgentIds: string[];
    referenceMemberAgentIds: string[];
    unresolvedMemberAgentIds: string[];
    fallbackCandidateAgentIds: string[];
    excludedMemberAgentIds: string[];
    members: TeamCompositionMemberCoverage[];
    roleCoverage: TeamCoverageDimension;
    capabilityCoverage: TeamCoverageDimension;
    diagnostics: TeamCompositionDiagnostic[];
    recalculationKeys: string[];
}
export interface TeamHealthReport {
    teamId: string;
    status: TeamHealthStatus;
    executionCandidate: boolean;
    activeMemberCount: number;
    referenceMemberCount: number;
    unresolvedMemberCount: number;
    excludedMemberCount: number;
    diagnostics: TeamCompositionDiagnostic[];
    coverageSummary: {
        missingRoles: string[];
        missingCapabilityTags: string[];
        recalculationKeys: string[];
    };
}
export interface TeamCompositionValidationResult {
    ok: boolean;
    valid: boolean;
    team?: TeamConfig;
    coverage?: TeamCoverageReport;
    health?: TeamHealthReport;
    diagnostics: TeamCompositionDiagnostic[];
}
export interface TeamCompositionServiceDependencies extends RegistryServiceDependencies {
    now?: () => number;
}
export declare function createTeamCompositionService(dependencies?: TeamCompositionServiceDependencies): {
    evaluate: (input: string | unknown) => TeamCompositionValidationResult;
    coverage(teamId: string): TeamCoverageReport | undefined;
    health(teamId: string): TeamHealthReport | undefined;
};
//# sourceMappingURL=team-composition.d.ts.map