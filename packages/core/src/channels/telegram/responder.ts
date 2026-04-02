import type { Bot } from "grammy"
import { sendTelegramFile, sendTelegramPlainMessage, sendTelegramTextParts } from "./message-delivery.js"

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

  async sendFinalResponse(text: string): Promise<number[]> {
    return sendTelegramTextParts({
      api: this.bot.api,
      target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
      text,
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
}
