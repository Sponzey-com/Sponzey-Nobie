import type { Bot } from "grammy"
import { InputFile } from "grammy"
import { splitMessage } from "./markdown.js"

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
    const sentMessageIds: number[] = []
    const parts = splitMessage(text)
    const other =
      this.threadId !== undefined
        ? { message_thread_id: this.threadId }
        : {}
    for (const part of parts) {
      const msg = await this.bot.api.sendMessage(this.chatId, part, other)
      sentMessageIds.push(msg.message_id)
    }
    return sentMessageIds
  }

  async sendError(message: string): Promise<number> {
    const text = `❌ Error: ${message}`
    const other =
      this.threadId !== undefined
        ? { message_thread_id: this.threadId }
        : {}
    const msg = await this.bot.api.sendMessage(this.chatId, text, other)
    return msg.message_id
  }

  async sendFile(filePath: string, caption?: string | undefined): Promise<number> {
    const other =
      this.threadId !== undefined
        ? (caption !== undefined
            ? { message_thread_id: this.threadId, caption }
            : { message_thread_id: this.threadId })
        : (caption !== undefined ? { caption } : {})

    const msg = await this.bot.api.sendDocument(this.chatId, new InputFile(filePath), other)
    return msg.message_id
  }
}
