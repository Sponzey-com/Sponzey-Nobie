export interface RecoveryStrategyKey {
  targetRoute: string
  targetAgentId?: string
  toolIds: string[]
  inputShapeHash: string
  normalizedTaskHash: string
  workingDirectory?: string
  fileTargets: string[]
  permissionProfile: string
  executionOrderHash: string
  verificationMethod: string
}

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
    targetRoute: key.targetRoute,
    targetAgentId: key.targetAgentId ?? "",
    toolIds: [...key.toolIds].sort(),
    inputShapeHash: key.inputShapeHash,
    normalizedTaskHash: key.normalizedTaskHash,
    workingDirectory: key.workingDirectory ?? "",
    fileTargets: [...key.fileTargets].sort(),
    permissionProfile: key.permissionProfile,
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
