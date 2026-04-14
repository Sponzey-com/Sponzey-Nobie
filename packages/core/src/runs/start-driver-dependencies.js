import { eventBus } from "../events/index.js";
import { insertMessage } from "../db/index.js";
import { getConfig } from "../config/index.js";
import { grantRunApprovalScope, grantRunSingleApproval } from "../tools/dispatcher.js";
import { logAssistantReply } from "./delivery.js";
import { appendRunEvent, cancelRootRun, clearActiveRunController, getRootRun, incrementDelegationTurnCount, setRunStepStatus, updateRunStatus, updateRunSummary, } from "./store.js";
import { markAbortedRunCancelledIfActive, normalizeTaskProfile, rememberRunFailure, rememberRunSuccess, runFilesystemVerificationSubtask, tryHandleActiveQueueCancellation, } from "./start-support.js";
import { buildStartFinalizationDependencies, executeStartLoopDirective, runStartIntakeBridge, } from "./start-bridges.js";
import { enqueueSessionIntake } from "./intake-queue.js";
import { scheduleDelayedRootRun } from "./run-queueing.js";
export function buildStartRootRunDriverDependencies(params) {
    const finalizationDependencies = buildStartFinalizationDependencies({
        appendRunEvent,
        setRunStepStatus,
        updateRunStatus,
        rememberRunSuccess,
        rememberRunFailure,
        onDeliveryError: (deliveryMessage) => params.logWarn(deliveryMessage),
    });
    const maxDelegationTurns = getConfig().orchestration.maxDelegationTurns;
    const syntheticApprovalRuntimeDependencies = {
        timeoutSec: getConfig().security.approvalTimeout,
        fallback: getConfig().security.approvalTimeoutFallback === "allow" ? "allow_once" : "deny",
        appendRunEvent,
        setRunStepStatus,
        updateRunStatus,
        cancelRun: (approvalRunId, denial) => {
            cancelRootRun(approvalRunId, denial);
        },
        emitApprovalResolved: (payload) => eventBus.emit("approval.resolved", payload),
        emitApprovalRequest: (payload) => eventBus.emit("approval.request", payload),
        onRequested: (payload) => {
            params.logInfo("synthetic approval requested", payload);
        },
    };
    const driverDependencies = {
        appendRunEvent,
        updateRunSummary,
        setRunStepStatus,
        updateRunStatus,
        rememberRunFailure,
        incrementDelegationTurnCount,
        markAbortedRunCancelledIfActive,
        getDelegationTurnState: () => {
            const currentRun = getRootRun(params.runId);
            return {
                usedTurns: currentRun?.delegationTurnCount ?? 0,
                maxTurns: currentRun?.maxDelegationTurns ?? maxDelegationTurns,
            };
        },
        getFinalizationDependencies: () => finalizationDependencies,
        insertMessage,
        writeReplyLog: logAssistantReply,
        createId: () => crypto.randomUUID(),
        now: () => Date.now(),
        runVerificationSubtask: ({ originalRequest, mutationPaths }) => {
            return runFilesystemVerificationSubtask({
                parentRunId: params.runId,
                requestGroupId: params.requestGroupId,
                sessionId: params.sessionId,
                source: params.source,
                onChunk: params.onChunk,
                originalRequest,
                mutationPaths,
                workDir: params.workDir,
            });
        },
        rememberRunApprovalScope: (approvedRunId) => params.syntheticApprovalScopes.add(approvedRunId),
        grantRunApprovalScope,
        grantRunSingleApproval,
        onDeliveryError: (message) => params.logWarn(message),
        onReviewError: (message) => {
            params.logWarn(`completion review failed: ${message}`);
        },
        executeLoopDirective: (directive) => executeStartLoopDirective({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            directive,
            finalizationDependencies,
        }),
        tryHandleActiveQueueCancellation: () => tryHandleActiveQueueCancellation({
            runId: params.runId,
            sessionId: params.sessionId,
            message: params.message,
            mode: params.activeQueueCancellationMode,
        }),
        tryHandleIntakeBridge: ({ currentMessage, originalRequest }) => enqueueSessionIntake({
            sessionId: params.sessionId,
            runId: params.runId,
            requestGroupId: params.requestGroupId,
            task: () => runStartIntakeBridge({
                message: currentMessage,
                originalRequest,
                sessionId: params.sessionId,
                requestGroupId: params.requestGroupId,
                model: params.model,
                workDir: params.workDir,
                source: params.source,
                runId: params.runId,
                onChunk: params.onChunk,
                reuseConversationContext: params.reuseConversationContext,
                scheduleDelayedRun: (delayedParams) => scheduleDelayedRootRun(delayedParams, {
                    startRootRun: params.startNestedRootRun,
                    logInfo: params.logInfo,
                    logWarn: params.logWarn,
                    logError: params.logError,
                }),
                startDelegatedRun: (startParams) => {
                    params.startNestedRootRun({
                        ...startParams,
                        model: startParams.model,
                    });
                },
            }, {
                appendRunEvent,
                updateRunSummary,
                incrementDelegationTurnCount,
                emitScheduleCreated: (payload) => eventBus.emit("schedule.created", payload),
                emitScheduleCancelled: (payload) => eventBus.emit("schedule.cancelled", payload),
                normalizeTaskProfile,
                logInfo: (message, payload) => {
                    params.logInfo(message, payload);
                },
            }),
        }, {
            logInfo: params.logInfo,
            logWarn: params.logWarn,
            logError: params.logError,
            appendRunEvent,
        }),
        getSyntheticApprovalAlreadyApproved: () => params.syntheticApprovalScopes.has(params.runId),
        onBootstrapInfo: (message, payload) => {
            params.logInfo(message, payload);
        },
        onFinally: () => {
            params.syntheticApprovalScopes.delete(params.runId);
            clearActiveRunController(params.runId);
        },
    };
    return {
        finalizationDependencies,
        syntheticApprovalRuntimeDependencies,
        driverDependencies,
    };
}
//# sourceMappingURL=start-driver-dependencies.js.map