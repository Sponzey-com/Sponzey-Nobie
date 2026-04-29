export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type BuiltInChannelProvider =
  | "telegram"
  | "slack"
  | "discord"
  | "google_chat"
  | "imessage"
  | "kakaotalk"
export type ChannelProvider = BuiltInChannelProvider | (string & {})
export type InternalChannelSurface = "webui" | "cli"
export type ChannelSurface = InternalChannelSurface | "external_provider"
export type KnownChannelSource = InternalChannelSurface | BuiltInChannelProvider
export type ChannelSource = KnownChannelSource | (string & {})
export type KnownChannelProvider = BuiltInChannelProvider
export type ChannelProviderId = ChannelSource
export type ChannelId = string
export type ChannelConnectionId = string
export type ChannelRiskLevel = "low" | "medium" | "high" | "experimental"
export type ChannelConnectionKind =
  | "internal"
  | "bot_api"
  | "socket"
  | "webhook"
  | "local_bridge"
  | "manual_bridge"

export type RawPayloadStorage = "none" | "redacted_inline" | "external_ref"
export type RawPayloadRedactionState = "not_stored" | "redacted" | "externalized"

export interface RawPayloadRef {
  storage: RawPayloadStorage
  redactionState: RawPayloadRedactionState
  provider: ChannelProviderId
  createdAt: number
  ref?: string
  preview?: JsonValue
}

export interface ChannelIdentity {
  id: string
  displayName?: string
  username?: string
  email?: string
  isBot?: boolean
  providerType?: "user" | "bot" | "system" | "service_account" | "unknown"
}

export interface ChannelRoom {
  id: string
  displayName?: string
  type?: "direct" | "group" | "channel" | "topic" | "space" | "unknown"
}

export interface ChannelWorkspace {
  id: string
  displayName?: string
}

export interface ChannelAccessPolicySnapshot {
  decision: "allowed" | "blocked"
  reasonCode: string
  principalKeys: {
    user: string[]
    room: string[]
  }
  matchedPrincipals: string[]
  requireAllowedPrincipal: boolean
  allowUnlisted: boolean
  summary: string
}

export interface ChannelAttachment {
  id?: string
  name?: string
  mimeType?: string
  sizeBytes?: number
  kind: "file" | "image" | "audio" | "video" | "link" | "unknown"
  url?: string
  localPath?: string
  contentRef?: string
  altText?: string
}

export interface ChannelMention {
  id: string
  displayName?: string
  kind: "user" | "room" | "channel" | "agent" | "unknown"
}

export interface ChannelContinuationContext {
  taskId?: string
  runId?: string
  requestGroupId?: string
  parentMessageId?: string
  parentDeliveryId?: string
  source?: "reply" | "thread" | "quote" | "manual" | "latest_context"
}

export interface InboundEnvelope {
  channelId: ChannelId
  provider: ChannelProviderId
  connectionId: ChannelConnectionId
  messageId: string
  threadId?: string
  replyToMessageId?: string
  sender: ChannelIdentity
  room?: ChannelRoom
  workspace?: ChannelWorkspace
  text: string
  attachments: ChannelAttachment[]
  mentions: ChannelMention[]
  timestamp: number
  rawPayloadRef: RawPayloadRef
  continuationContext?: ChannelContinuationContext
  accessPolicy?: ChannelAccessPolicySnapshot
  dedupeKey: string
}

export type OutboundDeliveryMode =
  | "receipt"
  | "progress"
  | "final"
  | "diagnostic"
  | "approval_request"
  | "artifact"
  | "text"
export type OutboundPriority = "low" | "normal" | "high"
export type OutboundThreadPolicyMode =
  | "none"
  | "provider_default"
  | "new_thread"
  | "reuse_thread"
  | "reply_to_message"
export type OutboundChunkMode = "none" | "provider_default" | "split" | "summarize_then_link"
export type OutboundRedactionPolicy = "default" | "strict" | "diagnostic_only"

