import type { ContractValidationIssue } from "../contracts/index.js";
import { type TeamConfig, type TeamExecutionPlan } from "../contracts/sub-agent-orchestration.js";
import { type TeamCompositionServiceDependencies } from "./team-composition.js";
export type TeamExecutionPlanDiagnosticSeverity = "info" | "warning" | "invalid";
export interface TeamExecutionPlanDiagnostic {
    reasonCode: string;
    severity: TeamExecutionPlanDiagnosticSeverity;
    message: string;
    teamId: string;
    agentId?: string;
    fallbackForAgentId?: string;
}
export interface TeamExecutionPlanBuildInput {
    teamId: string;
    team?: TeamConfig;
    teamExecutionPlanId?: string;
    parentRunId?: string;
    parentRequestId?: string;
    userRequest?: string;
    persist?: boolean;
    auditId?: string | null;
}
export interface TeamExecutionPlanBuildResult {
    ok: boolean;
    plan?: TeamExecutionPlan;
    persisted: boolean;
    diagnostics: TeamExecutionPlanDiagnostic[];
    validationIssues?: ContractValidationIssue[];
}
export interface TeamExecutionPlanServiceDependencies extends TeamCompositionServiceDependencies {
    idProvider?: (prefix: string) => string;
}
export declare function buildTeamExecutionPlan(input: TeamExecutionPlanBuildInput, dependencies?: TeamExecutionPlanServiceDependencies): TeamExecutionPlanBuildResult;
export declare function createTeamExecutionPlanService(dependencies?: TeamExecutionPlanServiceDependencies): {
    build(input: TeamExecutionPlanBuildInput): TeamExecutionPlanBuildResult;
};
//# sourceMappingURL=team-execution-plan.d.ts.map