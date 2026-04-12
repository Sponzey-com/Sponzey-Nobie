import type { AgentChunk } from "../agent/index.js";
import { insertMessage } from "../db/index.js";
export interface SuccessfulFileDelivery {
    toolName: string;
    channel: "telegram" | "webui" | "slack";
    filePath: string;
    caption?: string;
    messageId?: number;
}
export interface SuccessfulTextDelivery {
    channel: DeliverySource;
    text: string;
    messageIds?: number[];
}
export interface ChunkDeliveryReceipt {
    artifactDeliveries?: SuccessfulFileDelivery[];
    textDeliveries?: SuccessfulTextDelivery[];
}
export interface DeliveryOutcome {
    directArtifactDeliveryRequested: boolean;
    hasSuccessfulArtifactDelivery: boolean;
    deliverySatisfied: boolean;
    deliverySummary?: string;
    requiresDirectArtifactRecovery: boolean;
}
export type RunChunkDeliveryHandler = ((chunk: AgentChunk) => Promise<ChunkDeliveryReceipt | void> | ChunkDeliveryReceipt | void) | undefined;
export type DeliverySource = "webui" | "cli" | "telegram" | "slack";
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
export declare function displayHomePath(value: string): string;
export declare function buildSuccessfulDeliverySummary(deliveries: SuccessfulFileDelivery[]): string;
export declare function resolveDeliveryOutcome(params: {
    wantsDirectArtifactDelivery: boolean;
    deliveries: SuccessfulFileDelivery[];
}): DeliveryOutcome;
export declare function emitAssistantTextDelivery(params: {
    runId: string;
    sessionId: string;
    text: string;
    source: DeliverySource;
    onChunk: RunChunkDeliveryHandler;
    persistMessage?: boolean;
    emitDone?: boolean;
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