export interface ChannelTarget {
  roomId?: string
  userId?: string
  threadId?: string
  messageId?: string
  topicId?: string
}

export interface OutboundThreadPolicy {
  mode: OutboundThreadPolicyMode
  threadId?: string
  replyToMessageId?: string
}

export interface OutboundChunkPolicy {
  mode: OutboundChunkMode
  maxLength?: number
  preserveCodeBlocks?: boolean
}

export type ChannelActionKind =
  | "approval"
  | "cancel"
  | "retry"
  | "choose_option"
  | "provide_input"
  | "open_url"

export interface ChannelAction {
  id: string
  kind: ChannelActionKind
  label: string
  value?: string
  riskLevel?: ChannelRiskLevel
}

export interface ChannelBlock {
  id?: string
  kind: "section" | "context" | "actions" | "divider" | "input" | "custom"
  text?: string
  fields?: Record<string, string>
  actions?: ChannelAction[]
  data?: JsonValue
}

export interface OutboundMessage {
  channelId: ChannelId
  provider: ChannelProviderId
  connectionId: ChannelConnectionId
  target: ChannelTarget
  deliveryMode: OutboundDeliveryMode
  text?: string
  blocks?: ChannelBlock[]
  attachments?: ChannelAttachment[]
  actions?: ChannelAction[]
  threadPolicy: OutboundThreadPolicy
  chunkPolicy: OutboundChunkPolicy
  priority: OutboundPriority
  idempotencyKey: string
  redactionPolicy: OutboundRedactionPolicy
}

export type DeliveryReceiptStatus =
  | "accepted"
  | "sent"
  | "delivered"
  | "failed"
  | "partial"
  | "rate_limited"
  | "blocked_by_policy"
  | "unsupported_capability"

export interface DeliveryReceiptPart {
  status: DeliveryReceiptStatus
  messageId?: string
  attachmentId?: string
  errorCode?: string
  errorMessage?: string
}

export interface DeliveryReceipt {
  channelId: ChannelId
  provider: ChannelProviderId
  connectionId: ChannelConnectionId
  target: ChannelTarget
  status: DeliveryReceiptStatus
  timestamp: number
  idempotencyKey: string
  messageId?: string
  threadId?: string
  providerResponseRef?: RawPayloadRef
  parts?: DeliveryReceiptPart[]
  capability?: keyof ChannelCapabilities | string
  retryAfterMs?: number
  errorCode?: string
  errorMessage?: string
}

export type InteractionKind = "approval" | "cancel" | "retry" | "choose_option" | "provide_input"
export type ApprovalInteractionDecision = "allow_once" | "allow_run" | "deny"

export interface InteractionEnvelope {
  channelId: ChannelId
  provider: ChannelProviderId
  connectionId: ChannelConnectionId
  interactionId: string
  kind: InteractionKind
  sender: ChannelIdentity
  timestamp: number
  rawPayloadRef: RawPayloadRef
  messageId?: string
  threadId?: string
  room?: ChannelRoom
  workspace?: ChannelWorkspace
  actionId?: string
  value?: string
  text?: string
  approvalDecision?: ApprovalInteractionDecision
  correlationId?: string
}

export interface ChannelRateLimitPolicy {
  strategy: "provider_default" | "fixed_window" | "token_bucket" | "manual"
  messagesPerMinute?: number
  burst?: number
  retryAfterHintMs?: number
}

export interface ChannelDeliveryStateCapabilities {
  supportsAccepted: boolean
  supportsSent: boolean
  supportsDelivered: boolean
  supportsReadReceipt: boolean
}

export interface ChannelCapabilities {
  provider: ChannelProviderId
  connectionKind: ChannelConnectionKind
  supportsThreads: boolean
  supportsReplies: boolean
  supportsEdits: boolean
  supportsDeletes: boolean
  supportsReactions: boolean
  supportsButtons: boolean
  supportsModals: boolean
  supportsFiles: boolean
  supportsImages: boolean
  supportsTypingIndicator: boolean
  maxMessageLength: number
  maxAttachmentSizeBytes?: number
  rateLimitPolicy: ChannelRateLimitPolicy
  requiresWebhook: boolean
  requiresLocalBridge: boolean
  requiresUserSession: boolean
  manualConfirmationRequired?: boolean
  riskLevel: ChannelRiskLevel
  deliveryStates: ChannelDeliveryStateCapabilities
}

