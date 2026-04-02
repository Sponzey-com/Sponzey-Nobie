import { canConsumeRecoveryBudget, type RecoveryBudgetUsage } from "./recovery-budget.js"
import {
  decideFilesystemVerificationRecovery,
  decideMissingFilesystemMutationRecovery,
} from "./filesystem-recovery.js"
import type { RecoveryRetryApplicationState } from "./retry-application.js"

export interface FilesystemVerificationResult {
  ok: boolean
  summary: string
  reason?: string
  remainingItems?: string[]
}

export type FilesystemPostPassDecision =
  | { kind: "none" }
  | {
      kind: "initial_retry"
      eventLabel: string
      summary: string
      nextMessage: string
      markAttempted: true
    }
  | {
      kind: "retry"
      state: RecoveryRetryApplicationState
    }
  | {
      kind: "stop"
      summary: string
      reason?: string
      remainingItems?: string[]
    }
  | {
      kind: "verified"
      summary: string
      eventLabel: string
      nextPreview: string
    }

export async function decideFilesystemPostPassRecovery(params: {
  requiresFilesystemMutation: boolean
  deliverySatisfied: boolean
  sawRealFilesystemMutation: boolean
  filesystemMutationRecoveryAttempted: boolean
  originalRequest: string
  verificationRequest: string
  preview: string
  mutationPaths: string[]
  recoveryBudgetUsage: RecoveryBudgetUsage
  usedTurns: number
  maxDelegationTurns: number
  runVerificationSubtask: () => Promise<FilesystemVerificationResult>
}): Promise<FilesystemPostPassDecision> {
  if (!params.requiresFilesystemMutation || params.deliverySatisfied) {
    return { kind: "none" }
  }

  const canRetryExecution = (params.maxDelegationTurns <= 0 || params.usedTurns < params.maxDelegationTurns)
    && canConsumeRecoveryBudget({
      usage: params.recoveryBudgetUsage,
      kind: "execution",
      maxDelegationTurns: params.maxDelegationTurns,
    })

  if (!params.sawRealFilesystemMutation) {
    const mutationDecision = decideMissingFilesystemMutationRecovery({
      attempted: params.filesystemMutationRecoveryAttempted,
      canRetry: canRetryExecution,
      originalRequestForRetryPrompt: params.originalRequest,
      verificationRequest: params.verificationRequest,
      previousResult: params.preview,
      mutationPaths: params.mutationPaths,
    })

    if (mutationDecision.kind === "stop") {
      return mutationDecision
    }

    if (mutationDecision.kind === "initial_retry") {
      return {
        kind: "initial_retry",
        eventLabel: mutationDecision.eventLabel,
        summary: mutationDecision.summary,
        nextMessage: mutationDecision.nextMessage,
        markAttempted: true,
      }
    }

    return {
      kind: "retry",
      state: {
        summary: mutationDecision.summary,
        budgetKind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
        eventLabel: "파일 작업 복구 재시도",
        nextMessage: mutationDecision.nextMessage,
        reviewStepStatus: "running",
        executingStepSummary: mutationDecision.summary,
        updateRunStatusSummary: mutationDecision.summary,
        updateRunSummary: mutationDecision.summary,
        clearWorkerRuntime: true,
        failureTitle: "filesystem_mutation_recovery",
        failureDetail: mutationDecision.detail,
      },
    }
  }

  const verification = await params.runVerificationSubtask()
  const verificationDecision = decideFilesystemVerificationRecovery({
    verification,
    canRetry: canRetryExecution,
    originalRequest: params.originalRequest,
    previousResult: params.preview,
    mutationPaths: params.mutationPaths,
  })

  if (verificationDecision.kind === "stop") {
    return verificationDecision
  }

  if (verificationDecision.kind === "retry") {
    return {
      kind: "retry",
      state: {
        summary: verificationDecision.summary,
        budgetKind: "execution",
        maxDelegationTurns: params.maxDelegationTurns,
        eventLabel: "파일 검증 복구 재시도",
        nextMessage: verificationDecision.nextMessage,
        reviewStepStatus: "running",
        executingStepSummary: verificationDecision.summary,
        updateRunStatusSummary: verificationDecision.summary,
        updateRunSummary: verificationDecision.summary,
        clearWorkerRuntime: true,
        failureTitle: "filesystem_verification_recovery",
        failureDetail: verificationDecision.detail,
      },
    }
  }

  return {
    kind: "verified",
    summary: verificationDecision.summary,
    eventLabel: "실제 파일/폴더 결과 검증을 완료했습니다.",
    nextPreview: [params.preview.trim(), verificationDecision.summary].filter(Boolean).join("\n\n"),
  }
}
