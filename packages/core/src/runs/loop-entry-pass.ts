import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import {
  applyIntakeRetryDirective,
  type IntakeRetryApplicationDependencies,
} from "./intake-retry-application.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"
import type { LoopDirective } from "./loop-directive.js"

export type LoopEntryPassResult =
  | { kind: "break" }
  | { kind: "retry"; nextMessage: string }
  | { kind: "set_directive"; directive: LoopDirective; intakeProcessed: boolean }
  | { kind: "proceed"; intakeProcessed: boolean }

interface LoopEntryPassDependencies extends IntakeRetryApplicationDependencies {
  getDelegationTurnState: () => { usedTurns: number; maxTurns: number }
  executeLoopDirective: (directive: LoopDirective) => Promise<"break">
  tryHandleActiveQueueCancellation: () => Promise<LoopDirective | null>
  tryHandleIntakeBridge: () => Promise<LoopDirective | null>
}

interface LoopEntryPassModuleDependencies {
  applyIntakeRetryDirective: typeof applyIntakeRetryDirective
}

const defaultModuleDependencies: LoopEntryPassModuleDependencies = {
  applyIntakeRetryDirective,
}

export async function runLoopEntryPass(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    pendingLoopDirective: LoopDirective | null
    intakeProcessed: boolean
    recoveryBudgetUsage: RecoveryBudgetUsage
    finalizationDependencies: FinalizationDependencies
  },
  dependencies: LoopEntryPassDependencies,
  moduleDependencies: LoopEntryPassModuleDependencies = defaultModuleDependencies,
): Promise<LoopEntryPassResult> {
  if (params.pendingLoopDirective) {
    const directive = params.pendingLoopDirective
    if (directive.kind === "retry_intake") {
      const { usedTurns, maxTurns } = dependencies.getDelegationTurnState()
      const intakeRetryApplication = await moduleDependencies.applyIntakeRetryDirective({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        directive,
        usedTurns,
        maxTurns,
        recoveryBudgetUsage: params.recoveryBudgetUsage,
        finalizationDependencies: params.finalizationDependencies,
      }, dependencies)

      if (intakeRetryApplication.kind === "break") {
        return { kind: "break" }
      }

      return {
        kind: "retry",
        nextMessage: intakeRetryApplication.nextMessage,
      }
    }

    await dependencies.executeLoopDirective(directive)
    return { kind: "break" }
  }

  if (!params.intakeProcessed) {
    const cancellationDirective = await dependencies.tryHandleActiveQueueCancellation()
    if (cancellationDirective) {
      return {
        kind: "set_directive",
        directive: cancellationDirective,
        intakeProcessed: true,
      }
    }

    const intakeDirective = await dependencies.tryHandleIntakeBridge()
    if (intakeDirective) {
      return {
        kind: "set_directive",
        directive: intakeDirective,
        intakeProcessed: true,
      }
    }

    return {
      kind: "proceed",
      intakeProcessed: true,
    }
  }

  return {
    kind: "proceed",
    intakeProcessed: params.intakeProcessed,
  }
}
