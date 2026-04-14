import { type StartedRootRun, type StartRootRunParams } from "./start.js";
export type IngressReceiptLanguage = "ko" | "en" | "mixed" | "unknown";
export interface IngressReceipt {
    language: IngressReceiptLanguage;
    text: string;
}
export interface IngressExternalIdentity {
    source: StartRootRunParams["source"];
    sessionId: string;
    externalChatId?: string | number | undefined;
    externalThreadId?: string | number | undefined;
    externalMessageId?: string | number | undefined;
}
export interface StartedIngressRun {
    requestId: string;
    sessionId: string;
    source: StartRootRunParams["source"];
    receipt: IngressReceipt;
    started: StartedRootRun;
}
export interface ResolvedIngressStartParams extends StartRootRunParams {
    runId: string;
    sessionId: string;
}
export declare function buildIngressDedupeKey(identity: IngressExternalIdentity): string;
export declare function buildIngressReceipt(message: string): IngressReceipt;
export declare function resolveIngressStartParams(params: StartRootRunParams): ResolvedIngressStartParams;
export declare function startIngressRun(params: StartRootRunParams): StartedIngressRun;
//# sourceMappingURL=ingress.d.ts.map