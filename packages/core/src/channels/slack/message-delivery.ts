import {
  createRawPayloadRef,
  resolveDeliveryReceiptStatus,
  type ChannelTarget,
  type DeliveryReceipt,
} from "../contracts.js"

export interface SlackDeliveryTarget {
  channelId: string
  threadTs?: string
}

export interface SlackDeliveryReceiptParams {
  target: SlackDeliveryTarget
  idempotencyKey: string
  messageId?: number | string
  fileId?: string
  providerResponse?: unknown
  timestamp?: number | undefined
}

export interface SlackTextPartsDeliveryResult {
  messageIds: string[]
  receipts: DeliveryReceipt[]
}

export interface SlackFileDeliveryResult {
  messageId: string
  receipt: DeliveryReceipt
  fileId?: string
  permalink?: string
}

export class SlackRateLimitError extends Error {
  readonly retryAfterMs: number
  readonly method?: string

  constructor(input: { retryAfterMs: number; method?: string; message?: string }) {
    super(input.message ?? "Slack API rate limit exceeded.")
    this.name = "SlackRateLimitError"
    this.retryAfterMs = input.retryAfterMs
    if (input.method !== undefined) this.method = input.method
  }
}

export function splitSlackText(text: string, maxLength = 3000): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  if (normalized.length <= maxLength) return [normalized]

  const parts: string[] = []
  let remaining = normalized
  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength)
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = remaining.lastIndexOf(" ", maxLength)
    }
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = maxLength
    }
    parts.push(remaining.slice(0, splitIndex).trim())
    remaining = remaining.slice(splitIndex).trim()
  }
  if (remaining) parts.push(remaining)
  return parts
}

export function parseSlackRetryAfterMs(headers: Headers | Record<string, string | number | undefined>): number | undefined {
  const raw = headers instanceof Headers
    ? headers.get("retry-after")
    : headers["retry-after"] ?? headers["Retry-After"]
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim())
  if (!Number.isFinite(value) || value < 0) return undefined
  return Math.trunc(value * 1000)
}

export function buildSlackSentDeliveryReceipt(params: SlackDeliveryReceiptParams): DeliveryReceipt {
  const parts = params.fileId
    ? [{ status: "sent" as const, attachmentId: params.fileId }]
    : undefined
  return {
    channelId: "slack:workspace",
    provider: "slack",
    connectionId: "slack:primary",
    target: slackTargetToChannelTarget(params.target),
    status: resolveDeliveryReceiptStatus({
      sent: true,
      providerSupportsDelivered: false,
    }),
    timestamp: params.timestamp ?? Date.now(),
    idempotencyKey: params.idempotencyKey,
    ...(params.messageId !== undefined ? { messageId: String(params.messageId) } : {}),
    ...(params.target.threadTs !== undefined ? { threadId: params.target.threadTs } : {}),
    ...(parts ? { parts } : {}),
    ...(params.providerResponse !== undefined
      ? {
          providerResponseRef: createRawPayloadRef({
            provider: "slack",
            payload: params.providerResponse,
            createdAt: params.timestamp ?? Date.now(),
          }),
        }
      : {}),
  }
}

export function buildSlackFailedDeliveryReceipt(params: {
  target: SlackDeliveryTarget
  idempotencyKey: string
  error: unknown
  timestamp?: number
}): DeliveryReceipt {
  if (isSlackRateLimitError(params.error)) {
    return {
      channelId: "slack:workspace",
      provider: "slack",
      connectionId: "slack:primary",
      target: slackTargetToChannelTarget(params.target),
      status: "rate_limited",
      timestamp: params.timestamp ?? Date.now(),
      idempotencyKey: params.idempotencyKey,
      retryAfterMs: params.error.retryAfterMs,
      errorCode: "slack_rate_limited",
      errorMessage: params.error.message,
    }
  }

  const message = params.error instanceof Error ? params.error.message : String(params.error)
  return {
    channelId: "slack:workspace",
    provider: "slack",
    connectionId: "slack:primary",
    target: slackTargetToChannelTarget(params.target),
    status: "failed",
    timestamp: params.timestamp ?? Date.now(),
    idempotencyKey: params.idempotencyKey,
    errorCode: "slack_delivery_failed",
    errorMessage: message,
  }
}

export function slackTargetToChannelTarget(target: SlackDeliveryTarget): ChannelTarget {
  return {
    roomId: target.channelId,
    ...(target.threadTs !== undefined ? { threadId: target.threadTs } : {}),
  }
}

function isSlackRateLimitError(error: unknown): error is SlackRateLimitError {
  if (error instanceof SlackRateLimitError) return true
  if (typeof error !== "object" || error === null) return false
  const record = error as Record<string, unknown>
  return record["name"] === "SlackRateLimitError"
    && typeof record["retryAfterMs"] === "number"
    && Number.isFinite(record["retryAfterMs"])
}
