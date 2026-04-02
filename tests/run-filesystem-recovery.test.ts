import { describe, expect, it } from "vitest"
import {
  decideFilesystemVerificationRecovery,
  decideMissingFilesystemMutationRecovery,
} from "../packages/core/src/runs/filesystem-recovery.ts"

describe("filesystem recovery decisions", () => {
  it("returns initial retry when filesystem mutation was not yet retried", () => {
    const decision = decideMissingFilesystemMutationRecovery({
      attempted: false,
      canRetry: true,
      originalRequestForRetryPrompt: "create file",
      verificationRequest: "create file",
      previousResult: "partial",
      mutationPaths: ["/tmp/a.txt"],
    })

    expect(decision.kind).toBe("initial_retry")
    expect(decision.summary).toContain("실제 파일/폴더 작업")
  })

  it("returns stop when repeated missing filesystem mutation cannot retry", () => {
    const decision = decideMissingFilesystemMutationRecovery({
      attempted: true,
      canRetry: false,
      originalRequestForRetryPrompt: "create file",
      verificationRequest: "create file",
      previousResult: "partial",
      mutationPaths: ["/tmp/a.txt"],
    })

    expect(decision.kind).toBe("stop")
    if (decision.kind === "stop") {
      expect(decision.reason).toContain("실제 로컬 파일 작업")
    }
  })

  it("returns verification retry when verification fails and retry is allowed", () => {
    const decision = decideFilesystemVerificationRecovery({
      verification: {
        ok: false,
        summary: "검증 실패",
        reason: "파일 없음",
        remainingItems: ["경로 확인"],
      },
      canRetry: true,
      originalRequest: "create file",
      previousResult: "partial",
      mutationPaths: ["/tmp/a.txt"],
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind === "retry") {
      expect(decision.nextMessage).toContain("[Filesystem Verification Recovery]")
    }
  })

  it("returns verified when verification succeeds", () => {
    const decision = decideFilesystemVerificationRecovery({
      verification: {
        ok: true,
        summary: "검증 완료",
      },
      canRetry: true,
      originalRequest: "create file",
      previousResult: "partial",
      mutationPaths: ["/tmp/a.txt"],
    })

    expect(decision).toEqual({
      kind: "verified",
      summary: "검증 완료",
    })
  })
})
