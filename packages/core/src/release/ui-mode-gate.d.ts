import { type UiMode } from "../ui/mode.js";
import { type UiRedactionAudience } from "../ui/redaction.js";
export type UiReleaseGateStatus = "passed" | "warning" | "failed";
export type UiSmokeStepStatus = "passed" | "warning" | "failed" | "skipped";
export type UiRegressionGuardStatus = "passed" | "failed";
export interface UiModeSmokeStep {
    id: string;
    label: string;
    required: boolean;
    status: UiSmokeStepStatus;
    evidence: string;
}
export interface UiModeSmokeScenario {
    mode: UiMode;
    status: UiReleaseGateStatus;
    requiredPassCount: number;
    passedRequiredCount: number;
    steps: UiModeSmokeStep[];
}
export interface UiModeResolverEvidence {
    defaultMode: UiMode;
    advancedPreferredMode: UiMode;
    adminRequestedWithoutFlag: UiMode;
    adminRequestedWithFlag: UiMode;
    adminAvailableOnlyWithFlag: boolean;
    canSwitchInUi: boolean;
}
export interface UiModeRedactionEvidence {
    audience: UiRedactionAudience;
    passed: boolean;
    maskedCount: number;
    forbiddenPatterns: string[];
}
export interface UiAdminGuardEvidence {
    defaultDenied: boolean;
    developmentRuntimeFlagAllowed: boolean;
    productionRuntimeFlagWithoutConfigDenied: boolean;
    productionConfigAndRuntimeFlagAllowed: boolean;
    passed: boolean;
}
export interface UiRouteRedirectEvidence {
    from: string;
    expectedTo: string | null;
    actualTo: string | null;
    passed: boolean;
}
export interface UiRegressionGuardEvidence {
    id: string;
    status: UiRegressionGuardStatus;
    evidence: string;
}
export interface UiModeReleaseGateSummary {
    kind: "ui_mode.release_gate";
    version: 1;
    gateStatus: UiReleaseGateStatus;
    smokeMatrix: UiModeSmokeScenario[];
    resolver: UiModeResolverEvidence;
    redaction: UiModeRedactionEvidence[];
    adminGuard: UiAdminGuardEvidence;
    routeRedirects: UiRouteRedirectEvidence[];
    regressionGuards: UiRegressionGuardEvidence[];
    blockingFailures: string[];
    warnings: string[];
}
export interface UiModeReleaseGateOptions {
    smokeOverrides?: Partial<Record<UiMode, Partial<Record<string, UiSmokeStepStatus>>>>;
    regressionOverrides?: Partial<Record<string, UiRegressionGuardStatus>>;
}
export declare function buildUiModeSmokeMatrix(options?: UiModeReleaseGateOptions): UiModeSmokeScenario[];
export declare function buildUiModeReleaseGateSummary(options?: UiModeReleaseGateOptions): UiModeReleaseGateSummary;
//# sourceMappingURL=ui-mode-gate.d.ts.map