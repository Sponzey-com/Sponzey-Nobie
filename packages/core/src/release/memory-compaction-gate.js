import { listMemoryCompactionRuns } from "../db/index.js";
import { buildMemoryInspectorSnapshot } from "../memory/inspector.js";
import { buildMemoryQualitySnapshot } from "../memory/quality.js";
function checkQualitySnapshot(quality) {
    return {
        id: "quality_snapshot_guard",
        status: quality.status === "healthy" ? "passed" : "warning",
        summary: quality.status === "healthy"
            ? "memory quality snapshot이 건강 상태를 보고합니다."
            : "memory quality snapshot이 degraded 상태를 보고합니다.",
        detail: {
            status: quality.status,
            totals: quality.totals,
            lastFailure: quality.lastFailure,
        },
    };
}
function checkAppendOnlyArchive(runs) {
    const completed = runs.filter((run) => run.status === "completed");
    const missingArchive = completed.filter((run) => {
        const sourceMessageCount = Number(run.metadata?.["sourceMessageCount"] ?? 0);
        if (sourceMessageCount <= 0)
            return false;
        return !run.metadata?.["archiveDocumentId"];
    });
    return {
        id: "append_only_archive_guard",
        status: missingArchive.length === 0 ? "passed" : "failed",
        summary: missingArchive.length === 0
            ? "completed compaction run이 append-only archive evidence를 남깁니다."
            : "append-only archive evidence가 없는 completed compaction run이 있습니다.",
        detail: {
            completedRuns: completed.length,
            missingArchiveRunIds: missingArchive.map((run) => run.id),
        },
    };
}
function checkModelAudit(runs) {
    const completed = runs.filter((run) => run.status === "completed");
    const missingAudit = completed.filter((run) => {
        const audit = run.metadata?.["compactionModelAudit"];
        return !(audit && typeof audit === "object");
    });
    return {
        id: "model_audit_guard",
        status: missingAudit.length === 0 ? "passed" : "warning",
        summary: missingAudit.length === 0
            ? "compaction model audit가 completed run마다 기록됩니다."
            : "일부 completed run에 compaction model audit가 없습니다.",
        detail: {
            completedRuns: completed.length,
            missingAuditRunIds: missingAudit.map((run) => run.id),
        },
    };
}
function checkDriftWarnings(inspector) {
    const warningOwners = inspector.ownerCards.filter((card) => card.driftWarningState === "warning");
    return {
        id: "drift_warning_guard",
        status: warningOwners.length === 0 ? "passed" : "warning",
        summary: warningOwners.length === 0
            ? "owner scope drift warning이 없습니다."
            : "일부 owner scope에서 drift warning이 보고됩니다.",
        detail: {
            warningOwners: warningOwners.map((card) => ({
                ownerScopeKey: card.ownerScopeKey,
                ownerId: card.ownerId,
                warningCodes: card.driftWarningCodes,
            })),
        },
    };
}
function checkHeuristicFallback(runs) {
    const completed = runs.filter((run) => run.status === "completed");
    const heuristicFallbackRuns = completed.filter((run) => {
        const audit = run.metadata?.["compactionModelAudit"];
        return Boolean(audit
            && typeof audit === "object"
            && audit["heuristicFallbackApplied"] === true);
    });
    return {
        id: "heuristic_fallback_guard",
        status: "passed",
        summary: "모델 실패 시 heuristic summary fallback이 audit에 남습니다.",
        detail: {
            heuristicFallbackRuns: heuristicFallbackRuns.map((run) => run.id),
            completedRuns: completed.length,
        },
    };
}
export function buildMemoryCompactionReleaseGateSummary(input = {}) {
    const now = input.now ?? new Date();
    const quality = buildMemoryQualitySnapshot({ now: now.getTime() });
    const inspector = buildMemoryInspectorSnapshot({ now: now.getTime(), limit: 12 });
    const runs = listMemoryCompactionRuns({ limit: 200 });
    const checks = [
        checkQualitySnapshot(quality),
        checkAppendOnlyArchive(runs),
        checkModelAudit(runs),
        checkDriftWarnings(inspector),
        checkHeuristicFallback(runs),
    ];
    const warnings = checks.filter((check) => check.status === "warning").map((check) => check.summary);
    const blockingFailures = checks.filter((check) => check.status === "failed").map((check) => check.summary);
    const gateStatus = blockingFailures.length > 0
        ? "failed"
        : warnings.length > 0
            ? "warning"
            : "passed";
    const heuristicFallbackRuns = runs.filter((run) => {
        const audit = run.metadata?.["compactionModelAudit"];
        return Boolean(audit
            && typeof audit === "object"
            && audit["heuristicFallbackApplied"] === true);
    }).length;
    return {
        kind: "nobie.release.memory_compaction",
        generatedAt: now.toISOString(),
        policyVersion: "2026-05-18.memory-compaction.release-gate.v1",
        gateStatus,
        qualityStatus: quality.status,
        ownerWarnings: inspector.summary.warningOwners,
        totalCompactionRuns: runs.length,
        heuristicFallbackRuns,
        checks,
        warnings,
        blockingFailures,
    };
}
//# sourceMappingURL=memory-compaction-gate.js.map