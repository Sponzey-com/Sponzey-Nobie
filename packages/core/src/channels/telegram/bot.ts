import { Bot } from "grammy"
import type { TelegramConfig } from "../../config/types.js"
import { eventBus } from "../../events/index.js"
import { createLogger } from "../../logger/index.js"
import { cancelRootRun, getRootRun } from "../../runs/store.js"
import { startRootRun } from "../../runs/start.js"
import { isAllowedUser } from "./auth.js"
import { resolveSessionKey, getOrCreateTelegramSession, newSession, parseTelegramSessionKey } from "./session.js"
import { TypingIndicator } from "./typing.js"
import { TelegramResponder } from "./responder.js"
import { FileHandler } from "./file-handler.js"
import { registerCommands } from "./commands.js"
import { registerApprovalHandler, setActiveChatForSession, clearActiveChatForSession } from "./approval-handler.js"
import { findChannelMessageRef, getSession, insertChannelMessageRef } from "../../db/index.js"

const log = createLogger("channel:telegram")

export interface SessionStatus {
  sessionId: string | undefined
  runId: string | undefined
  running: boolean
}

export class TelegramChannel {
  private bot: Bot
  private runningRuns = new Map<string, Set<string>>()
  private sessionIds = new Map<string, string>()
  private fileHandler: FileHandler

  constructor(private config: TelegramConfig) {
    this.bot = new Bot(config.botToken)
    this.fileHandler = new FileHandler(this.bot)
    this._registerHandlers()
  }

  getSessionKey(chatId: number, threadId?: number | undefined): string {
    return resolveSessionKey(chatId, threadId)
  }

  newSession(sessionKey: string): void {
    const runIds = this.runningRuns.get(sessionKey)
    if (runIds) {
      for (const runId of runIds) {
        cancelRootRun(runId)
      }
      this.runningRuns.delete(sessionKey)
    }
    const sessionId = newSession(sessionKey)
    this.sessionIds.set(sessionKey, sessionId)
  }

  abortSession(sessionKey: string): boolean {
    const runIds = this.runningRuns.get(sessionKey)
    if (!runIds || runIds.size === 0) return false

    let cancelledAny = false
    for (const runId of runIds) {
      const cancelled = cancelRootRun(runId)
      cancelledAny = cancelledAny || cancelled !== undefined
    }
    this.runningRuns.delete(sessionKey)
    return cancelledAny
  }

  getRunningCount(): number {
    return [...this.runningRuns.values()].reduce((sum, runIds) => sum + runIds.size, 0)
  }

  getSessionStatus(sessionKey: string): SessionStatus {
    const runIds = this.runningRuns.get(sessionKey)
    const latestRunId = runIds ? [...runIds][runIds.size - 1] : undefined
    return {
      sessionId: this.sessionIds.get(sessionKey),
      runId: latestRunId,
      running: Boolean(runIds && runIds.size > 0),
    }
  }

  private addSessionRun(sessionKey: string, runId: string): void {
    const existing = this.runningRuns.get(sessionKey)
    if (existing) {
      existing.add(runId)
      return
    }
    this.runningRuns.set(sessionKey, new Set([runId]))
  }

  private removeSessionRun(sessionKey: string, runId: string): void {
    const existing = this.runningRuns.get(sessionKey)
    if (!existing) return
    existing.delete(runId)
    if (existing.size === 0) {
      this.runningRuns.delete(sessionKey)
    }
  }

  private recordOutgoingMessageRef(params: {
    sessionId: string
    runId: string
    chatId: number
    threadId?: number
    messageId: number
    role: "assistant" | "tool"
  }): void {
    const run = getRootRun(params.runId)
    if (!run) return
    insertChannelMessageRef({
      source: "telegram",
      session_id: params.sessionId,
      root_run_id: params.runId,
      request_group_id: run.requestGroupId,
      external_chat_id: String(params.chatId),
      external_thread_id: params.threadId != null ? String(params.threadId) : null,
      external_message_id: String(params.messageId),
      role: params.role,
      created_at: Date.now(),
    })
  }

