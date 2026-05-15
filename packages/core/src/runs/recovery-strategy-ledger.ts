export interface RecoveryStrategyKey {
  targetRoute: string
  targetAgentId?: string
  executorId?: string
  toolIds: string[]
  sourceIds?: string[]
  inputShapeHash: string
  promptContextHash?: string
  normalizedTaskHash: string
  decompositionHash?: string
  workingDirectory?: string
  fileTargets: string[]
  permissionProfile: string
  userConfirmationState?: string
  executionOrderHash: string
  verificationMethod: string
}

export const RECOVERY_STRATEGY_CHANGE_AXES = [
  "executor",
  "tool_or_source",
  "decomposition",
  "prompt_context",
  "verification_method",
  "permission_or_user_confirmation",
] as const

export type RecoveryStrategyChangeAxis = typeof RECOVERY_STRATEGY_CHANGE_AXES[number]

export interface RecoveryStrategyAttempt {
  attemptId?: string
  scopeId: string
  key: RecoveryStrategyKey
  reason: string
  accepted?: boolean
  createdAt: number
}

export interface RecoveryStrategyLedger {
  attempts: RecoveryStrategyAttempt[]
}

export function createRecoveryStrategyLedger(attempts: RecoveryStrategyAttempt[] = []): RecoveryStrategyLedger {
  return { attempts: [...attempts] }
}

export function recoveryStrategyFingerprint(key: RecoveryStrategyKey): string {
  return JSON.stringify({
    executor: key.executorId ?? key.targetAgentId ?? key.targetRoute,
    targetRoute: key.targetRoute,
    targetAgentId: key.targetAgentId ?? "",
    toolOrSourceIds: [...key.toolIds, ...(key.sourceIds ?? [])].sort(),
    promptContextHash: key.promptContextHash ?? key.inputShapeHash,
    decompositionHash: key.decompositionHash ?? key.normalizedTaskHash,
    workingDirectory: key.workingDirectory ?? "",
    fileTargets: [...key.fileTargets].sort(),
    permissionOrUserConfirmation: `${key.permissionProfile}:${key.userConfirmationState ?? ""}`,
    executionOrderHash: key.executionOrderHash,
    verificationMethod: key.verificationMethod,
  })
}

export function hasRecoveryStrategyAttempt(input: {
  ledger: RecoveryStrategyLedger
  scopeId: string
  key: RecoveryStrategyKey
}): boolean {
  const fingerprint = recoveryStrategyFingerprint(input.key)
  return input.ledger.attempts.some((attempt) =>
    attempt.scopeId === input.scopeId && recoveryStrategyFingerprint(attempt.key) === fingerprint
  )
}

export function recordRecoveryStrategyAttempt(input: {
  ledger: RecoveryStrategyLedger
  scopeId: string
  key: RecoveryStrategyKey
  reason: string
  now?: number
}): { accepted: boolean; ledger: RecoveryStrategyLedger; rejectionReason?: "same_strategy_rejected" } {
  if (hasRecoveryStrategyAttempt(input)) {
    return {
      accepted: false,
      ledger: input.ledger,
      rejectionReason: "same_strategy_rejected",
    }
  }
  return {
    accepted: true,
    ledger: {
      attempts: [
        ...input.ledger.attempts,
        {
          scopeId: input.scopeId,
          key: input.key,
          reason: input.reason,
          createdAt: input.now ?? Date.now(),
        },
      ],
    },
  }
}
