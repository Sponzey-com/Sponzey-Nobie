export type IntakeNormalizedRequestLanguage = "ko" | "en" | "mixed" | "unknown";
export interface IntakeNormalizedRequest {
    sourceLanguage: IntakeNormalizedRequestLanguage;
    originalMessage: string;
    normalizedEnglish: string;
}
export declare function normalizeRequestForIntake(message: string): IntakeNormalizedRequest;
//# sourceMappingURL=request-normalizer.d.ts.map