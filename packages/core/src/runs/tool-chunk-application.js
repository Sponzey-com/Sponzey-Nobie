import { applyToolExecutionReceipt, buildToolExecutionReceipt, } from "./execution.js";
export function applyToolStartChunk(params, dependencies) {
    params.pendingToolParams.set(params.toolName, params.toolParams);
    const summary = `${params.toolName} 실행 중`;
    dependencies.appendRunEvent(params.runId, `${params.toolName} 실행 시작`);
    dependencies.updateRunSummary(params.runId, summary);
}
export function applyToolEndChunk(params, dependencies) {
    const toolParams = params.pendingToolParams.get(params.toolName);
    params.pendingToolParams.delete(params.toolName);
    const toolReceipt = buildToolExecutionReceipt({
        toolName: params.toolName,
        success: params.success,
        output: params.output,
        toolParams,
        toolDetails: params.toolDetails,
        workDir: params.workDir,
        commandFailureSeen: params.commandFailureSeen,
    });
    const nextState = applyToolExecutionReceipt({
        receipt: toolReceipt,
        successfulTools: params.successfulTools,
        filesystemMutationPaths: params.filesystemMutationPaths,
        failedCommandTools: params.failedCommandTools,
        toolParams,
        previousCommandFailureSeen: params.commandFailureSeen,
    });
    dependencies.appendRunEvent(params.runId, toolReceipt.summary);
    dependencies.updateRunSummary(params.runId, toolReceipt.summary);
    return nextState;
}
//# sourceMappingURL=tool-chunk-application.js.map