export type ChannelHealthStatus = "healthy" | "degraded" | "stopped" | "failed"

export interface ChannelHealthCheck {
  status: ChannelHealthStatus
  checkedAt: number
  message?: string
  detail?: JsonValue
}

export interface ChannelTypingIndicator {
  target: ChannelTarget
  active: boolean
  reason?: "processing" | "uploading" | "waiting_for_approval" | "idle"
}

export interface ChannelUploadOptions {
  idempotencyKey: string
  threadPolicy?: OutboundThreadPolicy
  redactionPolicy?: OutboundRedactionPolicy
}

export interface ChannelAdapter {
  readonly channelId: ChannelId
  readonly provider: ChannelProviderId
  readonly connectionId: ChannelConnectionId

  start(): Promise<void>
  stop(): Promise<void>
  healthCheck(): Promise<ChannelHealthCheck>
  getCapabilities(): ChannelCapabilities
  normalizeInbound(rawPayload: unknown): Promise<InboundEnvelope[]>
  sendMessage(message: OutboundMessage): Promise<DeliveryReceipt>

  normalizeInteraction?(rawPayload: unknown): Promise<InteractionEnvelope[]>
  sendTypingIndicator?(indicator: ChannelTypingIndicator): Promise<DeliveryReceipt>
  uploadAttachment?(
    target: ChannelTarget,
    attachment: ChannelAttachment,
    options: ChannelUploadOptions,
  ): Promise<DeliveryReceipt>
  handleInteraction?(interaction: InteractionEnvelope): Promise<DeliveryReceipt | void>
}

export interface ResolveDeliveryReceiptStatusInput {
  accepted?: boolean
  sent?: boolean
  delivered?: boolean
  failed?: boolean
  partial?: boolean
  rateLimited?: boolean
  blockedByPolicy?: boolean
  unsupportedCapability?: boolean
  providerSupportsDelivered?: boolean
}

export function defineChannelAdapter<T extends ChannelAdapter>(adapter: T): T {
  return adapter
}

export function defineChannelCapabilities<T extends ChannelCapabilities>(capabilities: T): T {
  return capabilities
}

const INTERNAL_CHANNEL_SURFACES = new Set<string>(["webui", "cli"])
const BUILT_IN_CHANNEL_PROVIDERS = new Set<string>([
  "telegram",
  "slack",
  "discord",
  "google_chat",
  "imessage",
  "kakaotalk",
])

export function isInternalChannelSurface(source: string): source is InternalChannelSurface {
  return INTERNAL_CHANNEL_SURFACES.has(source)
}

export function isBuiltInChannelProvider(source: string): source is BuiltInChannelProvider {
  return BUILT_IN_CHANNEL_PROVIDERS.has(source)
}

export function isExternalChannelProvider(source: string): source is ChannelProvider {
  return !isInternalChannelSurface(source)
}

export function resolveChannelSurface(source: string): ChannelSurface {
  return isInternalChannelSurface(source) ? source : "external_provider"
}

export function normalizeChannelSource(
  source: string | null | undefined,
  fallback: ChannelSource = "webui",
): ChannelSource {
  const trimmed = source?.trim()
  return trimmed ? (trimmed as ChannelSource) : fallback
}

export function resolveDeliveryReceiptStatus(
  input: ResolveDeliveryReceiptStatusInput,
): DeliveryReceiptStatus {
  if (input.unsupportedCapability) return "unsupported_capability"
  if (input.blockedByPolicy) return "blocked_by_policy"
  if (input.rateLimited) return "rate_limited"
  if (input.failed) return "failed"
  if (input.partial) return "partial"
  if (input.delivered) return input.providerSupportsDelivered === false ? "sent" : "delivered"
  if (input.sent) return "sent"
  return "accepted"
}

