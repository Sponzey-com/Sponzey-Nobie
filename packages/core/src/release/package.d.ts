import { type MigrationPreflightReport } from "../config/backup-rehearsal.js";
import { type PlanDriftReleaseNoteEvidence } from "../diagnostics/plan-drift.js";
import { type PromptSourceMetadata } from "../memory/nobie-md.js";
import { type WebRetrievalReleaseGateSummary } from "../runs/web-retrieval-smoke.js";
import { type FeatureFlagMode } from "../runtime/rollout-safety.js";
import { type ReleasePerformanceSummary } from "./performance-gate.js";
import { type UiModeReleaseGateSummary } from "./ui-mode-gate.js";
export type ReleaseTargetPlatform = "macos" | "windows" | "linux";
export type ReleaseArtifactKind = "gateway_node_bundle" | "webui_static" | "yeonjang_macos_app" | "yeonjang_windows_exe" | "yeonjang_linux_binary" | "yeonjang_script" | "yeonjang_protocol" | "db_migration" | "prompt_seed" | "release_runbook" | "admin_diagnostic_bundle";
export type ReleaseArtifactStatus = "present" | "missing_required" | "missing_optional";
export interface ReleaseArtifactDefinition {
    id: string;
    kind: ReleaseArtifactKind;
    sourcePath: string;
    packagePath: string;
    required: boolean;
    platform?: ReleaseTargetPlatform;
    description: string;
}
export interface ReleaseArtifact extends ReleaseArtifactDefinition {
    status: ReleaseArtifactStatus;
    sizeBytes: number | null;
    checksum: string | null;
}
export interface ReleaseManifest {
    kind: "nobie.release.package";
    version: 1;
    releaseVersion: string;
    appVersion: string;
    gitTag: string | null;
    gitCommit: string | null;
    createdAt: string;
    rootDir: string;
    targetPlatforms: ReleaseTargetPlatform[];
    artifacts: ReleaseArtifact[];
    requiredMissing: string[];
    checksums: Array<{
        id: string;
        checksum: string;
        packagePath: string;
    }>;
    backupInventory: {
        included: number;
        excluded: number;
        promptSources: number;
        logicalCoverage: string[];
    };
    updatePreflight: ReleaseUpdatePreflightReport;
    migrationPreflight: Pick<MigrationPreflightReport, "ok" | "risk" | "currentSchemaVersion" | "latestSchemaVersion" | "pendingVersions">;
    featureFlags: ReleaseFeatureFlagState[];
    rolloutEvidence: ReleaseRolloutEvidenceSummary;
    planEvidence: PlanDriftReleaseNoteEvidence;
    webRetrievalEvidence: WebRetrievalReleaseGateSummary;
    uiModeEvidence: UiModeReleaseGateSummary;
    performanceEvidence: ReleasePerformanceSummary;
    orchestrationEvidence: ReleaseOrchestrationEvidenceSummary;
    releaseNotes: ReleaseNoteSummary;
    pipeline: ReleasePipelinePlan;
    rollback: ReleaseRollbackRunbook;
    cleanInstallChecklist: ReleaseChecklistItem[];
}
export interface ReleasePipelineStep {
    id: string;
    title: string;
    command: string[];
    required: boolean;
    smoke: boolean;
    description: string;
}
export interface ReleaseFeatureFlagState {
    featureKey: string;
    mode: FeatureFlagMode;
    compatibilityMode: boolean;
    source: "default" | "db";
}
export type ReleaseOrchestrationEvidenceStatus = "passed" | "warning" | "failed";
export interface ReleaseOrchestrationEvidenceCheck {
    id: "feature_flag_off_parity" | "no_agent_fallback" | "runtime_flag_default";
    status: ReleaseOrchestrationEvidenceStatus;
    summary: string;
    detail: Record<string, unknown>;
}
export interface ReleaseOrchestrationEvidenceSummary {
    kind: "nobie.release.orchestration";
    generatedAt: string;
    gateStatus: ReleaseOrchestrationEvidenceStatus;
    checks: ReleaseOrchestrationEvidenceCheck[];
    warnings: string[];
    blockingFailures: string[];
}
export interface ReleaseRolloutEvidenceSummary {
    mismatchCount: number;
    warningCount: number;
    blockedCount: number;
    latest: Array<{
        featureKey: string;
        stage: string;
        status: string;
        summary: string;
    }>;
}
export interface ReleasePipelinePlan {
    dryRunSafe: true;
    order: string[];
    steps: ReleasePipelineStep[];
}
export interface ReleaseRollbackRunbook {
    id: "release-rollback-runbook";
    title: string;
    stopBeforeRollback: string[];
    restoreTargets: string[];
    steps: string[];
    verification: string[];
    retryForbiddenWhen: string[];
}
export interface ReleaseChecklistItem {
    id: string;
    required: boolean;
    description: string;
}
export interface ReleaseNoteSummary {
    featureFlagDefaults: string[];
    migrationCautions: string[];
    rollbackProcedure: string[];
    knownLimitations: string[];
}
export interface ReleaseUpdatePreflightCheck {
    id: string;
    ok: boolean;
    required: boolean;
    message: string;
}
export interface ReleaseUpdatePreflightReport {
    ok: boolean;
    checks: ReleaseUpdatePreflightCheck[];
}
export interface ReleaseManifestOptions {
    rootDir?: string;
    outputDir?: string;
    releaseVersion?: string;
    gitTag?: string | null;
    gitCommit?: string | null;
    targetPlatforms?: ReleaseTargetPlatform[];
    now?: Date;
    promptSources?: PromptSourceMetadata[];
}
export interface ReleasePackageWriteResult {
    outputDir: string;
    manifestPath: string;
    checksumPath: string;
    copiedArtifacts: Array<{
        id: string;
        sourcePath: string;
        targetPath: string;
    }>;
    manifest: ReleaseManifest;
}
export declare function buildReleaseManifest(options?: ReleaseManifestOptions): ReleaseManifest;
export declare function buildReleaseArtifactDefinitions(input: {
    rootDir: string;
    targetPlatforms?: ReleaseTargetPlatform[];
    promptSources?: PromptSourceMetadata[];
}): ReleaseArtifactDefinition[];
export declare function buildReleasePipelinePlan(input?: {
    targetPlatforms?: ReleaseTargetPlatform[];
}): ReleasePipelinePlan;
export declare function buildReleaseRollbackRunbook(): ReleaseRollbackRunbook;
export declare function buildCleanMachineInstallChecklist(): ReleaseChecklistItem[];
export declare function buildReleaseUpdatePreflightReport(input?: {
    rootDir?: string;
    targetPlatforms?: ReleaseTargetPlatform[];
    promptSourceCount?: number;
}): ReleaseUpdatePreflightReport;
export declare function writeReleasePackage(options: ReleaseManifestOptions & {
    outputDir: string;
    copyPayload?: boolean;
}): ReleasePackageWriteResult;
export declare function buildReleaseOrchestrationEvidence(input: {
    now: Date;
    featureFlags: ReleaseFeatureFlagState[];
}): ReleaseOrchestrationEvidenceSummary;
//# sourceMappingURL=package.d.ts.map