import type { RootRun, RunContextMode } from "../../contracts/runs"
import type { UiLanguage } from "../../stores/uiLanguage"
import { pickUiText } from "../../stores/uiLanguage"

export function toRunStatusText(status: RootRun["status"], language: UiLanguage) {
  switch (status) {
    case "queued":
      return pickUiText(language, "대기", "Queued")
    case "running":
      return pickUiText(language, "진행 중", "Running")
    case "awaiting_approval":
      return pickUiText(language, "승인 대기", "Awaiting approval")
    case "awaiting_user":
      return pickUiText(language, "사용자 확인", "Awaiting user")
    case "completed":
      return pickUiText(language, "완료", "Completed")
    case "failed":
      return pickUiText(language, "실패", "Failed")
    case "cancelled":
      return pickUiText(language, "취소됨", "Cancelled")
    case "interrupted":
      return pickUiText(language, "중단됨", "Interrupted")
  }
}

export function toTaskProfileText(taskProfile: RootRun["taskProfile"], language: UiLanguage) {
  switch (taskProfile) {
    case "planning":
      return pickUiText(language, "계획", "Planning")
    case "coding":
      return pickUiText(language, "코드 작업", "Coding")
    case "review":
      return pickUiText(language, "검토", "Review")
    case "research":
      return pickUiText(language, "리서치", "Research")
    case "private_local":
      return pickUiText(language, "로컬 작업", "Local work")
    case "summarization":
      return pickUiText(language, "요약", "Summarization")
    case "operations":
      return pickUiText(language, "운영", "Operations")
    default:
      return pickUiText(language, "일반", "General")
  }
}

export function toContextModeText(contextMode: RunContextMode, language: UiLanguage) {
  switch (contextMode) {
    case "request_group":
      return pickUiText(language, "같은 요청만 참조", "Use only the same request")
    case "isolated":
      return pickUiText(language, "현재 요청만 단독 처리", "Use only this request")
    default:
      return pickUiText(language, "대화 전체 참조", "Use the full conversation")
  }
}
