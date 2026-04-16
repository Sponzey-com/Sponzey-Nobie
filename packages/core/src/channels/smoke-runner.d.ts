import type { NobieConfig } from "../config/types.js";
export type ChannelSmokeChannel = "webui" | "telegram" | "slack";
export type ChannelSmokeRunMode = "dry-run" | "live-run";
export type ChannelSmokeScenarioKind = "basic_query" | "approval_required_tool" | "artifact_delivery" | "failure_tool";
export type ChannelSmokeStatus = "passed" | "failed" | "skipped";
export type ChannelSmokeCorrelationKey = "webui_run_id" | "telegram_chat_thread" | "slack_thread";
export type ChannelSmokeArtifactMode = "native_file" | "download_link" | "inline_preview" | "local_path_markdown";
export interface ChannelSmokeScenario {
    id: string;
    channel: ChannelSmokeChannel;
    kind: ChannelSmokeScenarioKind;
    title: string;
    request: string;
    expectedTarget: ChannelSmokeChannel;
    correlationKey: ChannelSmokeCorrelationKey;
    requiresExternalCredential: boolean;
    expectedTool?: string;
    expectsApproval?: boolean;
    expectsArtifact?: boolean;
    expectsFailure?: boolean;
}
export interface ChannelSmokeReadiness {
    ready: boolean;
    skipReason?: string;
}
export interface ChannelSmokeToolTrace {
    toolName: string;
    sourceChannel: ChannelSmokeChannel;
    deliveryChannel?: ChannelSmokeChannel;
}
export interface ChannelSmokeArtifactTrace {
    channel: ChannelSmokeChannel;
    mode: ChannelSmokeArtifactMode;
    filePath?: string;
    url?: string;
}
export interface ChannelSmokeApprovalTrace {
    requested: boolean;
    resolved?: "approve_once" | "approve_all" | "deny" | "timeout";
    targetChannel?: ChannelSmokeChannel;
    correlationKey?: ChannelSmokeCorrelationKey;
    uiVisible?: boolean;
    uiKind?: "button" | "text_fallback" | "inline" | "none";
}
export interface ChannelSmokeTrace {
    sourceChannel: ChannelSmokeChannel;
    responseChannel?: ChannelSmokeChannel;
    correlationKey?: ChannelSmokeCorrelationKey;
    toolCalls?: ChannelSmokeToolTrace[];
    approval?: ChannelSmokeApprovalTrace;
    artifacts?: ChannelSmokeArtifactTrace[];
    finalText?: string;
    auditLogId?: string;
    skipped?: boolean;
    skipReason?: string;
}
export interface ChannelSmokeValidation {
    status: ChannelSmokeStatus;
    reason?: string;
    failures: string[];
}
export interface ChannelSmokeRunResult {
    scenario: ChannelSmokeScenario;
    status: ChannelSmokeStatus;
    reason?: string;
    failures: string[];
    auditLogId?: string;
    trace?: ChannelSmokeTrace;
    startedAt?: number;
    finishedAt?: number;
}
export interface ChannelSmokeRunnerOptions {
    config: NobieConfig;
    scenarios?: ChannelSmokeScenario[];
    executeScenario: (scenario: ChannelSmokeScenario) => Promise<ChannelSmokeTrace>;
}
export interface PersistedChannelSmokeRunResult {
    runId: string;
    mode: ChannelSmokeRunMode;
    status: ChannelSmokeStatus;
    startedAt: number;
    finishedAt: number;
    summary: string;
    counts: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
    };
    results: ChannelSmokeRunResult[];
}
export interface PersistedChannelSmokeRunnerOptions extends Omit<ChannelSmokeRunnerOptions, "executeScenario"> {
    mode?: ChannelSmokeRunMode;
    initiatedBy?: string;
    metadata?: Record<string, unknown>;
    executeScenario?: (scenario: ChannelSmokeScenario) => Promise<ChannelSmokeTrace>;
}
export declare function getDefaultChannelSmokeScenarios(): ChannelSmokeScenario[];
export declare function resolveChannelSmokeReadiness(config: NobieConfig, scenario: ChannelSmokeScenario): ChannelSmokeReadiness;
export declare function validateChannelSmokeTrace(scenario: ChannelSmokeScenario, trace: ChannelSmokeTrace): ChannelSmokeValidation;
export declare function runChannelSmokeScenarios(options: ChannelSmokeRunnerOptions): Promise<ChannelSmokeRunResult[]>;
export declare function createDryRunChannelSmokeExecutor(input?: {
    traceOverrides?: Partial<Record<string, Partial<ChannelSmokeTrace>>>;
}): (scenario: ChannelSmokeScenario) => Promise<ChannelSmokeTrace>;
export declare function sanitizeChannelSmokeValue(value: unknown): unknown;
export declare function sanitizeChannelSmokeTrace(trace: ChannelSmokeTrace | undefined): ChannelSmokeTrace | undefined;
export declare function runPersistedChannelSmokeScenarios(options: PersistedChannelSmokeRunnerOptions): Promise<PersistedChannelSmokeRunResult>;
//# sourceMappingURL=smoke-runner.d.ts.map