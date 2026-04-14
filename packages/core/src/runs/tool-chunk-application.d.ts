import { type AppliedToolExecutionReceiptState } from "./execution.js";
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js";
export interface ToolChunkApplicationDependencies {
    appendRunEvent: (runId: string, event: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
}
export declare function applyToolStartChunk(params: {
    runId: string;
    toolName: string;
    toolParams: unknown;
    pendingToolParams: Map<string, unknown>;
}, dependencies: ToolChunkApplicationDependencies): void;
export declare function applyToolEndChunk(params: {
    runId: string;
    toolName: string;
    success: boolean;
    output: string;
    toolDetails?: unknown;
    workDir: string;
    pendingToolParams: Map<string, unknown>;
    successfulTools: SuccessfulToolEvidence[];
    filesystemMutationPaths: Set<string>;
    failedCommandTools: FailedCommandTool[];
    commandFailureSeen: boolean;
}, dependencies: ToolChunkApplicationDependencies): AppliedToolExecutionReceiptState;
//# sourceMappingURL=tool-chunk-application.d.ts.map