import type { Bot } from "grammy"
import {
  sendTelegramFile,
  sendTelegramFileWithReceipt,
  sendTelegramPlainMessage,
  sendTelegramTextParts,
  sendTelegramTextPartsWithReceipts,
  type TelegramFileDeliveryResult,
  type TelegramTextPartsDeliveryResult,
} from "./message-delivery.js"

export class TelegramResponder {
  constructor(
    private bot: Bot,
    private chatId: number,
    private threadId?: number | undefined,
  ) {}

  async sendToolStatus(toolName: string): Promise<number> {
    const text = `⚙️ Running: \`${toolName}\`...`
    const other =
      this.threadId !== undefined
        ? { parse_mode: "Markdown" as const, message_thread_id: this.threadId }
        : { parse_mode: "Markdown" as const }
    const msg = await this.bot.api.sendMessage(this.chatId, text, other)
    return msg.message_id
  }

  async updateToolStatus(messageId: number, toolName: string, success: boolean): Promise<void> {
    const icon = success ? "✅" : "❌"
    const text = `${icon} \`${toolName}\` ${success ? "done" : "failed"}`
    try {
      await this.bot.api.editMessageText(this.chatId, messageId, text, {
        parse_mode: "Markdown",
      })
    } catch {
      // Message may have been deleted or too old — ignore
    }
  }

  async clearToolStatus(messageId: number): Promise<void> {
    try {
      await this.bot.api.deleteMessage(this.chatId, messageId)
    } catch {
      // Message may have been deleted or too old — ignore
    }
  }

  async sendFinalResponse(text: string): Promise<number[]> {
    return sendTelegramTextParts({
      api: this.bot.api,
      target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
      text,
    })
  }

  async sendFinalResponseWithReceipts(
    text: string,
    idempotencyKeyPrefix: string,
  ): Promise<TelegramTextPartsDeliveryResult> {
    return sendTelegramTextPartsWithReceipts({
      api: this.bot.api,
      target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
      text,
      idempotencyKeyPrefix,
    })
  }

  async sendError(message: string): Promise<number> {
    return sendTelegramPlainMessage({
      api: this.bot.api,
      target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
      text: `❌ Error: ${message}`,
    })
  }

  async sendReceipt(text: string): Promise<number> {
    return sendTelegramPlainMessage({
      api: this.bot.api,
      target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
      text,
    })
  }

  async sendFile(filePath: string, caption?: string | undefined): Promise<number> {
    return sendTelegramFile({
      api: this.bot.api,
      target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
      filePath,
      ...(caption !== undefined ? { caption } : {}),
    })
  }

  async sendFileWithReceipt(
    filePath: string,
    idempotencyKey: string,
    caption?: string | undefined,
  ): Promise<TelegramFileDeliveryResult> {
    return sendTelegramFileWithReceipt({
      api: this.bot.api,
      target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
      filePath,
      idempotencyKey,
      ...(caption !== undefined ? { caption } : {}),
    })
  }
}