export function isPositiveDeliveryReceipt(receipt: DeliveryReceipt): boolean {
  return receipt.status === "accepted"
    || receipt.status === "sent"
    || receipt.status === "delivered"
    || receipt.status === "partial"
}

export function buildUnsupportedCapabilityReceipt(params: {
  channelId: ChannelId
  provider: ChannelProviderId
  connectionId: ChannelConnectionId
  target: ChannelTarget
  capability: keyof ChannelCapabilities | string
  idempotencyKey: string
  timestamp?: number
}): DeliveryReceipt {
  return {
    channelId: params.channelId,
    provider: params.provider,
    connectionId: params.connectionId,
    target: params.target,
    status: "unsupported_capability",
    timestamp: params.timestamp ?? Date.now(),
    idempotencyKey: params.idempotencyKey,
    capability: params.capability,
  }
}

export function createRawPayloadRef(input: {
  provider: ChannelProviderId
  ref?: string
  payload?: unknown
  createdAt?: number
}): RawPayloadRef {
  const createdAt = input.createdAt ?? Date.now()
  const ref = input.ref?.trim()
  if (ref) {
    return {
      storage: "external_ref",
      redactionState: "externalized",
      provider: input.provider,
      createdAt,
      ref,
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "payload")) {
    return {
      storage: "redacted_inline",
      redactionState: "redacted",
      provider: input.provider,
      createdAt,
      preview: sanitizeChannelContractValue(input.payload),
    }
  }

  return {
    storage: "none",
    redactionState: "not_stored",
    provider: input.provider,
    createdAt,
  }
}

const SECRET_KEY_PATTERN =
  /token|secret|authorization|cookie|api[_-]?key|password|credential|raw[_-]?(body|response)|bot[_-]?token/i
const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/xox[abpr]-[A-Za-z0-9-]+/gi, "xox*-redacted"],
  [/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[redacted-telegram-token]"],
]

export function sanitizeChannelContractValue(
  value: unknown,
  options: {
    maxDepth?: number
    maxArrayItems?: number
    maxObjectKeys?: number
    maxStringLength?: number
  } = {},
): JsonValue {
  const maxDepth = options.maxDepth ?? 6
  const maxArrayItems = options.maxArrayItems ?? 50
  const maxObjectKeys = options.maxObjectKeys ?? 80
  const maxStringLength = options.maxStringLength ?? 2_000

  function sanitizeNested(current: unknown, depth: number): JsonValue {
    if (depth > maxDepth) return "[truncated-depth]"
    if (current === null || current === undefined) return null
    if (typeof current === "string") return sanitizeString(current, maxStringLength)
    if (typeof current === "boolean") return current
    if (typeof current === "number") return Number.isFinite(current) ? current : String(current)
    if (typeof current === "bigint") return current.toString()
    if (typeof current === "symbol" || typeof current === "function") return `[${typeof current}]`
    if (Array.isArray(current)) {
      return current.slice(0, maxArrayItems).map((item) => sanitizeNested(item, depth + 1))
    }
    if (typeof current === "object") {
      const output: Record<string, JsonValue> = {}
      for (const [key, entryValue] of Object.entries(current).slice(0, maxObjectKeys)) {
        output[key] = SECRET_KEY_PATTERN.test(key)
          ? "[redacted]"
          : sanitizeNested(entryValue, depth + 1)
      }
      return output
    }
    return String(current)
  }

  return sanitizeNested(value, 0)
}

function sanitizeString(value: string, maxLength: number): string {
  const redacted = SECRET_TEXT_PATTERNS.reduce(
    (next, [pattern, replacement]) => next.replace(pattern, replacement),
    value,
  )
  if (redacted.length <= maxLength) return redacted
  return `${redacted.slice(0, maxLength)}...[truncated]`
}
