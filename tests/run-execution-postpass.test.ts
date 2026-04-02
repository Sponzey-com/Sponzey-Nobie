import { describe, expect, it } from "vitest"
import { decideExecutionPostPassRecovery } from "../packages/core/src/runs/execution-postpass.ts"

describe("execution post-pass recovery", () => {
  it("returns a command failure retry when an unseen failed command exists", () => {
    const decision = decideExecutionPostPassRecovery({
      originalRequest: "스크린샷을 보내줘",
      preview: "screencapture failed",
      failedCommandTools: [
        {
          toolName: "shell_exec",
          output: "command not found: screencapture",
        },
      ],
      commandFailureSeen: true,
      commandRecoveredWithinSamePass: false,
      executionRecovery: null,
      seenCommandFailureRecoveryKeys: new Set<string>(),
      seenExecutionRecoveryKeys: new Set<string>(),
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 3,
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind !== "retry") return
    expect(decision.seenKeyKind).toBe("command")
    expect(decision.state.eventLabel).toBe("명령 실패 대안 재시도")
    expect(decision.state.failureTitle).toBe("command_failure_recovery")
    expect(decision.state.nextMessage).toContain("[Command Failure Recovery]")
  })

  it("returns a stop when generic execution recovery has exhausted budget", () => {
    const decision = decideExecutionPostPassRecovery({
      originalRequest: "예약을 등록해줘",
      preview: "create_schedule failed",
      failedCommandTools: [],
      commandFailureSeen: false,
      commandRecoveredWithinSamePass: false,
      executionRecovery: {
        summary: "create_schedule 실패 후 다른 방법을 찾습니다.",
        reason: "invalid schedule registration path",
        toolNames: ["create_schedule"],
      },
      seenCommandFailureRecoveryKeys: new Set<string>(),
      seenExecutionRecoveryKeys: new Set<string>(),
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 2,
      maxDelegationTurns: 2,
    })

    expect(decision).toEqual({
      kind: "stop",
      summary: "실행 복구 재시도 한도(2회)에 도달했습니다.",
      reason: "invalid schedule registration path",
      remainingItems: ["실패한 도구에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
    })
  })

  it("returns stop when command failure has no unseen alternative path left", () => {
    const decision = decideExecutionPostPassRecovery({
      originalRequest: "스크린샷을 보내줘",
      preview: "screencapture failed",
      failedCommandTools: [
        {
          toolName: "shell_exec",
          output: "command not found: screencapture",
        },
      ],
      commandFailureSeen: true,
      commandRecoveredWithinSamePass: false,
      executionRecovery: null,
      seenCommandFailureRecoveryKeys: new Set<string>([
        "shell_exec:command not found: screencapture",
      ]),
      seenExecutionRecoveryKeys: new Set<string>(),
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 3,
    })

    expect(decision).toEqual({
      kind: "stop",
      summary: "실행 실패 뒤 사용할 새 명령 대안을 찾지 못해 자동 진행을 멈춥니다.",
      reason: "실행 명령을 찾지 못해 다른 명령이나 다른 도구 경로를 찾아야 합니다. 이미 시도한 명령 실패 복구 경로와 같은 대안만 남았습니다.",
      remainingItems: ["다른 명령/도구/실행 대상을 사용하려면 수동 판단이나 추가 입력이 필요합니다."],
    })
  })

  it("returns stop when generic execution recovery has no new alternative path left", () => {
    const decision = decideExecutionPostPassRecovery({
      originalRequest: "예약을 등록해줘",
      preview: "create_schedule failed",
      failedCommandTools: [],
      commandFailureSeen: false,
      commandRecoveredWithinSamePass: false,
      executionRecovery: {
        summary: "create_schedule 실패 후 다른 방법을 찾습니다.",
        reason: "invalid schedule registration path",
        toolNames: ["create_schedule"],
      },
      seenCommandFailureRecoveryKeys: new Set<string>(),
      seenExecutionRecoveryKeys: new Set<string>([
        "create_schedule:invalid schedule registration path",
      ]),
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 3,
    })

    expect(decision).toEqual({
      kind: "stop",
      summary: "실행 실패 뒤 사용할 새 대안을 찾지 못해 자동 진행을 멈춥니다.",
      reason: "invalid schedule registration path 이미 시도한 실행 복구 경로와 같은 대안만 남았거나 구조화된 대안이 부족합니다.",
      remainingItems: ["다른 도구 조합이나 다른 실행 전략을 쓰려면 수동 판단이나 추가 입력이 필요합니다."],
    })
  })
})
