import { type PromptSourceLocaleParityResult } from "./nobie-md.js";
export type PromptRegressionSeverity = "error" | "warning";
export type PromptRegressionLocale = "ko" | "en";
export interface PromptRegressionIssue {
    severity: PromptRegressionSeverity;
    code: string;
    message: string;
    sourceId?: string;
    locale?: PromptRegressionLocale;
    evidence?: string;
}
export interface PromptResponsibilityRuleResult {
    id: string;
    description: string;
    ok: boolean;
    allowedSourceIds: string[];
    issues: PromptRegressionIssue[];
}
export interface PromptImpactScenarioResult {
    id: string;
    description: string;
    locale: PromptRegressionLocale;
    ok: boolean;
    requiredMarkers: string[];
    missingMarkers: string[];
}
export interface PromptSourceRegressionResult {
    ok: boolean;
    workDir: string;
    generatedAt: number;
    locales: PromptRegressionLocale[];
    registry: {
        sourceCount: number;
        runtimeSourceCount: number;
        checksums: Array<{
            sourceId: string;
            locale: PromptRegressionLocale;
            checksum: string;
            version: string;
            path: string;
        }>;
    };
    localeParity: PromptSourceLocaleParityResult;
    responsibility: PromptResponsibilityRuleResult[];
    impact: PromptImpactScenarioResult[];
    issues: PromptRegressionIssue[];
}
export declare function runPromptSourceRegression(workDir?: string, options?: {
    locales?: PromptRegressionLocale[];
}): PromptSourceRegressionResult;
//# sourceMappingURL=prompt-regression.d.ts.map