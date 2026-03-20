import type { RootRun } from "../contracts/runs"
import type { UiLanguage } from "../stores/uiLanguage"
import { pickUiText } from "../stores/uiLanguage"
import type { ApprovalRequest } from "../stores/chat"

export function filterRunsForChatSession(runs: RootRun[], sessionId: string | null): RootRun[] {
  if (sessionId) return runs.filter((run) => run.sessionId === sessionId)
  return runs.filter((run) => run.source === "webui")
}

function findPendingInteractionEvent(run: RootRun, language: UiLanguage): ApprovalRequest | null {
  const recentEvents = [...run.recentEvents].sort((a, b) => b.at - a.at)

  if (run.status === "awaiting_user") {
    const screenEvent = recentEvents.find((event) => event.label.endsWith("화면 준비 확인 요청"))
    if (!screenEvent) return null
    return {
      runId: run.id,
      toolName: screenEvent.label.replace(/\s*화면 준비 확인 요청$/, "") || "screen_confirmation",
      params: { summary: run.summary },
      kind: "screen_confirmation",
      guidance: pickUiText(language, "대상 창이 열려 있고, 원하는 위치나 입력창이 준비되었는지 확인해 주세요. 준비가 끝나면 계속 진행할 수 있습니다.", "Check that the target window is open and the intended input area is ready. Once it is ready, you can continue.") ,
    }
  }

  if (run.status === "awaiting_approval") {
    const approvalEvent = recentEvents.find((event) => event.label.endsWith("승인 요청"))
    if (!approvalEvent) return null
    return {
      runId: run.id,
      toolName: approvalEvent.label.replace(/\s*승인 요청$/, "") || "approval",
      params: { summary: run.summary },
      kind: "approval",
      guidance: pickUiText(language, "이 작업은 권한 승인을 기다리고 있습니다. 내용을 확인한 뒤 승인하거나 취소할 수 있습니다.", "This task is waiting for approval. Review the details, then approve or cancel it."),
    }
  }

  return null
}

export function resolvePendingInteractionForRun(run: RootRun, explicit: ApprovalRequest | null, language: UiLanguage): ApprovalRequest | null {
  if (explicit?.runId === run.id) return explicit
  return findPendingInteractionEvent(run, language)
}

export function resolvePendingInteractionForSession(
  runs: RootRun[],
  sessionId: string | null,
  explicit: ApprovalRequest | null,
  language: UiLanguage,
): ApprovalRequest | null {
  const sessionRuns = filterRunsForChatSession(runs, sessionId)

  if (explicit) {
    const exactRun = sessionRuns.find((run) => run.id === explicit.runId)
    if (exactRun && (exactRun.status === "awaiting_approval" || exactRun.status === "awaiting_user")) {
      return explicit
    }
  }

  const waitingRun = [...sessionRuns]
    .filter((run) => run.status === "awaiting_approval" || run.status === "awaiting_user")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]

  if (!waitingRun) return null
  return findPendingInteractionEvent(waitingRun, language)
}
