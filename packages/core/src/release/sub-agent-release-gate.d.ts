import { type SubAgentBenchmarkSuiteResult } from "../benchmarks/sub-agent-benchmarks.js";
import type { MigrationPreflightRisk } from "../config/backup-rehearsal.js";
import type { FeatureFlagMode } from "../runtime/rollout-safety.js";
import { type ReleasePerformanceSummary } from "./performance-gate.js";
import type { UiModeReleaseGateSummary } from "./ui-mode-gate.js";
export type SubAgentReleaseModeId = "flag_off" | "dry_run_only" | "limited_beta" | "full_enable";
export type SubAgentReleaseGateStatus = "passed" | "warning" | "failed";
export type SubAgentReleaseGateCheckId = "release_mode_sequence" | "release_dry_run_summary" | "migration_rehearsal" | "feature_flag_off_rollback" | "no_sub_agent_fallback" | "disabled_agent_fallback" | "one_sub_agent_delegation" | "multiple_parallel_delegation" | "team_composition_validation" | "team_target_expansion" | "result_review_feedback_loop" | "memory_isolation" | "data_exchange_redaction" | "capability_permission_approval" | "model_cost_audit" | "fallback_reason_audit" | "channel_final_delivery_dedupe" | "react_flow_graph_validation" | "webui_runtime_projection" | "focus_template_import_safety" | "learning_history_restore_append_only" | "benchmark_threshold" | "nested_delegation_regression" | "cascade_stop" | "restart_resume_soak" | "duplicate_final_zero_tolerance" | "rollback_feature_flag_off";
export interface SubAgentReleaseModeDefinition {
    id: SubAgentReleaseModeId;
    order: number;
    title: string;
    featureFlagMode: FeatureFlagMode;
    compatibilityMode: boolean;
    trafficPolicy: "single_nobie_only" | "shadow_dry_run" | "limited_operator_beta" | "public_default";
    promotionCriteria: string[];
    rollbackAction: string;
}
export interface SubAgentReleaseThresholds {
    duplicateFinalAnswerCount: 0;
    spawnAckP95Ms: number;
    hotRegistrySnapshotP95Ms: number;
    plannerHotPathP95Ms: number;
    firstProgressP95Ms: number;
    restartRecoveryP95Ms: number;
}
export interface SubAgentRestartResumeSoakResult {
    kind: "nobie.sub_agent.restart_resume_soak";
    profileId: "release-short";
    generatedAt: string;
    durationMs: number;
    rootRunCreateSmokePassed: boolean;
    finalAnswerSmokePassed: boolean;
    gatewayRestartSimulated: boolean;
    projectionRecovered: boolean;
    finalizerRecovered: boolean;
    orphanSubSessionCount: number;
    duplicateEventCount: number;
    duplicateFinalAnswerCount: number;
    restartRecoveryP95Ms: number;
    memoryImpactScope: "parent_and_child_scoped";
    channelDeliveryState: "deduped_final_delivered";
    status: SubAgentReleaseGateStatus;
    blockingFailures: string[];
}
export interface SubAgentRollbackEvidence {
    kind: "nobie.sub_agent.rollback_evidence";
    generatedAt: string;
    featureFlagKey: "sub_agent_orchestration";
    featureFlagModeBeforeRollback: FeatureFlagMode;
    featureFlagModeAfterRollback: "off";
    dataDeletionRequired: false;
    singleNobieModeRestored: boolean;
    existingRunCreateSmokePassed: boolean;
    finalAnswerSmokePassed: boolean;
    migrationStatePreserved: boolean;
    status: SubAgentReleaseGateStatus;
    blockingFailures: string[];
}
export interface SubAgentReleaseDryRunSummary {
    kind: "nobie.sub_agent.release_dry_run";
    generatedAt: string;
    orchestrationMode: {
        requestedMode: SubAgentReleaseModeId;
        featureFlagMode: FeatureFlagMode;
        compatibilityMode: boolean;
        gateStatus: SubAgentReleaseGateStatus;
    };
    registry: {
        hotSnapshotP95Ms: number | null;
        targetP95Ms: number;
        status: SubAgentReleaseGateStatus;
    };
    planner: {
        hotPathP95Ms: number | null;
        targetP95Ms: number;
        status: SubAgentReleaseGateStatus;
    };
    eventStream: {
        restartRecoveryP95Ms: number;
        projectionRecovered: boolean;
        duplicateEventCount: number;
        orphanSubSessionCount: number;
        status: SubAgentReleaseGateStatus;
    };
    delivery: {
        duplicateFinalAnswerCount: number;
        channelDedupeCount: number;
        finalDeliveryDedupePassed: boolean;
        status: SubAgentReleaseGateStatus;
    };
    migration: {
        ok: boolean;
        risk: MigrationPreflightRisk;
        currentSchemaVersion: number;
        latestSchemaVersion: number;
        pendingVersions: number[];
        rehearsalIncluded: boolean;
        status: SubAgentReleaseGateStatus;
    };
}
export interface SubAgentReleaseGateCheck {
    id: SubAgentReleaseGateCheckId;
    title: string;
    required: boolean;
    status: SubAgentReleaseGateStatus;
    releaseModes: SubAgentReleaseModeId[];
    summary: string;
    evidence: unknown;
}
export interface SubAgentReleaseReadinessSummary {
    kind: "nobie.sub_agent.release_readiness";
    version: 1;
    generatedAt: string;
    requestedMode: SubAgentReleaseModeId;
    gateStatus: SubAgentReleaseGateStatus;
    modes: SubAgentReleaseModeDefinition[];
    defaultThresholds: SubAgentReleaseThresholds;
    dryRunSummary: SubAgentReleaseDryRunSummary;
    soak: SubAgentRestartResumeSoakResult;
    rollback: SubAgentRollbackEvidence;
    checks: SubAgentReleaseGateCheck[];
    warnings: string[];
    blockingFailures: string[];
}
export interface SubAgentReleaseReadinessOptions {
    now?: Date;
    requestedMode?: SubAgentReleaseModeId;
    featureFlags?: Array<{
        featureKey: string;
        mode: FeatureFlagMode;
        compatibilityMode: boolean;
        source?: string;
    }>;
    migrationPreflight?: {
        ok: boolean;
        risk: MigrationPreflightRisk;
        currentSchemaVersion: number;
        latestSchemaVersion: number;
        pendingVersions: number[];
    };
    performanceEvidence?: ReleasePerformanceSummary;
    benchmarkSuite?: SubAgentBenchmarkSuiteResult;
    orchestrationEvidence?: {
        gateStatus: SubAgentReleaseGateStatus;
        checks: Array<{
            id: string;
            status: SubAgentReleaseGateStatus;
            summary: string;
        }>;
        warnings: string[];
        blockingFailures: string[];
    };
    uiModeEvidence?: Pick<UiModeReleaseGateSummary, "gateStatus" | "blockingFailures">;
    soak?: SubAgentRestartResumeSoakResult;
    rollback?: SubAgentRollbackEvidence;
    thresholds?: Partial<SubAgentReleaseThresholds>;
}
export declare const SUB_AGENT_RELEASE_MODE_SEQUENCE: SubAgentReleaseModeDefinition[];
export declare const DEFAULT_SUB_AGENT_RELEASE_THRESHOLDS: SubAgentReleaseThresholds;
export declare function runSubAgentRestartResumeSoak(input?: {
    now?: Date;
    overrides?: Partial<Pick<SubAgentRestartResumeSoakResult, "rootRunCreateSmokePassed" | "finalAnswerSmokePassed" | "projectionRecovered" | "finalizerRecovered" | "orphanSubSessionCount" | "duplicateEventCount" | "duplicateFinalAnswerCount" | "restartRecoveryP95Ms">>;
}): SubAgentRestartResumeSoakResult;
export declare function buildSubAgentRollbackEvidence(input?: {
    now?: Date;
    featureFlagModeBeforeRollback?: FeatureFlagMode;
    overrides?: Partial<Pick<SubAgentRollbackEvidence, "singleNobieModeRestored" | "existingRunCreateSmokePassed" | "finalAnswerSmokePassed" | "migrationStatePreserved">>;
}): SubAgentRollbackEvidence;
export declare function buildSubAgentReleaseReadinessSummary(options?: SubAgentReleaseReadinessOptions): SubAgentReleaseReadinessSummary;
//# sourceMappingURL=sub-agent-release-gate.d.ts.map