  private _registerHandlers(): void {
    this.bot.on("message", async (ctx) => {
      const chat = ctx.chat
      const from = ctx.from
      const message = ctx.message

      if (!from) return

      const userId = from.id
      const chatId = chat.id
      const chatType = chat.type
      const threadId = message.message_thread_id
      const replyToMessageId = message.reply_to_message?.message_id

      if (!isAllowedUser(userId, chatType, chatId, this.config)) {
        log.warn(`Rejected user=${userId} chat=${chatId} type=${chatType}`)
        return
      }

      const sessionKey = resolveSessionKey(chatId, threadId)

      const activeSessionStatus = this.getSessionStatus(sessionKey)
      if (activeSessionStatus.running && replyToMessageId === undefined) {
        log.warn(`Session ${sessionKey} already running, ignoring message`)
        return
      }

      // Determine message text and handle file attachments
      let text = message.text ?? ""

      if (message.document !== undefined) {
        const doc = message.document
        const fileId = doc.file_id
        const filename = doc.file_name ?? `file_${Date.now()}`
        const sessionId = getOrCreateTelegramSession(sessionKey)

        try {
          const localPath = await this.fileHandler.downloadFile(fileId, sessionId, filename)
          const prefix = `[첨부파일: ${localPath}]\n`
          text = prefix + (message.caption ?? "")
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error(`Failed to download document: ${msg}`)
          await ctx.reply(`❌ 파일 다운로드 실패: ${msg}`)
          return
        }
      } else if (message.photo !== undefined && message.photo.length > 0) {
        // Pick largest photo (last element)
        const photos = message.photo
        let largest = photos[0]
        for (const photo of photos) {
          const photoSize = photo.file_size ?? 0
          const largestSize = largest?.file_size ?? 0
          if (largest === undefined || photoSize > largestSize) {
            largest = photo
          }
        }

        if (largest !== undefined) {
          const sessionId = getOrCreateTelegramSession(sessionKey)
          const filename = `photo_${Date.now()}.jpg`

          try {
            const localPath = await this.fileHandler.downloadFile(largest.file_id, sessionId, filename)
            const prefix = `[첨부파일: ${localPath}]\n`
            text = prefix + (message.caption ?? "")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            log.error(`Failed to download photo: ${msg}`)
            await ctx.reply(`❌ 사진 다운로드 실패: ${msg}`)
            return
          }
        }
      }

      if (!text.trim()) return

      const sessionId = getOrCreateTelegramSession(sessionKey)
      this.sessionIds.set(sessionKey, sessionId)

      eventBus.emit("message.inbound", {
        source: "telegram",
        sessionId,
        content: text,
        userId: String(userId),
      })

      // Set active chat for approval handler
      setActiveChatForSession(sessionId, chatId, userId, threadId)

      const responder = new TelegramResponder(this.bot, chatId, threadId)

      const typing = new TypingIndicator(async () => {
        await ctx.replyWithChatAction("typing")
      })
      typing.start()

      let bufferedText = ""
      let startedRunId = ""
      const toolMessageIds = new Map<string, number>()
      const repliedTaskRef = replyToMessageId !== undefined
        ? findChannelMessageRef({
            source: "telegram",
            externalChatId: String(chatId),
            externalMessageId: String(replyToMessageId),
            ...(threadId !== undefined ? { externalThreadId: String(threadId) } : {}),
          })
        : undefined

      try {
        if (repliedTaskRef) {
          const cancelled = cancelRootRun(repliedTaskRef.root_run_id)
          if (cancelled) {
            log.info(
              `Reply override detected for requestGroup=${repliedTaskRef.request_group_id}; previous active action cancelled before starting new reply run`,
            )
          }
        }

        const started = startRootRun({
          message: text,
          sessionId,
          ...(repliedTaskRef ? { requestGroupId: repliedTaskRef.request_group_id } : {}),
          model: undefined,
          source: "telegram",
          onChunk: async (chunk) => {
            if (chunk.type === "text") {
              bufferedText += chunk.delta
            } else if (chunk.type === "tool_start") {
              const msgId = await responder.sendToolStatus(chunk.toolName)
              toolMessageIds.set(chunk.toolName, msgId)
              if (startedRunId) {
                this.recordOutgoingMessageRef({
                  sessionId,
                  runId: startedRunId,
                  chatId,
                  ...(threadId !== undefined ? { threadId } : {}),
                  messageId: msgId,
                  role: "tool",
                })
              }
            } else if (chunk.type === "tool_end") {
              const msgId = toolMessageIds.get(chunk.toolName)
              if (msgId !== undefined) {
                await responder.updateToolStatus(msgId, chunk.toolName, chunk.success)
                toolMessageIds.delete(chunk.toolName)
              }

              if (chunk.output.startsWith("FILE_SEND:")) {
                const rest = chunk.output.slice("FILE_SEND:".length)
                const colonIdx = rest.indexOf(":")
                if (colonIdx !== -1) {
                  const filePath = rest.slice(0, colonIdx)
                  const caption = rest.slice(colonIdx + 1) || undefined
                  try {
                    const sentMessageId = await responder.sendFile(filePath, caption)
                    if (startedRunId) {
                      this.recordOutgoingMessageRef({
                        sessionId,
                        runId: startedRunId,
                        chatId,
                        ...(threadId !== undefined ? { threadId } : {}),
                        messageId: sentMessageId,
                        role: "assistant",
                      })
                    }
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err)
                    log.error(`Failed to send file: ${msg}`)
                  }
                }
              }
            } else if (chunk.type === "done") {
              if (bufferedText) {
                const sentMessageIds = await responder.sendFinalResponse(bufferedText)
                if (startedRunId) {
                  for (const messageId of sentMessageIds) {
                    this.recordOutgoingMessageRef({
                      sessionId,
                      runId: startedRunId,
                      chatId,
                      ...(threadId !== undefined ? { threadId } : {}),
                      messageId,
                      role: "assistant",
                    })
                  }
                }
                bufferedText = ""
              }
            } else if (chunk.type === "error") {
              const errorMessageId = await responder.sendError(chunk.message)
              if (startedRunId) {
                this.recordOutgoingMessageRef({
                  sessionId,
                  runId: startedRunId,
                  chatId,
                  ...(threadId !== undefined ? { threadId } : {}),
                  messageId: errorMessageId,
                  role: "assistant",
                })
              }
              bufferedText = ""
            }
          },
        })

        startedRunId = started.runId
        this.addSessionRun(sessionKey, started.runId)
        await started.finished
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error(`Error handling message: ${message}`)
        await responder.sendError(message).catch(() => undefined)
      } finally {
        typing.stop()
        if (startedRunId) {
          this.removeSessionRun(sessionKey, startedRunId)
        }
        clearActiveChatForSession(sessionId)
      }
    })

