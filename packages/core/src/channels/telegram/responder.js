import { sendTelegramFile, sendTelegramPlainMessage, sendTelegramTextParts } from "./message-delivery.js";
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
        return sendTelegramTextParts({
            api: this.bot.api,
            target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
            text,
        });
    }
    async sendError(message) {
        return sendTelegramPlainMessage({
            api: this.bot.api,
            target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
            text: `❌ Error: ${message}`,
        });
    }
    async sendReceipt(text) {
        return sendTelegramPlainMessage({
            api: this.bot.api,
            target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
            text,
        });
    }
    async sendFile(filePath, caption) {
        return sendTelegramFile({
            api: this.bot.api,
            target: { chatId: this.chatId, ...(this.threadId !== undefined ? { threadId: this.threadId } : {}) },
            filePath,
            ...(caption !== undefined ? { caption } : {}),
        });
    }
}
//# sourceMappingURL=responder.js.map