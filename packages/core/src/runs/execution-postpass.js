import { canConsumeRecoveryBudget, getRecoveryBudgetState, } from "./recovery-budget.js";
import { buildCommandFailureRecoveryPrompt, buildExecutionRecoveryPrompt, describeCommandFailureReason, selectCommandFailureRecovery, selectGenericExecutionRecovery, } from "./recovery.js";
export function decideExecutionPostPassRecovery(params) {
    if (params.directArtifactDeliverySatisfied) {
        return { kind: "none" };
    }
    const commandFailureRecovery = selectCommandFailureRecovery({
        failedTools: params.failedCommandTools,
        commandFailureSeen: params.commandFailureSeen,
        commandRecoveredWithinSamePass: params.commandRecoveredWithinSamePass,
        seenKeys: params.seenCommandFailureRecoveryKeys,
    });
    if (commandFailureRecovery) {
        const executionBudget = getRecoveryBudgetState({
            usage: params.recoveryBudgetUsage,
            kind: "execution",
            maxDelegationTurns: params.maxDelegationTurns,
        });
        if ((params.maxDelegationTurns > 0 && params.usedTurns >= params.maxDelegationTurns) || !canConsumeRecoveryBudget({
            usage: params.recoveryBudgetUsage,
            kind: "execution",
            maxDelegationTurns: params.maxDelegationTurns,
        })) {
            return {
                kind: "stop",
                summary: `실행 복구 재시도 한도(${executionBudget.limit > 0 ? executionBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
                reason: commandFailureRecovery.reason,
                remainingItems: ["실패한 명령에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
            };
        }
        return {
            kind: "retry",
            seenKeyKind: "command",
            seenKey: commandFailureRecovery.key,
            state: {
                summary: commandFailureRecovery.summary,
                budgetKind: "execution",
                maxDelegationTurns: params.maxDelegationTurns,
                eventLabel: "명령 실패 대안 재시도",
                nextMessage: buildCommandFailureRecoveryPrompt({
                    originalRequest: params.originalRequest,
                    previousResult: params.preview,
                    summary: commandFailureRecovery.summary,
                    reason: commandFailureRecovery.reason,
                    failedTools: params.failedCommandTools,
                    alternatives: commandFailureRecovery.alternatives,
                }),
                reviewStepStatus: "running",
                executingStepSummary: commandFailureRecovery.summary,
                updateRunStatusSummary: commandFailureRecovery.summary,
                updateRunSummary: commandFailureRecovery.summary,
                clearWorkerRuntime: true,
                alternatives: commandFailureRecovery.alternatives,
                failureTitle: "command_failure_recovery",
                failureDetail: commandFailureRecovery.reason,
            },
        };
    }
    if (params.commandFailureSeen && !params.commandRecoveredWithinSamePass && params.failedCommandTools.length > 0) {
        const latestFailure = params.failedCommandTools[params.failedCommandTools.length - 1];
        return {
            kind: "stop",
            summary: "실행 실패 뒤 사용할 새 명령 대안을 찾지 못해 자동 진행을 멈춥니다.",
            reason: latestFailure
                ? `${describeCommandFailureReason(latestFailure.output)} 이미 시도한 명령 실패 복구 경로와 같은 대안만 남았습니다.`
                : "이미 시도한 명령 실패 복구 경로와 같은 대안만 남았습니다.",
            remainingItems: ["다른 명령/도구/실행 대상을 사용하려면 수동 판단이나 추가 입력이 필요합니다."],
        };
    }
    const genericExecutionRecovery = params.executionRecovery
        ? selectGenericExecutionRecovery({
            executionRecovery: params.executionRecovery,
            seenKeys: params.seenExecutionRecoveryKeys,
        })
        : null;
    if (!genericExecutionRecovery && params.executionRecovery) {
        return {
            kind: "stop",
            summary: "실행 실패 뒤 사용할 새 대안을 찾지 못해 자동 진행을 멈춥니다.",
            reason: `${params.executionRecovery.reason} 이미 시도한 실행 복구 경로와 같은 대안만 남았거나 구조화된 대안이 부족합니다.`,
            remainingItems: ["다른 도구 조합이나 다른 실행 전략을 쓰려면 수동 판단이나 추가 입력이 필요합니다."],
        };
    }
    if (!genericExecutionRecovery) {
        return { kind: "none" };
    }
    const executionBudget = getRecoveryBudgetState({
        usage: params.recoveryBudgetUsage,
        kind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
    });
    if ((params.maxDelegationTurns > 0 && params.usedTurns >= params.maxDelegationTurns) || !canConsumeRecoveryBudget({
        usage: params.recoveryBudgetUsage,
        kind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
    })) {
        return {
            kind: "stop",
            summary: `실행 복구 재시도 한도(${executionBudget.limit > 0 ? executionBudget.limit : params.maxDelegationTurns}회)에 도달했습니다.`,
            reason: genericExecutionRecovery.reason,
            remainingItems: ["실패한 도구에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
        };
    }
    return {
        kind: "retry",
        seenKeyKind: "generic_execution",
        seenKey: genericExecutionRecovery.key,
        state: {
            summary: genericExecutionRecovery.summary,
            budgetKind: "execution",
            maxDelegationTurns: params.maxDelegationTurns,
            eventLabel: "도구 실패 대안 재시도",
            nextMessage: buildExecutionRecoveryPrompt({
                originalRequest: params.originalRequest,
                previousResult: params.preview,
                summary: genericExecutionRecovery.summary,
                reason: genericExecutionRecovery.reason,
                toolNames: params.executionRecovery?.toolNames ?? [],
                alternatives: genericExecutionRecovery.alternatives,
            }),
            reviewStepStatus: "running",
            executingStepSummary: genericExecutionRecovery.summary,
            updateRunStatusSummary: genericExecutionRecovery.summary,
            updateRunSummary: genericExecutionRecovery.summary,
            clearWorkerRuntime: true,
            alternatives: genericExecutionRecovery.alternatives,
            failureTitle: "execution_recovery_followup",
            failureDetail: genericExecutionRecovery.reason,
        },
    };
}
//# sourceMappingURL=execution-postpass.js.map