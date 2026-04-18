import {
  CONTRACT_SCHEMA_VERSION,
  type ContractLocaleHint,
  type ContractSource,
  type IngressEnvelope,
  type IntentContract,
} from "../contracts/index.js"
import type { RootRun } from "./types.js"

export type ExplicitToolIntentName =
  | "screen_capture"
  | "file_send"
  | "window_list"
  | "weather_current"
  | "finance_index_current"

export interface InboundMessageRecord extends IngressEnvelope {
  messageKey: string
  rootIsolation: "new_root_by_default"
}

export interface InboundMessageInput {
  source: RootRun["source"] | ContractSource
  sessionId: string
  channelEventId: string
  externalChatId?: string | number | undefined
  externalThreadId?: string | number | null | undefined
  externalMessageId?: string | number | undefined
  userId?: string | number | null | undefined
  rawText?: string | undefined
  receivedAt?: number | undefined
  localeHint?: ContractLocaleHint | undefined
}

function normalizeIdentityPart(value: string | number | null | undefined): string {
  return value == null ? "-" : String(value).trim() || "-"
}

export function buildInboundMessageKey(input: Pick<InboundMessageInput, "source" | "sessionId" | "externalChatId" | "externalThreadId" | "externalMessageId" | "channelEventId">): string {
  return [
    input.source,
    input.sessionId,
    normalizeIdentityPart(input.externalChatId),
    normalizeIdentityPart(input.externalThreadId),
    normalizeIdentityPart(input.externalMessageId ?? input.channelEventId),
  ].join(":")
}

export function createInboundMessageRecord(input: InboundMessageInput): InboundMessageRecord {
  const channelEventId = input.channelEventId.trim()
  const messageKey = buildInboundMessageKey(input)
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    ingressId: `ingress:${messageKey}`,
    source: input.source as ContractSource,
    channelEventId,
    sessionId: input.sessionId,
    threadId: input.externalThreadId == null ? null : String(input.externalThreadId),
    userId: input.userId == null ? null : String(input.userId),
    receivedAt: input.receivedAt ?? Date.now(),
    ...(input.rawText ? { rawText: input.rawText } : {}),
    ...(input.localeHint ? { localeHint: input.localeHint } : {}),
    messageKey,
    rootIsolation: "new_root_by_default",
  }
}

const EXPLICIT_REFERENCE_PATTERNS = [
  /(?:방금|아까|이전|기존|위(?:의)?|앞(?:의)?|그(?:거|것| 작업| 파일| 결과)?|저(?:거|것)|이(?:거|것)).{0,24}(?:다시|이어|계속|보내|전송|수정|고쳐|바꿔|업데이트|취소|확인)/u,
  /(?:다시|이어|계속|보내|전송|수정|고쳐|바꿔|업데이트|취소|확인)\s*(?:해줘|해|줘|해주세요)?\s*(?:그(?:거|것)?|방금(?: 것)?|아까(?: 것)?|이전(?: 것)?|기존(?: 작업)?)/u,
  /(?:same|that|it|this|previous|last|above|earlier)\s+(?:again|continue|resume|send|resend|fix|update|cancel|change)/i,
  /(?:continue|resume|send|resend|fix|update|cancel|change)\s+(?:that|it|this|previous|last|same)/i,
  /\b(?:continue|resume)\b/i,
  /(?:계속|이어서)\s*(?:해|진행|처리|이어|계속)?/u,
]

const SCREEN_CAPTURE_PATTERNS = [
  /(?:화면|스크린|모니터|디스플레이|display|screen|monitor).*(?:캡처|캡쳐|스크린샷|찍어|보여|capture|screenshot|show)/iu,
  /(?:캡처|캡쳐|스크린샷|capture|screenshot).*(?:화면|스크린|모니터|디스플레이|display|screen|monitor)/iu,
]

const WINDOW_LIST_PATTERN = /(?:창|윈도우|window).*(?:목록|리스트|list|보여|확인)|(?:window_list)/iu
const FILE_SEND_PATTERN = /(?:파일|artifact|첨부|이미지|스크린샷).*(?:보내|전송|send|upload|attach)/iu
const WEATHER_CURRENT_PATTERN = /(?:날씨|weather).*(?:지금|현재|오늘|어때|알려|current|now|today)|(?:지금|현재|오늘).*(?:날씨|weather)/iu
const FINANCE_INDEX_CURRENT_PATTERN = /(?:코스피|kospi|코스닥|kosdaq|나스닥|nasdaq|다우|dow|s&p|sp500|지수|index).*(?:지금|현재|오늘|얼마|알려|current|now|today|price|quote)|(?:지금|현재|오늘).*(?:코스피|kospi|코스닥|kosdaq|나스닥|nasdaq|지수|index)/iu

function contractRequiresToolExecution(contract: IntentContract | undefined): boolean {
  return contract?.actionType === "run_tool" || contract?.requiresApproval === true
}

function contractTargetsDisplay(contract: IntentContract | undefined): boolean {
  return contract?.target.kind === "display" || /display|screen|monitor|화면|모니터/i.test(contract?.target.id ?? contract?.target.displayName ?? "")
}

export function detectExplicitToolIntent(message: string, contract?: IntentContract | undefined): ExplicitToolIntentName | null {
  const text = message.trim()
  if (!text) return null
  if (SCREEN_CAPTURE_PATTERNS.some((pattern) => pattern.test(text)) || (contractRequiresToolExecution(contract) && contractTargetsDisplay(contract))) return "screen_capture"
  if (WINDOW_LIST_PATTERN.test(text)) return "window_list"
  if (FILE_SEND_PATTERN.test(text)) return "file_send"
  if (WEATHER_CURRENT_PATTERN.test(text)) return "weather_current"
  if (FINANCE_INDEX_CURRENT_PATTERN.test(text)) return "finance_index_current"
  return null
}

export function hasExplicitContinuationReference(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  return EXPLICIT_REFERENCE_PATTERNS.some((pattern) => pattern.test(text))
}

export function shouldInspectActiveRunCandidates(params: {
  message: string
  hasStructuredIncomingContract: boolean
  hasExplicitCandidateId: boolean
  hasRequestGroupId: boolean
  forceRequestGroupReuse?: boolean | undefined
  incomingIntentContract?: IntentContract | undefined
}): boolean {
  if (params.hasRequestGroupId) return false
  if (params.hasExplicitCandidateId) return true
  if (!params.hasStructuredIncomingContract) return false
  if (params.forceRequestGroupReuse || hasExplicitContinuationReference(params.message)) return true
  if (detectExplicitToolIntent(params.message, params.incomingIntentContract)) return false
  return false
}
