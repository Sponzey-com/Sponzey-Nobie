export type CriticalDecisionAuditCategory = "display-only" | "candidate-search" | "critical-decision" | "temporary-guard";
export type CriticalDecisionSignalKind = "structured-id-or-key" | "structured-intake-action" | "user-natural-language-regex" | "raw-prompt-ai-comparison" | "raw-prompt-normalized-dedupe" | "structured-contract-ai-comparison" | "vector-semantic-candidate" | "system-error-classification" | "system-event-label-classification" | "channel-label-classification";
export interface CriticalDecisionAuditEntry {
    id: string;
    file: string;
    symbols: string[];
    category: CriticalDecisionAuditCategory;
    decisionArea: string;
    signalKind: CriticalDecisionSignalKind;
    languageSensitive: boolean;
    userFacingRisk: string;
    currentRole: string;
    migrationTask?: string;
    sourceMarker?: string;
}
export interface CriticalDecisionSourceScanRule {
    ruleId: string;
    entryId: string;
    file: string;
    pattern: RegExp;
}
export declare const criticalDecisionAuditEntries: CriticalDecisionAuditEntry[];
export declare const criticalDecisionSourceScanRules: CriticalDecisionSourceScanRule[];
export declare function getCriticalDecisionAuditEntry(id: string): CriticalDecisionAuditEntry | undefined;
//# sourceMappingURL=critical-decision-audit.d.ts.map