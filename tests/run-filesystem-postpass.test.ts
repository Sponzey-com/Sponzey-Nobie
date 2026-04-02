import { describe, expect, it, vi } from "vitest"
import { decideFilesystemPostPassRecovery } from "../packages/core/src/runs/filesystem-postpass.ts"

describe("filesystem post-pass recovery", () => {
  it("returns initial retry when filesystem mutation is still missing", async () => {
    const decision = await decideFilesystemPostPassRecovery({
      requiresFilesystemMutation: true,
      deliverySatisfied: false,
      sawRealFilesystemMutation: false,
      filesystemMutationRecoveryAttempted: false,
      originalRequest: "파일을 생성해줘",
      verificationRequest: "파일을 생성해줘",
      preview: "partial",
      mutationPaths: ["/tmp/a.txt"],
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 2,
      runVerificationSubtask: vi.fn(),
    })

    expect(decision).toEqual({
      kind: "initial_retry",
      eventLabel: "실제 파일/폴더 변경이 확인되지 않아 로컬 도구 작업으로 재시도합니다.",
      summary: "실제 파일/폴더 작업을 다시 시도합니다.",
      nextMessage: expect.stringContaining("[Filesystem Execution Required]"),
      markAttempted: true,
    })
  })

  it("returns verification retry when created files fail verification", async () => {
    const decision = await decideFilesystemPostPassRecovery({
      requiresFilesystemMutation: true,
      deliverySatisfied: false,
      sawRealFilesystemMutation: true,
      filesystemMutationRecoveryAttempted: true,
      originalRequest: "파일을 생성해줘",
      verificationRequest: "파일을 생성해줘",
      preview: "partial",
      mutationPaths: ["/tmp/a.txt"],
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 2,
      runVerificationSubtask: vi.fn().mockResolvedValue({
        ok: false,
        summary: "검증 실패",
        reason: "파일 없음",
        remainingItems: ["경로 확인"],
      }),
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind !== "retry") return
    expect(decision.state.eventLabel).toBe("파일 검증 복구 재시도")
    expect(decision.state.failureTitle).toBe("filesystem_verification_recovery")
    expect(decision.state.nextMessage).toContain("[Filesystem Verification Recovery]")
  })

  it("returns verified with preview append when verification succeeds", async () => {
    const decision = await decideFilesystemPostPassRecovery({
      requiresFilesystemMutation: true,
      deliverySatisfied: false,
      sawRealFilesystemMutation: true,
      filesystemMutationRecoveryAttempted: true,
      originalRequest: "파일을 생성해줘",
      verificationRequest: "파일을 생성해줘",
      preview: "partial",
      mutationPaths: ["/tmp/a.txt"],
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 2,
      runVerificationSubtask: vi.fn().mockResolvedValue({
        ok: true,
        summary: "검증 완료",
      }),
    })

    expect(decision).toEqual({
      kind: "verified",
      summary: "검증 완료",
      eventLabel: "실제 파일/폴더 결과 검증을 완료했습니다.",
      nextPreview: "partial\n\n검증 완료",
    })
  })
})
