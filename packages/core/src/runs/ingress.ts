import { startRootRun, type StartedRootRun, type StartRootRunParams } from "./start.js"

export type IngressReceiptLanguage = "ko" | "en" | "mixed" | "unknown"

export interface IngressReceipt {
  language: IngressReceiptLanguage
  text: string
}

export interface IngressExternalIdentity {
  source: StartRootRunParams["source"]
  sessionId: string
  externalChatId?: string | number | undefined
  externalThreadId?: string | number | undefined
  externalMessageId?: string | number | undefined
}

export interface StartedIngressRun {
  requestId: string
  sessionId: string
  source: StartRootRunParams["source"]
  receipt: IngressReceipt
  started: StartedRootRun
}

export interface ResolvedIngressStartParams extends StartRootRunParams {
  runId: string
  sessionId: string
}

function normalizeIngressIdentityPart(value: string | number | undefined): string {
  return value == null ? "-" : String(value).trim() || "-"
}

export function buildIngressDedupeKey(identity: IngressExternalIdentity): string {
  return [
    identity.source,
    identity.sessionId,
    normalizeIngressIdentityPart(identity.externalChatId),
    normalizeIngressIdentityPart(identity.externalThreadId),
    normalizeIngressIdentityPart(identity.externalMessageId),
  ].join(":")
}

function detectIngressReceiptLanguage(message: string): IngressReceiptLanguage {
  const hangulCount = (message.match(/[가-힣]/gu) ?? []).length
  const latinCount = (message.match(/[A-Za-z]/g) ?? []).length

  if (hangulCount > 0 && latinCount > 0) return "mixed"
  if (hangulCount > 0) return "ko"
  if (latinCount > 0) return "en"
  return "unknown"
}

// Ingress receipt stays generic on purpose so the request is acknowledged immediately
// without trying to interpret or complete the user's task in the channel layer.
export function buildIngressReceipt(message: string): IngressReceipt {
  const language = detectIngressReceiptLanguage(message)
  if (language === "ko" || language === "mixed") {
    return {
      language,
      text: "요청을 접수했습니다. 분석을 시작합니다.",
    }
  }

  return {
    language,
    text: "Request received. Starting analysis.",
  }
}

// Ingress is responsible for fixing the external request identity before the
// heavier run loop begins. Downstream code should receive resolved identifiers.
export function resolveIngressStartParams(params: StartRootRunParams): ResolvedIngressStartParams {
  return {
    ...params,
    runId: params.runId ?? crypto.randomUUID(),
    sessionId: params.sessionId ?? crypto.randomUUID(),
  }
}

// Ingress owns the immediate acknowledgement boundary.
// Downstream execution keeps using startRootRun, but channel/API entry points
// should start from this helper instead of assembling receipt logic themselves.
export function startIngressRun(params: StartRootRunParams): StartedIngressRun {
  const resolved = resolveIngressStartParams(params)
  return {
    requestId: resolved.runId,
    sessionId: resolved.sessionId,
    source: resolved.source,
    receipt: buildIngressReceipt(resolved.message),
    started: startRootRun(resolved),
  }
}
