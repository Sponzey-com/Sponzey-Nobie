import { insertMessage } from "../db/index.js";
import { type DeliverySource } from "./delivery.js";
import type { RunStepStatus } from "./types.js";
interface ReviewTransitionDependencies {
    appendRunEvent: (runId: string, label: string) => void;
    setRunStepStatus: (runId: string, step: string, status: RunStepStatus, summary: string) => unknown;
    insertMessage: typeof insertMessage;
    writeReplyLog: (source: DeliverySource, text: string) => void;
    createId: () => string;
    now: () => number;
}
export declare function prepareRunForReview(params: {
    runId: string;
    sessionId: string;
    source: DeliverySource;
    preview: string;
    workerSessionId?: string;
    persistRuntimePreview: boolean;
    dependencies?: Partial<ReviewTransitionDependencies>;
}): void;
export {};
//# sourceMappingURL=review-transition.d.ts.map