import type { SourceFreshnessPolicy, SourceKind, SourceReliability } from "./web-retrieval-policy.js";
import type { RetrievalSourceMethod, RetrievalTargetKind } from "./web-retrieval-session.js";
import type { CandidateExtractionHints, RetrievalEvidenceSufficiency, RetrievalExtractionInputKind, RetrievalVerificationVerdict } from "./web-retrieval-verification.js";
import type { WebSourceAdapterRegistrySnapshot } from "./web-source-adapters/index.js";
import { type EvidenceConflictPolicy } from "./web-conflict-resolver.js";
import { type RetrievalCacheTtlPolicy } from "./web-retrieval-cache.js";
export declare const WEB_RETRIEVAL_FIXTURE_SCHEMA_VERSION = 1;
export type WebRetrievalSmokeStatus = "passed" | "failed" | "skipped" | "warning";
export type WebRetrievalLiveSmokeMode = "dry-run" | "live-run";
export interface WebRetrievalFixtureTargetInput {
    kind?: RetrievalTargetKind;
    rawQuery?: string | null;
    canonicalName?: string | null;
    symbols?: string[];
    market?: string | null;
    locationName?: string | null;
    locale?: string | null;
}
export interface WebRetrievalFixtureSource {
    id: string;
    method: RetrievalSourceMethod;
    status?: "succeeded" | "failed";
    toolName?: string | null;
    sourceKind: SourceKind;
    reliability: SourceReliability;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    sourceLabel?: string | null;
    sourceTimestamp?: string | null;
    fetchTimestamp?: string | null;
    inputKind: RetrievalExtractionInputKind;
    content?: unknown;
    hints?: CandidateExtractionHints;
    errorKind?: string | null;
    stopReason?: string | null;
}
export interface WebRetrievalFixtureExpected {
    canAnswer: boolean;
    acceptedValue?: string | null;
    evidenceSufficiency: RetrievalEvidenceSufficiency;
    minAttempts?: number;
    limitedCompletionOk?: boolean;
}
export interface WebRetrievalFixture {
    schemaVersion: number;
    id: string;
    title: string;
    freshnessPolicy: SourceFreshnessPolicy;
    target: WebRetrievalFixtureTargetInput;
    sources: WebRetrievalFixtureSource[];
    expected: WebRetrievalFixtureExpected;
}
export interface WebRetrievalFixtureRegressionResult {
    fixtureId: string;
    title: string;
    status: WebRetrievalSmokeStatus;
    failures: string[];
    attempts: number;
    candidateCount: number;
    verdict: RetrievalVerificationVerdict;
    sanitizedSummary: string;
}
export interface WebRetrievalFixtureRegressionSummary {
    kind: "web_retrieval.fixture_regression";
    policyVersion: string;
    startedAt: string;
    finishedAt: string;
    status: WebRetrievalSmokeStatus;
    counts: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    };
    results: WebRetrievalFixtureRegressionResult[];
}
export interface WebRetrievalLiveSmokeScenario {
    id: string;
    title: string;
    request: string;
    target: WebRetrievalFixtureTargetInput;
    freshnessPolicy: SourceFreshnessPolicy;
    minimumMethods: RetrievalSourceMethod[];
    expectsAnswerOrLimitedCompletion: boolean;
}
export interface WebRetrievalLiveSmokeTrace {
    attemptedMethods: RetrievalSourceMethod[];
    sourceDomains?: string[];
    answerProduced: boolean;
    verdict?: Pick<RetrievalVerificationVerdict, "canAnswer" | "evidenceSufficiency" | "acceptedValue" | "rejectionReason" | "caveats"> | null;
    limitedCompletionOk?: boolean;
    finalText?: string | null;
    artifactPath?: string | null;
    rawError?: string | null;
    skipped?: boolean;
    skipReason?: string;
}
export interface WebRetrievalLiveSmokeResult {
    scenario: WebRetrievalLiveSmokeScenario;
    status: WebRetrievalSmokeStatus;
    failures: string[];
    reason?: string;
    trace?: WebRetrievalLiveSmokeTrace;
    startedAt: string;
    finishedAt: string;
}
export interface WebRetrievalLiveSmokeSummary {
    kind: "web_retrieval.live_smoke";
    mode: WebRetrievalLiveSmokeMode;
    smokeId: string;
    policyVersion: string;
    startedAt: string;
    finishedAt: string;
    status: WebRetrievalSmokeStatus;
    artifactPath?: string | null;
    diagnosticEventId?: string | null;
    counts: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    };
    results: WebRetrievalLiveSmokeResult[];
}
export interface WebRetrievalReleaseGateSummary {
    kind: "web_retrieval.release_gate";
    policyVersion: string;
    sourceAdapters: WebSourceAdapterRegistrySnapshot;
    conflictPolicy: EvidenceConflictPolicy;
    cachePolicy: RetrievalCacheTtlPolicy;
    fixtureRegression: Pick<WebRetrievalFixtureRegressionSummary, "status" | "counts" | "results"> | null;
    liveSmoke: Pick<WebRetrievalLiveSmokeSummary, "mode" | "smokeId" | "status" | "counts" | "artifactPath"> | null;
    gateStatus: "passed" | "failed" | "warning";
    blockingFailures: string[];
    warnings: string[];
}
export declare function loadWebRetrievalFixturesFromDir(dir: string): WebRetrievalFixture[];
export declare function runWebRetrievalFixtureRegression(fixtures: WebRetrievalFixture[], input?: {
    startedAt?: Date;
    finishedAt?: Date;
}): WebRetrievalFixtureRegressionSummary;
export declare function getDefaultWebRetrievalLiveSmokeScenarios(): WebRetrievalLiveSmokeScenario[];
export declare function isLiveWebSmokeEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function createDryRunWebRetrievalLiveSmokeExecutor(input?: {
    traceOverrides?: Partial<Record<string, Partial<WebRetrievalLiveSmokeTrace>>>;
}): (scenario: WebRetrievalLiveSmokeScenario) => Promise<WebRetrievalLiveSmokeTrace>;
export declare function runWebRetrievalLiveSmokeScenarios(input?: {
    mode?: WebRetrievalLiveSmokeMode;
    scenarios?: WebRetrievalLiveSmokeScenario[];
    executeScenario?: (scenario: WebRetrievalLiveSmokeScenario) => Promise<WebRetrievalLiveSmokeTrace>;
    env?: NodeJS.ProcessEnv;
    writeArtifact?: boolean;
    now?: Date;
}): Promise<WebRetrievalLiveSmokeSummary>;
export declare function validateWebRetrievalLiveSmokeTrace(scenario: WebRetrievalLiveSmokeScenario, trace: WebRetrievalLiveSmokeTrace): string[];
export declare function writeWebRetrievalSmokeArtifact(summary: WebRetrievalLiveSmokeSummary): WebRetrievalLiveSmokeSummary;
export declare function buildWebRetrievalReleaseGateSummary(input?: {
    fixtureRegression?: WebRetrievalFixtureRegressionSummary | null;
    liveSmoke?: WebRetrievalLiveSmokeSummary | null;
    requireLiveSmokePass?: boolean;
    sourceAdapters?: WebSourceAdapterRegistrySnapshot;
}): WebRetrievalReleaseGateSummary;
export declare function buildFixtureRegressionFromWorkspace(rootDir: string): WebRetrievalFixtureRegressionSummary | null;
export declare function fixtureFileNameForId(id: string): string;
//# sourceMappingURL=web-retrieval-smoke.d.ts.map