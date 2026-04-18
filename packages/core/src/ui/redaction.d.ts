export type UiRedactionAudience = "beginner" | "advanced" | "admin" | "export";
export type UiRedactionReason = "secret" | "raw_payload" | "raw_html" | "local_path";
export interface UiRedactionRecord {
    path: string;
    reason: UiRedactionReason;
}
export interface UiRedactionResult<T = unknown> {
    value: T;
    maskedCount: number;
    redactions: UiRedactionRecord[];
}
export interface UiRedactionOptions {
    audience: UiRedactionAudience;
}
export declare function redactUiValue<T = unknown>(value: T, options: UiRedactionOptions): UiRedactionResult<T>;
//# sourceMappingURL=redaction.d.ts.map