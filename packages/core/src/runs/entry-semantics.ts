export type ActiveQueueCancellationMode = "latest" | "all"

export interface RequestEntrySemantics {
  reuse_conversation_context: boolean
  active_queue_cancellation_mode: ActiveQueueCancellationMode | null
}

export function analyzeRequestEntrySemantics(message: string): RequestEntrySemantics {
  return {
    // Conversation reuse is decided by an isolated AI comparison step in start-plan.ts.
    // Entry semantics keeps only deterministic local checks such as cancellation intent.
    reuse_conversation_context: false,
    active_queue_cancellation_mode: detectActiveQueueCancellationMode(message),
  }
}

export function buildActiveQueueCancellationMessage(params: {
  originalMessage: string
  mode: ActiveQueueCancellationMode
  cancelledTitles: string[]
  remainingCount: number
  hadTargets: boolean
}): string {
  const english = isEnglishCancellationRequest(params.originalMessage)
  if (!params.hadTargets) {
    return english
      ? "There is no active task in this conversation to cancel."
      : "현재 이 대화에서 취소할 실행 중 작업이 없습니다."
  }

  const titleLines = params.cancelledTitles.map((title) => `- ${title}`).join("\n")
  if (english) {
    const heading = params.mode === "all"
      ? `Cancelled ${params.cancelledTitles.length} active task(s) in this conversation.`
      : "Cancelled the most recent active task in this conversation."
    const tail = params.remainingCount > 0
      ? `\n\n${params.remainingCount} other active task(s) are still running.`
      : ""
    return titleLines ? `${heading}\n${titleLines}${tail}` : `${heading}${tail}`
  }

  const heading = params.mode === "all"
    ? `현재 대화의 활성 작업 ${params.cancelledTitles.length}건을 취소했습니다.`
    : "현재 대화에서 가장 최근 활성 작업 1건을 취소했습니다."
  const tail = params.remainingCount > 0
    ? `\n\n아직 ${params.remainingCount}건의 다른 활성 작업은 계속 진행 중입니다.`
    : ""
  return titleLines ? `${heading}\n${titleLines}${tail}` : `${heading}${tail}`
}

function detectActiveQueueCancellationMode(message: string): ActiveQueueCancellationMode | null {
  const trimmed = message.trim()
  if (!trimmed) return null
  if (/(일정|예약|알림|스케줄|schedule|reminder|notification|alarm)/iu.test(trimmed)) return null
  if (!/(취소|중단|멈춰|그만|cancel|abort|stop)/iu.test(trimmed)) return null

  const directPatterns = [
    /^(지금|현재|방금)?\s*(진행\s*중인|하고\s*있는|돌고\s*있는)?\s*(작업|요청|실행|큐|거|것)?\s*(취소|중단|멈춰|그만)(해|해줘|해주세요|해\s*줘|해\s*주세요)?[.!?]*$/u,
    /^(이|그)?\s*(작업|요청|실행|큐|거|것)?\s*(취소|중단|멈춰|그만)(해|해줘|해주세요|해\s*줘|해\s*주세요)?[.!?]*$/u,
    /^(cancel|stop|abort)(\s+the)?(\s+(current|active|running|latest|queued))?(\s+(task|run|request|job|queue))?[.!?]*$/i,
  ]

  const looksDirect = directPatterns.some((pattern) => pattern.test(trimmed))
  const tokenCount = trimmed.split(/\s+/).filter(Boolean).length
  if (!looksDirect && tokenCount > 8) return null

  if (/(모두|전부|다\s*(취소|중단)?|all|everything|every\s*(task|run|request|job)?)/iu.test(trimmed)) {
    return "all"
  }
  return "latest"
}

function isEnglishCancellationRequest(message: string): boolean {
  return !/[가-힣]/.test(message) && /[a-z]/i.test(message)
}
