export type MemoryCompactionReleaseGateStatus = "passed" | "warning" | "failed";
export interface MemoryCompactionReleaseGateCheck {
    id: "quality_snapshot_guard" | "append_only_archive_guard" | "model_audit_guard" | "drift_warning_guard" | "heuristic_fallback_guard";
    status: MemoryCompactionReleaseGateStatus;
    summary: string;
    detail: Record<string, unknown>;
}
export interface MemoryCompactionReleaseGateSummary {
    kind: "nobie.release.memory_compaction";
    generatedAt: string;
    policyVersion: "2026-05-18.memory-compaction.release-gate.v1";
    gateStatus: MemoryCompactionReleaseGateStatus;
    qualityStatus: "healthy" | "degraded";
    ownerWarnings: number;
    totalCompactionRuns: number;
    heuristicFallbackRuns: number;
    checks: MemoryCompactionReleaseGateCheck[];
    warnings: string[];
    blockingFailures: string[];
}
export declare function buildMemoryCompactionReleaseGateSummary(input?: {
    now?: Date;
}): MemoryCompactionReleaseGateSummary;
//# sourceMappingURL=memory-compaction-gate.d.ts.map