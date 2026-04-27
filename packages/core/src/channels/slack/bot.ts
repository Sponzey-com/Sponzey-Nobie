import type { SlackConfig } from "../../config/types.js"
import { eventBus } from "../../events/index.js"
import { createLogger } from "../../logger/index.js"
import { cancelRootRun, getRootRun } from "../../runs/store.js"
import { startIngressRun } from "../../runs/ingress.js"
import { createInboundMessageRecord } from "../../runs/request-isolation.js"
import { recordMessageLedgerEvent } from "../../runs/message-ledger.js"
import { findChannelMessageRef, findLatestChannelMessageRefForThread, insertChannelMessageRef } from "../../db/index.js"
import { createSlackChunkDeliveryHandler } from "./chunk-delivery.js"
import { clearActiveSlackConversationForSession, handleSlackApprovalAction, handleSlackApprovalMessage, registerSlackApprovalHandler, setActiveSlackConversationForSession } from "./approval-handler.js"
import { SlackResponder } from "./responder.js"
import { getOrCreateSlackSession, newSlackSession, resolveSlackSessionKey } from "./session.js"

const log = createLogger("channel:slack")

export function findSlackReplyTaskRef(params: {
  channelId: string
  messageTs: string
  threadTs: string
}) {
  const exactMessageRef = findChannelMessageRef({
    source: "slack",
    externalChatId: params.channelId,
    externalMessageId: params.messageTs,
    externalThreadId: params.threadTs,
  })
  if (exactMessageRef) return exactMessageRef

  if (params.threadTs === params.messageTs) return undefined

  const threadRootRef = findChannelMessageRef({
    source: "slack",
    externalChatId: params.channelId,
    externalMessageId: params.threadTs,
    externalThreadId: params.threadTs,
  })
  if (threadRootRef) return threadRootRef

  return findLatestChannelMessageRefForThread({
    source: "slack",
    externalChatId: params.channelId,
    externalThreadId: params.threadTs,
  })
}

interface SocketEnvelope {
  envelope_id?: string
  payload?: {
    event?: {
      type?: string
      subtype?: string
      user?: string
      text?: string
      channel?: string
      ts?: string
      thread_ts?: string
      bot_id?: string
    }
    type?: string
    user?: {
      id?: string
    }
    channel?: {
      id?: string
    }
    message?: {
      ts?: string
      thread_ts?: string
    }
    container?: {
      channel_id?: string
      message_ts?: string
      thread_ts?: string
    }
    actions?: Array<{
      action_id?: string
      value?: string
    }>
  }
  type?: string
}

interface WebSocketLike {
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void
}

export class SlackChannel {
  private socket: WebSocketLike | null = null
  private runningRuns = new Map<string, Set<string>>()
  private sessionIds = new Map<string, string>()
  private seenInboundEvents = new Map<string, number>()

  constructor(private config: SlackConfig) {}

