import {
  buildFilesystemMutationFollowupPrompt,
  buildFilesystemVerificationRecoveryPrompt,
} from "./recovery.js"

export type MissingFilesystemMutationRecoveryDecision =
  | {
      kind: "initial_retry"
      eventLabel: string
      summary: string
      nextMessage: string
    }
  | {
      kind: "retry"
      summary: string
      detail: string
      nextMessage: string
    }
  | {
      kind: "stop"
      summary: string
      reason: string
      remainingItems: string[]
    }

export function decideMissingFilesystemMutationRecovery(params: {
  attempted: boolean
  canRetry: boolean
  originalRequestForRetryPrompt: string
  verificationRequest: string
  previousResult: string
  mutationPaths: string[]
}): MissingFilesystemMutationRecoveryDecision {
  if (!params.attempted) {
    return {
      kind: "initial_retry",
      eventLabel: "실제 파일/폴더 변경이 확인되지 않아 로컬 도구 작업으로 재시도합니다.",
      summary: "실제 파일/폴더 작업을 다시 시도합니다.",
      nextMessage: buildFilesystemMutationFollowupPrompt({
        originalRequest: params.originalRequestForRetryPrompt,
        previousResult: params.previousResult,
      }),
    }
  }

  if (!params.canRetry) {
    return {
      kind: "stop",
      summary: "실제 파일/폴더 생성 또는 수정이 확인되지 않아 자동 진행을 멈췄습니다.",
      reason: "응답 내용만 생성되었고 실제 로컬 파일 작업이 확인되지 않았습니다.",
      remainingItems: [
        "요청한 파일 또는 폴더가 실제로 생성되거나 수정되지 않았습니다.",
        "로컬 도구 실행 권한과 대상 경로를 다시 확인해 주세요.",
      ],
    }
  }

  const summary = "실제 파일/폴더 변경 증거가 없어 다른 방법으로 재시도합니다."
  return {
    kind: "retry",
    summary,
    detail: "응답 내용만 생성되었고 실제 로컬 파일 작업 증거가 아직 없습니다.",
    nextMessage: buildFilesystemVerificationRecoveryPrompt({
      originalRequest: params.verificationRequest,
      previousResult: params.previousResult,
      verificationSummary: summary,
      verificationReason: "실행 응답만 있었고 실제 로컬 파일 또는 폴더 변경 증거가 아직 없습니다.",
      missingItems: [
        "요청한 파일 또는 폴더가 실제로 존재하는지 직접 확인해야 합니다.",
        "누락되었다면 다른 방법으로 직접 생성하거나 수정해야 합니다.",
      ],
      mutationPaths: params.mutationPaths,
    }),
  }
}

export type FilesystemVerificationRecoveryDecision =
  | {
      kind: "verified"
      summary: string
    }
  | {
      kind: "retry"
      summary: string
      detail: string
      nextMessage: string
    }
  | {
      kind: "stop"
      summary: string
      reason?: string
      remainingItems?: string[]
    }

export function decideFilesystemVerificationRecovery(params: {
  verification: {
    ok: boolean
    summary: string
    reason?: string
    remainingItems?: string[]
  }
  canRetry: boolean
  originalRequest: string
  previousResult: string
  mutationPaths: string[]
}): FilesystemVerificationRecoveryDecision {
  if (params.verification.ok) {
    return {
      kind: "verified",
      summary: params.verification.summary,
    }
  }

  if (!params.canRetry) {
    return {
      kind: "stop",
      summary: params.verification.summary,
      ...(params.verification.reason ? { reason: params.verification.reason } : {}),
      ...(params.verification.remainingItems ? { remainingItems: params.verification.remainingItems } : {}),
    }
  }

  return {
    kind: "retry",
    summary: params.verification.summary,
    detail: params.verification.reason ?? params.verification.summary,
    nextMessage: buildFilesystemVerificationRecoveryPrompt({
      originalRequest: params.originalRequest,
      previousResult: params.previousResult,
      verificationSummary: params.verification.summary,
      ...(params.verification.reason ? { verificationReason: params.verification.reason } : {}),
      ...(params.verification.remainingItems ? { missingItems: params.verification.remainingItems } : {}),
      mutationPaths: params.mutationPaths,
    }),
  }
}
