import { decideSubSessionCompletionIntegration, } from "../agent/sub-agent-result-review.js";
import { deriveCompletionStageState } from "./completion-state.js";
import { canConsumeRecoveryBudget, getRecoveryBudgetState, } from "./recovery-budget.js";
import { decideCompletionApplication, } from "./completion-application.js";
import { decideCompletionFlow, } from "./completion-flow.js";
export function decideSubSessionCompletionPass(params) {
    return decideSubSessionCompletionIntegration(params.subSessionReviews);
}
export function runCompletionPass(params) {
    const state = deriveCompletionStageState({
        review: params.review,
        executionSemantics: params.executionSemantics,
        preview: params.preview,
        deliverySatisfied: params.deliveryOutcome.deliverySatisfied,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
    });
    const decision = decideCompletionFlow({
        review: params.review,
        executionSemantics: params.executionSemantics,
        preview: params.preview,
        deliverySatisfied: params.deliveryOutcome.deliverySatisfied,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        requiresFilesystemMutation: params.requiresFilesystemMutation,
        truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted,
    });
    const usedTurns = params.delegationTurnCount ?? 0;
    const maxTurns = params.maxDelegationTurns ?? params.defaultMaxDelegationTurns;
    const interpretationBudget = getRecoveryBudgetState({
        usage: params.recoveryBudgetUsage,
        kind: "interpretation",
        maxDelegationTurns: maxTurns,
    });
    const application = decideCompletionApplication({
        decision,
        originalRequest: params.originalRequest,
        previousResult: params.preview,
        successfulTools: params.successfulTools,
        sawRealFilesystemMutation: params.sawRealFilesystemMutation,
        usedTurns,
        maxTurns,
        interpretationBudgetLimit: interpretationBudget.limit,
        executionBudgetLimit: getRecoveryBudgetState({
            usage: params.recoveryBudgetUsage,
            kind: "execution",
            maxDelegationTurns: maxTurns,
        }).limit,
        canRetryInterpretation: canConsumeRecoveryBudget({
            usage: params.recoveryBudgetUsage,
            kind: "interpretation",
            maxDelegationTurns: maxTurns,
        }),
        canRetryExecution: canConsumeRecoveryBudget({
            usage: params.recoveryBudgetUsage,
            kind: "execution",
            maxDelegationTurns: maxTurns,
        }),
        followupAlreadySeen: params.followupAlreadySeen,
    });
    return {
        state,
        decision,
        application,
        usedTurns,
        maxTurns,
    };
}
//# sourceMappingURL=completion-pass.js.map