import { applyToolEndChunk, applyToolStartChunk, } from "./tool-chunk-application.js";
import { applyExecutionRecoveryAttempt, } from "./execution-retry-application.js";
import { applyExternalRecoveryAttempt, } from "./external-retry-application.js";
const defaultModuleDependencies = {
    applyToolStartChunk,
    applyToolEndChunk,
    applyExecutionRecoveryAttempt,
    applyExternalRecoveryAttempt,
};
export function applyExecutionChunkPass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (params.chunk.type === "text") {
        const preview = `${params.preview}${params.chunk.delta}`.trim();
        if (preview) {
            dependencies.updateRunSummary(params.runId, preview.slice(-500));
        }
        return {
            handled: true,
            preview,
        };
    }
    if (params.chunk.type === "execution_recovery") {
        const executionRecoveryAttempt = moduleDependencies.applyExecutionRecoveryAttempt({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            recoveryBudgetUsage: params.recoveryBudgetUsage,
            usedTurns: params.usedTurns,
            maxDelegationTurns: params.maxDelegationTurns,
            payload: params.chunk,
        }, dependencies);
        if (executionRecoveryAttempt.kind === "stop") {
            return {
                handled: true,
                executionRecoveryLimitStop: executionRecoveryAttempt.stop,
                abortExecutionStream: true,
            };
        }
        return {
            handled: true,
            executionRecovery: executionRecoveryAttempt.payload,
        };
    }
    if (params.chunk.type === "tool_start") {
        moduleDependencies.applyToolStartChunk({
            runId: params.runId,
            toolName: params.chunk.toolName,
            toolParams: params.chunk.params,
            pendingToolParams: params.pendingToolParams,
        }, dependencies);
        return { handled: true };
    }
    if (params.chunk.type === "tool_end") {
        const toolReceiptState = moduleDependencies.applyToolEndChunk({
            runId: params.runId,
            toolName: params.chunk.toolName,
            success: params.chunk.success,
            output: params.chunk.output,
            toolDetails: params.chunk.details,
            workDir: params.workDir,
            pendingToolParams: params.pendingToolParams,
            successfulTools: params.successfulTools,
            filesystemMutationPaths: params.filesystemMutationPaths,
            failedCommandTools: params.failedCommandTools,
            commandFailureSeen: params.commandFailureSeen,
        }, dependencies);
        return {
            handled: true,
            ...(toolReceiptState.sawRealFilesystemMutation ? { sawRealFilesystemMutation: true } : {}),
            commandFailureSeen: toolReceiptState.commandFailureSeen,
            commandRecoveredWithinSamePass: toolReceiptState.commandRecoveredWithinSamePass,
        };
    }
    const aiRecoveryAttempt = moduleDependencies.applyExternalRecoveryAttempt({
        kind: "ai",
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        usedTurns: params.usedTurns,
        maxDelegationTurns: params.maxDelegationTurns,
        failureTitle: "ai_recovery",
        payload: params.chunk,
        limitRemainingItems: ["AI 호출 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
    }, dependencies);
    if (aiRecoveryAttempt.kind === "stop") {
        return {
            handled: true,
            aiRecoveryLimitStop: aiRecoveryAttempt.stop,
        };
    }
    return {
        handled: true,
        aiRecovery: aiRecoveryAttempt.payload,
    };
}
//# sourceMappingURL=execution-chunk-pass.js.map