    registerCommands(this.bot, this)
    registerApprovalHandler(this.bot)

    this.bot.catch((err) => {
      log.error(`grammy error: ${err.message}`)
    })
  }

  async start(): Promise<void> {
    log.info("Starting Telegram bot (Long Polling)...")

    await this.bot.api.setMyCommands([
      { command: "start", description: "환영 메시지 및 사용법 보기" },
      { command: "new", description: "새 대화 세션 시작 (기록 초기화)" },
      { command: "cancel", description: "현재 실행 중인 작업 취소" },
      { command: "status", description: "세션 상태 확인" },
      { command: "help", description: "전체 명령어 설명" },
    ])

    await this.bot.start()
  }

  stop(): void {
    log.info("Stopping Telegram bot...")
    void this.bot.stop()
  }

  async sendTextToSession(sessionId: string, text: string): Promise<number[]> {
    const session = getSession(sessionId)
    if (!session || session.source !== "telegram" || !session.source_id) {
      throw new Error(`Telegram session ${sessionId} not found`)
    }

    const target = parseTelegramSessionKey(session.source_id)
    if (!target) {
      throw new Error(`Telegram session ${sessionId} has invalid source_id`)
    }

    const responder = new TelegramResponder(this.bot, target.chatId, target.threadId)
    return responder.sendFinalResponse(text)
  }
}
