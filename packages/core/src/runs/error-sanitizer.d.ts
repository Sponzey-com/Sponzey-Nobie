export type SanitizedErrorKind = "auth" | "access_blocked" | "html_error" | "not_found" | "rate_limit" | "timeout" | "context_limit" | "schema" | "parse" | "network" | "encoding" | "tool_failure" | "delivery_failure" | "channel_conflict" | "unknown";
export interface SanitizedErrorSummary {
    kind: SanitizedErrorKind;
    userMessage: string;
    reason: string;
    actionHint?: string | undefined;
}
export declare function actionHintForSanitizedErrorKind(kind: SanitizedErrorKind): string;
export declare function sanitizeUserFacingError(message: string | undefined): SanitizedErrorSummary;
//# sourceMappingURL=error-sanitizer.d.ts.map