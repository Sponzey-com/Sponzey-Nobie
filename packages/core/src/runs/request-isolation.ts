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

function contractRequiresToolExecution(contract: IntentContract | undefined): boolean {
  return contract?.actionType === "run_tool" || contract?.requiresApproval === true
}

function contractTargetsDisplay(contract: IntentContract | undefined): boolean {
  const targetId = contract?.target.id?.trim()
  return contract?.target.kind === "display"
    || targetId === "display"
    || targetId?.startsWith("display:") === true
    || targetId?.startsWith("screen:") === true
    || targetId?.startsWith("monitor:") === true
}

function contractTargetsWindowList(contract: IntentContract | undefined): boolean {
  const targetId = contract?.target.id?.trim()
  return targetId === "window:list" || targetId === "windows:list" || targetId?.startsWith("window:") === true
}

function contractTargetsFileDelivery(contract: IntentContract | undefined): boolean {
  return contract?.target.kind === "file"
    || contract?.target.kind === "artifact"
    || contract?.delivery.mode === "direct_artifact"
}

function contractTargetsWeather(contract: IntentContract | undefined): boolean {
  const targetId = contract?.target.id?.trim()
  return targetId === "weather" || targetId?.startsWith("weather:") === true
}

function contractTargetsFinanceIndex(contract: IntentContract | undefined): boolean {
  const targetId = contract?.target.id?.trim()
  return targetId === "finance" || targetId?.startsWith("finance:") === true || targetId?.startsWith("market-index:") === true
}

function contractReferencesActiveRunCandidate(contract: IntentContract | undefined): boolean {
  if (!contract) return false
  const targetId = contract.target.id?.trim()
  if (contract.intentType === "cancel" || contract.intentType === "update") return true
  if (contract.target.kind === "run" || contract.target.kind === "artifact" || contract.target.kind === "schedule") return true
  if (contract.delivery.explicitResend === true) return true
  return targetId?.startsWith("run:") === true
    || targetId?.startsWith("request-group:") === true
    || targetId?.startsWith("approval:") === true
    || targetId?.startsWith("artifact:") === true
    || targetId?.startsWith("schedule:") === true
}

export function detectExplicitToolIntent(message: string, contract?: IntentContract | undefined): ExplicitToolIntentName | null {
  void message
  if (!contractRequiresToolExecution(contract)) return null
  if (contractTargetsDisplay(contract) || contract?.target.kind === "camera") return "screen_capture"
  if (contractTargetsWindowList(contract)) return "window_list"
  if (contractTargetsFileDelivery(contract)) return "file_send"
  if (contractTargetsWeather(contract)) return "weather_current"
  if (contractTargetsFinanceIndex(contract)) return "finance_index_current"
  return null
}

export function hasExplicitContinuationReference(message: string): boolean {
  void message
  return false
}

export function shouldInspectActiveRunCandidates(params: {
  message: string
  hasStructuredIncomingContract: boolean
  hasExplicitCandidateId: boolean
  hasRequestGroupId: boolean
  forceRequestGroupReuse?: boolean | undefined
  incomingIntentContract?: IntentContract | undefined
}): boolean {
  void params.message
  if (params.hasRequestGroupId) return false
  if (params.hasExplicitCandidateId) return true
  if (!params.hasStructuredIncomingContract) return false
  if (params.forceRequestGroupReuse) return true
  return contractReferencesActiveRunCandidate(params.incomingIntentContract)
}
