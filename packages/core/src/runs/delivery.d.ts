import type { AgentChunk } from "../agent/index.js";
import { type ArtifactRetentionPolicy } from "../artifacts/lifecycle.js";
import { insertMessage } from "../db/index.js";
import { type MessageLedgerDeliveryKind } from "./message-ledger.js";
export interface SuccessfulFileDelivery {
    toolName: string;
    channel: "telegram" | "webui" | "slack";
    filePath: string;
    url?: string;
    previewUrl?: string;
    downloadUrl?: string;
    previewable?: boolean;
    mimeType?: string;
    sizeBytes?: number;
    caption?: string;
    messageId?: number;
}
export interface SuccessfulTextDelivery {
    channel: DeliverySource;
    text: string;
    messageIds?: number[];
    deliveryKind?: MessageLedgerDeliveryKind;
    parentRunId?: string;
    subSessionId?: string;
    agentId?: string;
}
export interface ChunkDeliveryReceipt {
    artifactDeliveries?: SuccessfulFileDelivery[];
    textDeliveries?: SuccessfulTextDelivery[];
}
export interface DeliveryOutcome {
    mode?: "reply" | "direct_artifact" | "channel_message" | "none";
    directArtifactDeliveryRequested: boolean;
    hasSuccessfulArtifactDelivery: boolean;
    hasSuccessfulTextDelivery?: boolean;
    textDeliverySatisfied?: boolean;
    deliverySatisfied: boolean;
    deliverySummary?: string;
    requiresDirectArtifactRecovery: boolean;
}
export type RunChunkDeliveryHandler = ((chunk: AgentChunk) => Promise<ChunkDeliveryReceipt | void> | ChunkDeliveryReceipt | void) | undefined;
export type DeliverySource = "webui" | "cli" | "telegram" | "slack";
export interface ArtifactDeliveryOnceParams<T> {
    runId?: string | undefined;
    channel: SuccessfulFileDelivery["channel"];
    filePath: string;
    channelTarget?: string | undefined;
    mimeType?: string | undefined;
    sizeBytes?: number | undefined;
    retentionPolicy?: ArtifactRetentionPolicy | undefined;
    force?: boolean | undefined;
    forceReason?: string | undefined;
    task: () => Promise<T>;
}
export interface AssistantTextDeliveryReceipt {
    persisted: boolean;
    textDelivered: boolean;
    doneDelivered: boolean;
}
export interface AssistantTextDeliveryOutcome {
    persisted: boolean;
    textDelivered: boolean;
    doneDelivered: boolean;
    hasDeliveryFailure: boolean;
    failureStage: "none" | "text" | "done" | "text_and_done";
    summary: string;
}
interface AssistantTextDeliveryDependencies {
    now: () => number;
    createId: () => string;
    insertMessage: typeof insertMessage;
    emitStart: (payload: {
        sessionId: string;
        runId: string;
    }) => void;
    emitStream: (payload: {
        sessionId: string;
        runId: string;
        delta: string;
    }) => void;
    emitEnd: (payload: {
        sessionId: string;
        runId: string;
        durationMs: number;
    }) => void;
    writeReplyLog: (source: DeliverySource, text: string) => void;
}
export declare function buildArtifactDeliveryKey(params: {
    runId: string;
    channel: SuccessfulFileDelivery["channel"];
    filePath: string;
}): string;
export declare function deliverArtifactOnce<T>(params: ArtifactDeliveryOnceParams<T>): Promise<T | undefined>;
export declare function resetArtifactDeliveryDedupeForTest(): void;
export declare function displayHomePath(value: string): string;
export declare function buildSuccessfulDeliverySummary(deliveries: SuccessfulFileDelivery[]): string;
export declare function describeArtifactForUser(delivery: Pick<SuccessfulFileDelivery, "filePath" | "url">): string;
export declare function resendArtifact<T>(params: Omit<ArtifactDeliveryOnceParams<T>, "force">): Promise<T | undefined>;
export declare function resolveDeliveryOutcome(params: {
    wantsDirectArtifactDelivery: boolean;
    deliveries: SuccessfulFileDelivery[];
    textDeliveries?: SuccessfulTextDelivery[];
}): DeliveryOutcome;
export declare function emitAssistantTextDelivery(params: {
    runId: string;
    sessionId: string;
    text: string;
    source: DeliverySource;
    onChunk: RunChunkDeliveryHandler;
    persistMessage?: boolean;
    emitDone?: boolean;
    deliveryKind?: Extract<MessageLedgerDeliveryKind, "progress" | "final">;
    parentRunId?: string;
    subSessionId?: string;
    agentId?: string;
    force?: boolean;
    onError?: (message: string) => void;
    dependencies?: Partial<AssistantTextDeliveryDependencies>;
}): Promise<AssistantTextDeliveryReceipt>;
export declare function resolveAssistantTextDeliveryOutcome(receipt: AssistantTextDeliveryReceipt): AssistantTextDeliveryOutcome;
export declare function deliverChunk(params: {
    onChunk: RunChunkDeliveryHandler;
    chunk: AgentChunk;
    runId: string;
    onError?: (message: string) => void;
}): Promise<ChunkDeliveryReceipt | undefined>;
export declare function deliverTrackedChunk(params: {
    onChunk: RunChunkDeliveryHandler;
    chunk: AgentChunk;
    runId: string;
    onError?: (message: string) => void;
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTextDeliveries: SuccessfulTextDelivery[];
    appendEvent: (runId: string, label: string) => void;
}): Promise<ChunkDeliveryReceipt | undefined>;
export declare function applyChunkDeliveryReceipt(params: {
    runId: string;
    receipt: ChunkDeliveryReceipt | undefined;
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTextDeliveries: SuccessfulTextDelivery[];
    appendEvent: (runId: string, label: string) => void;
}): void;
export declare function logAssistantReply(source: DeliverySource, text: string): void;
export {};
//# sourceMappingURL=delivery.d.ts.map