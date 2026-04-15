import type { NobieConfig } from "../config/types.js";
export type ChannelSmokeChannel = "webui" | "telegram" | "slack";
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
}
export interface ChannelSmokeRunnerOptions {
    config: NobieConfig;
    scenarios?: ChannelSmokeScenario[];
    executeScenario: (scenario: ChannelSmokeScenario) => Promise<ChannelSmokeTrace>;
}
export declare function getDefaultChannelSmokeScenarios(): ChannelSmokeScenario[];
export declare function resolveChannelSmokeReadiness(config: NobieConfig, scenario: ChannelSmokeScenario): ChannelSmokeReadiness;
export declare function validateChannelSmokeTrace(scenario: ChannelSmokeScenario, trace: ChannelSmokeTrace): ChannelSmokeValidation;
export declare function runChannelSmokeScenarios(options: ChannelSmokeRunnerOptions): Promise<ChannelSmokeRunResult[]>;
