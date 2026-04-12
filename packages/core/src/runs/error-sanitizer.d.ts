export type SanitizedErrorKind = "auth" | "access_blocked" | "html_error" | "not_found" | "rate_limit" | "timeout" | "context_limit" | "schema" | "network" | "unknown";
export interface SanitizedErrorSummary {
    kind: SanitizedErrorKind;
    userMessage: string;
    reason: string;
}
export declare function sanitizeUserFacingError(message: string | undefined): SanitizedErrorSummary;
//# sourceMappingURL=error-sanitizer.d.ts.map