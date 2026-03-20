import { Bot } from "grammy"
import { InputFile } from "grammy"
import type { TelegramConfig } from "../../config/types.js"
import { eventBus } from "../../events/index.js"
import { createLogger } from "../../logger/index.js"
import { cancelRootRun } from "../../runs/store.js"
import { startRootRun } from "../../runs/start.js"
import { isAllowedUser } from "./auth.js"
import { resolveSessionKey, getOrCreateTelegramSession, newSession } from "./session.js"
import { TypingIndicator } from "./typing.js"
import { TelegramResponder } from "./responder.js"
import { FileHandler } from "./file-handler.js"
import { registerCommands } from "./commands.js"
import { registerApprovalHandler, setActiveChatForSession, clearActiveChatForSession } from "./approval-handler.js"

const log = createLogger("channel:telegram")

export interface SessionStatus {
  sessionId: string | undefined
  runId: string | undefined
  running: boolean
}

export class TelegramChannel {
  private bot: Bot
  private runningRuns = new Map<string, string>()
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
    const runId = this.runningRuns.get(sessionKey)
    if (runId) {
      cancelRootRun(runId)
      this.runningRuns.delete(sessionKey)
    }
    const sessionId = newSession(sessionKey)
    this.sessionIds.set(sessionKey, sessionId)
  }

  abortSession(sessionKey: string): boolean {
    const runId = this.runningRuns.get(sessionKey)
    if (runId === undefined) return false
    const cancelled = cancelRootRun(runId)
    this.runningRuns.delete(sessionKey)
    return cancelled !== undefined
  }

  getRunningCount(): number {
    return this.runningRuns.size
  }

  getSessionStatus(sessionKey: string): SessionStatus {
    return {
      sessionId: this.sessionIds.get(sessionKey),
      runId: this.runningRuns.get(sessionKey),
      running: this.runningRuns.has(sessionKey),
    }
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

      if (!isAllowedUser(userId, chatType, chatId, this.config)) {
        log.warn(`Rejected user=${userId} chat=${chatId} type=${chatType}`)
        return
      }

      const sessionKey = resolveSessionKey(chatId, threadId)

      if (this.runningRuns.has(sessionKey)) {
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
      const toolMessageIds = new Map<string, number>()

      try {
        const started = startRootRun({
          message: text,
          sessionId,
          model: undefined,
          source: "telegram",
          onChunk: async (chunk) => {
            if (chunk.type === "text") {
              bufferedText += chunk.delta
            } else if (chunk.type === "tool_start") {
              const msgId = await responder.sendToolStatus(chunk.toolName)
              toolMessageIds.set(chunk.toolName, msgId)
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
                    await this.bot.api.sendDocument(
                      chatId,
                      new InputFile(filePath),
                      caption !== undefined
                        ? (threadId !== undefined
                            ? { caption, message_thread_id: threadId }
                            : { caption })
                        : (threadId !== undefined
                            ? { message_thread_id: threadId }
                            : {}),
                    )
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err)
                    log.error(`Failed to send file: ${msg}`)
                  }
                }
              }
            } else if (chunk.type === "done") {
              if (bufferedText) {
                await responder.sendFinalResponse(bufferedText)
                bufferedText = ""
              }
            } else if (chunk.type === "error") {
              await responder.sendError(chunk.message)
              bufferedText = ""
            }
          },
        })

        this.runningRuns.set(sessionKey, started.runId)
        await started.finished
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error(`Error handling message: ${message}`)
        await responder.sendError(message).catch(() => undefined)
      } finally {
        typing.stop()
        this.runningRuns.delete(sessionKey)
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
}