  async start(): Promise<void> {
    log.info(
      `Starting Slack channel (Socket Mode, allowedUsers=${this.config.allowedUserIds.length || "all"}, allowedChannels=${this.config.allowedChannelIds.length || "all"})`,
    )

    registerSlackApprovalHandler({
      sendApprovalRequest: async ({ channelId, threadTs, runId, text }) => {
        const responder = new SlackResponder(this.config, channelId, threadTs)
        await responder.sendApprovalRequest(runId, text)
      },
    })

    const openResponse = await fetch("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.appToken}`,
      },
    })
    const openPayload = await openResponse.json() as { ok?: boolean; error?: string; url?: string }
    if (!openResponse.ok || openPayload.ok !== true || !openPayload.url) {
      throw new Error(openPayload.error ?? "Slack Socket Mode 연결 URL을 가져오지 못했습니다.")
    }

    const SocketCtor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => WebSocketLike }).WebSocket
    if (!SocketCtor) {
      throw new Error("이 환경에서는 WebSocket 런타임을 사용할 수 없습니다.")
    }

    this.socket = new SocketCtor(openPayload.url)
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Slack WebSocket 생성에 실패했습니다."))
        return
      }
      const timer = setTimeout(() => reject(new Error("Slack Socket Mode 연결 시간이 초과되었습니다.")), 15_000)
      this.socket.addEventListener("open", () => {
        clearTimeout(timer)
        log.info("Slack Socket Mode connected")
        eventBus.emit("channel.connected", { channel: "slack", detail: { transport: "socket_mode" } })
        resolve()
      })
      this.socket.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new Error("Slack Socket Mode 연결에 실패했습니다."))
      })
      this.socket.addEventListener("message", (event) => {
        void this.handleSocketMessage(String(event.data ?? "")).catch((error) => {
          log.error(`Slack message handling failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      })
    })
  }

  stop(): void {
    this.socket?.close()
    this.socket = null
  }

  private addSessionRun(sessionKey: string, runId: string): void {
    const existing = this.runningRuns.get(sessionKey)
    if (existing) {
      existing.add(runId)
      return
    }
    this.runningRuns.set(sessionKey, new Set([runId]))
  }

  private removeSessionRun(sessionKey: string, runId: string): boolean {
    const existing = this.runningRuns.get(sessionKey)
    if (!existing) return false
    existing.delete(runId)
    if (existing.size === 0) {
      this.runningRuns.delete(sessionKey)
      return false
    }
    return true
  }

  private isAllowedUser(userId: string): boolean {
    return this.config.allowedUserIds.length === 0 || this.config.allowedUserIds.includes(userId)
  }

  private isAllowedChannel(channelId: string): boolean {
    return this.config.allowedChannelIds.length === 0 || this.config.allowedChannelIds.includes(channelId)
  }

  private markInboundEventSeen(eventKey: string): boolean {
    const now = Date.now()
    const previous = this.seenInboundEvents.get(eventKey)

    for (const [key, seenAt] of this.seenInboundEvents.entries()) {
      if (now - seenAt > 60_000) this.seenInboundEvents.delete(key)
    }

    if (typeof previous === "number" && now - previous < 60_000) {
      return true
    }

    this.seenInboundEvents.set(eventKey, now)
    return false
  }

  private recordOutgoingMessageRef(params: {
    sessionId: string
    runId: string
    channelId: string
    threadTs: string
    messageId: string
    role: "assistant" | "tool"
  }): void {
    const run = getRootRun(params.runId)
    if (!run) return
    insertChannelMessageRef({
      source: "slack",
      session_id: params.sessionId,
      root_run_id: params.runId,
      request_group_id: run.requestGroupId,
      external_chat_id: params.channelId,
      external_thread_id: params.threadTs,
      external_message_id: params.messageId,
      role: params.role,
      created_at: Date.now(),
    })
  }

  private async handleSocketMessage(raw: string): Promise<void> {
    const envelope = JSON.parse(raw) as SocketEnvelope
    if (envelope.envelope_id && this.socket) {
      this.socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
    }

    if (envelope.payload?.type === "block_actions") {
      await this.handleBlockActions(envelope.payload)
      return
    }

    const event = envelope.payload?.event
    if (!event) return
    if (event.bot_id) return

    const eventType = event.type?.trim()
    if (eventType !== "message" && eventType !== "app_mention") {
      log.info(`Ignored Slack event type=${eventType ?? "unknown"}`)
      return
    }
    if (eventType === "message" && event.subtype) {
      log.info(`Ignored Slack message subtype=${event.subtype}`)
      return
    }

    const userId = event.user?.trim()
    const channelId = event.channel?.trim()
    const rawText = event.text?.trim() ?? ""
    const text = eventType === "app_mention"
      ? rawText.replace(/<@[^>]+>/g, "").trim()
      : rawText
    const messageTs = event.ts?.trim()
    const threadTs = (event.thread_ts?.trim() || messageTs || "").trim()

    if (!userId || !channelId || !text || !messageTs || !threadTs) return
    const inboundEventKey = `${channelId}:${messageTs}`
    if (this.markInboundEventSeen(inboundEventKey)) {
      log.info(`Ignored duplicate Slack inbound event channel=${channelId} ts=${messageTs} type=${eventType}`)
      return
    }
    if (!this.isAllowedUser(userId)) {
      log.warn(`Ignored Slack message from disallowed user=${userId} channel=${channelId}`)
      return
    }
    if (!this.isAllowedChannel(channelId)) {
      log.warn(`Ignored Slack message from disallowed channel=${channelId} user=${userId}`)
      return
    }

    log.info(`Accepted Slack message user=${userId} channel=${channelId} thread=${threadTs}`)

    const approvalHandled = await handleSlackApprovalMessage({
      channelId,
      threadTs,
      userId,
      text,
      reply: async (message) => {
        const responder = new SlackResponder(this.config, channelId, threadTs)
        await responder.sendReceipt(message)
      },
    })
    if (approvalHandled) return

    const sessionKey = resolveSlackSessionKey(channelId, threadTs)
    const sessionId = getOrCreateSlackSession(sessionKey)
    this.sessionIds.set(sessionKey, sessionId)

    eventBus.emit("message.inbound", {
      source: "slack",
      sessionId,
      content: text,
      userId,
    })

    setActiveSlackConversationForSession(sessionId, channelId, userId, threadTs)
    const responder = new SlackResponder(this.config, channelId, threadTs)

    let startedRunId = ""
    const repliedTaskRef = findSlackReplyTaskRef({ channelId, messageTs, threadTs })

    try {
      if (repliedTaskRef) {
        const cancelled = cancelRootRun(repliedTaskRef.root_run_id)
        if (cancelled) {
          log.info(`Reply override detected for Slack requestGroup=${repliedTaskRef.request_group_id}`)
        }
      }

      const onChunk = createSlackChunkDeliveryHandler({
        responder,
        sessionId,
        channelId,
        threadTs,
        getRunId: () => startedRunId || undefined,
        recordOutgoingMessageRef: (params) => this.recordOutgoingMessageRef(params),
        logError: (message) => log.error(message),
      })

      const { started, receipt } = startIngressRun({
        message: text,
        sessionId,
        ...(repliedTaskRef ? { requestGroupId: repliedTaskRef.request_group_id, forceRequestGroupReuse: true } : {}),
        model: undefined,
        source: "slack",
        inboundMessage: createInboundMessageRecord({
          source: "slack",
          sessionId,
          channelEventId: inboundEventKey,
          externalChatId: channelId,
          externalThreadId: threadTs,
          externalMessageId: messageTs,
          userId,
          rawText: text,
        }),
        onChunk,
      })

      startedRunId = started.runId
      this.addSessionRun(sessionKey, started.runId)

      if (receipt.text.trim()) {
        const receiptMessageId = await responder.sendReceipt(receipt.text)
        const startedRun = getRootRun(started.runId)
        recordMessageLedgerEvent({
          runId: started.runId,
          requestGroupId: startedRun?.requestGroupId ?? started.runId,
          sessionKey: sessionId,
          threadKey: sessionKey,
          channel: "slack",
          eventKind: "fast_receipt_sent",
          deliveryKey: `slack:receipt:${channelId}:${threadTs ?? "channel"}:${receiptMessageId}`,
          idempotencyKey: `slack:receipt:${started.runId}:${receiptMessageId}`,
          status: "sent",
          summary: "Slack 접수 메시지를 전송했습니다.",
          detail: {
            channelId,
            ...(threadTs ? { threadTs } : {}),
            messageId: receiptMessageId,
          },
        })
        this.recordOutgoingMessageRef({
          sessionId,
          runId: started.runId,
          channelId,
          threadTs,
          messageId: receiptMessageId,
          role: "assistant",
        })
      }

      void started.finished.finally(() => {
        const hasRemainingRuns = this.removeSessionRun(sessionKey, started.runId)
        if (!hasRemainingRuns) {
          clearActiveSlackConversationForSession(sessionId)
        }
      })
    } catch (error) {
      clearActiveSlackConversationForSession(sessionId)
      const message = error instanceof Error ? error.message : String(error)
      log.error(`Slack ingress failed: ${message}`)
      await responder.sendError(message)
    }
  }

  private async handleBlockActions(payload: NonNullable<SocketEnvelope["payload"]>): Promise<void> {
    const action = payload.actions?.[0]
    const actionId = action?.action_id?.trim()
    const runId = action?.value?.trim()
    const userId = payload.user?.id?.trim()
    const channelId = payload.channel?.id?.trim() || payload.container?.channel_id?.trim()
    const threadTs = payload.message?.thread_ts?.trim()
      || payload.container?.thread_ts?.trim()
      || payload.message?.ts?.trim()
      || payload.container?.message_ts?.trim()

    if (!actionId || !runId || !userId || !channelId || !threadTs) {
      log.warn("Ignored Slack block action with incomplete payload")
      return
    }

    const decision =
      actionId === "approval_allow_run"
        ? "allow_run"
        : actionId === "approval_allow_once"
          ? "allow_once"
          : actionId === "approval_deny"
            ? "deny"
            : null

    if (!decision) {
      log.info(`Ignored Slack block action actionId=${actionId}`)
      return
    }

    const responder = new SlackResponder(this.config, channelId, threadTs)
    const handled = await handleSlackApprovalAction({
      runId,
      decision,
      channelId,
      threadTs,
      userId,
      reply: async (message) => {
        await responder.sendReceipt(message)
      },
    })

    if (!handled) {
      log.warn(`Ignored Slack approval action runId=${runId} user=${userId} channel=${channelId}`)
    }
  }
}
