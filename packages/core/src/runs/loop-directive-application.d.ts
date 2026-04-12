import type { RunChunkDeliveryHandler } from "./delivery.js";
import { completeRunWithAssistantMessage, markRunCompleted, type FinalizationDependencies, type FinalizationSource } from "./finalization.js";
import { applyTerminalApplication } from "./terminal-application.js";
import type { LoopDirective } from "./loop-directive.js";
interface LoopDirectiveApplicationModuleDependencies {
    completeRunWithAssistantMessage: typeof completeRunWithAssistantMessage;
    markRunCompleted: typeof markRunCompleted;
    applyTerminalApplication: typeof applyTerminalApplication;
}
export declare function applyLoopDirective(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    directive: LoopDirective;
    finalizationDependencies: FinalizationDependencies;
}, moduleDependencies?: LoopDirectiveApplicationModuleDependencies): Promise<"break">;
export {};
//# sourceMappingURL=loop-directive-application.d.ts.map