import { InputFile } from "grammy";
import { splitMessage } from "./markdown.js";
export class TelegramResponder {
    bot;
    chatId;
    threadId;
    constructor(bot, chatId, threadId) {
        this.bot = bot;
        this.chatId = chatId;
        this.threadId = threadId;
    }
    async sendToolStatus(toolName) {
        const text = `⚙️ Running: \`${toolName}\`...`;
        const other = this.threadId !== undefined
            ? { parse_mode: "Markdown", message_thread_id: this.threadId }
            : { parse_mode: "Markdown" };
        const msg = await this.bot.api.sendMessage(this.chatId, text, other);
        return msg.message_id;
    }
    async updateToolStatus(messageId, toolName, success) {
        const icon = success ? "✅" : "❌";
        const text = `${icon} \`${toolName}\` ${success ? "done" : "failed"}`;
        try {
            await this.bot.api.editMessageText(this.chatId, messageId, text, {
                parse_mode: "Markdown",
            });
        }
        catch {
            // Message may have been deleted or too old — ignore
        }
    }
    async sendFinalResponse(text) {
        const parts = splitMessage(text);
        const other = this.threadId !== undefined
            ? { message_thread_id: this.threadId }
            : {};
        for (const part of parts) {
            await this.bot.api.sendMessage(this.chatId, part, other);
        }
    }
    async sendError(message) {
        const text = `❌ Error: ${message}`;
        const other = this.threadId !== undefined
            ? { message_thread_id: this.threadId }
            : {};
        await this.bot.api.sendMessage(this.chatId, text, other);
    }
    async sendFile(filePath, caption) {
        const other = this.threadId !== undefined
            ? (caption !== undefined
                ? { message_thread_id: this.threadId, caption }
                : { message_thread_id: this.threadId })
            : (caption !== undefined ? { caption } : {});
        await this.bot.api.sendDocument(this.chatId, new InputFile(filePath), other);
    }
}
//# sourceMappingURL=responder.js.map