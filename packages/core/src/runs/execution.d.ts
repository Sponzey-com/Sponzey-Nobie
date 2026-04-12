import type { TaskExecutionSemantics } from "../agent/intake.js";
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js";
export type ToolExecutionExecutor = "yeonjang" | "local" | "file_tool" | "core";
export interface ToolExecutionReceipt {
    toolName: string;
    success: boolean;
    output: string;
    summary: string;
    executor: ToolExecutionExecutor;
    successfulTool?: SuccessfulToolEvidence;
    filesystemMutation: boolean;
    mutationPaths: string[];
    commandFailure: boolean;
    commandRecoveredWithinSamePass: boolean;
}
export interface AppliedToolExecutionReceiptState {
    sawRealFilesystemMutation: boolean;
    commandFailureSeen: boolean;
    commandRecoveredWithinSamePass: boolean;
}
export declare function allowsTextOnlyCompletion(params: {
    executionSemantics: TaskExecutionSemantics;
}): boolean;
export declare function hasMeaningfulCompletionEvidence(params: {
    executionSemantics: TaskExecutionSemantics;
    preview: string;
    deliverySatisfied: boolean;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
}): boolean;
export declare function buildImplicitExecutionSummary(params: {
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
}): string | undefined;
export declare function isRealFilesystemMutation(toolName: string, params: unknown): boolean;
export declare function normalizeFilesystemPath(value: string | undefined, workDir: string): string | undefined;
export declare function collectFilesystemMutationPaths(toolName: string, params: unknown, workDir: string): string[];
export declare function inferFilesystemKindFromPath(path: string): "file" | "dir";
export declare function buildToolExecutionReceipt(params: {
    toolName: string;
    success: boolean;
    output: string;
    toolParams: unknown;
    toolDetails?: unknown;
    workDir: string;
    commandFailureSeen: boolean;
}): ToolExecutionReceipt;
export declare function applyToolExecutionReceipt(params: {
    receipt: ToolExecutionReceipt;
    successfulTools: SuccessfulToolEvidence[];
    filesystemMutationPaths: Set<string>;
    failedCommandTools: FailedCommandTool[];
    toolParams: unknown;
    previousCommandFailureSeen: boolean;
}): AppliedToolExecutionReceiptState;
//# sourceMappingURL=execution.d.ts.map