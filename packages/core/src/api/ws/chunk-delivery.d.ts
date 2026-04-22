import { type RunChunkDeliveryHandler } from "../../runs/delivery.js";
import type { MessageLedgerDeliveryKind } from "../../runs/message-ledger.js";
export declare function createWebUiChunkDeliveryHandler(params: {
    sessionId: string;
    runId: string;
    deliveryKind?: MessageLedgerDeliveryKind;
    parentRunId?: string;
    subSessionId?: string;
    agentId?: string;
}): RunChunkDeliveryHandler;
//# sourceMappingURL=chunk-delivery.d.ts.map