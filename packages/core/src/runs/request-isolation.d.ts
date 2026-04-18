import { type ContractLocaleHint, type ContractSource, type IngressEnvelope, type IntentContract } from "../contracts/index.js";
import type { RootRun } from "./types.js";
export type ExplicitToolIntentName = "screen_capture" | "file_send" | "window_list" | "weather_current" | "finance_index_current";
export interface InboundMessageRecord extends IngressEnvelope {
    messageKey: string;
    rootIsolation: "new_root_by_default";
}
export interface InboundMessageInput {
    source: RootRun["source"] | ContractSource;
    sessionId: string;
    channelEventId: string;
    externalChatId?: string | number | undefined;
    externalThreadId?: string | number | null | undefined;
    externalMessageId?: string | number | undefined;
    userId?: string | number | null | undefined;
    rawText?: string | undefined;
    receivedAt?: number | undefined;
    localeHint?: ContractLocaleHint | undefined;
}
export declare function buildInboundMessageKey(input: Pick<InboundMessageInput, "source" | "sessionId" | "externalChatId" | "externalThreadId" | "externalMessageId" | "channelEventId">): string;
export declare function createInboundMessageRecord(input: InboundMessageInput): InboundMessageRecord;
export declare function detectExplicitToolIntent(message: string, contract?: IntentContract | undefined): ExplicitToolIntentName | null;
export declare function hasExplicitContinuationReference(message: string): boolean;
export declare function shouldInspectActiveRunCandidates(params: {
    message: string;
    hasStructuredIncomingContract: boolean;
    hasExplicitCandidateId: boolean;
    hasRequestGroupId: boolean;
    forceRequestGroupReuse?: boolean | undefined;
    incomingIntentContract?: IntentContract | undefined;
}): boolean;
//# sourceMappingURL=request-isolation.d.ts.map