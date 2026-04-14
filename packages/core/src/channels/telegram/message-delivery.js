import { InputFile } from "grammy";
import { splitMessage } from "./markdown.js";
function buildThreadOptions(threadId) {
    return threadId !== undefined ? { message_thread_id: threadId } : {};
}
export async function sendTelegramTextParts(params) {
    const sentMessageIds = [];
    const parts = splitMessage(params.text);
    const other = buildThreadOptions(params.target.threadId);
    for (const part of parts) {
        const message = await params.api.sendMessage(params.target.chatId, part, other);
        sentMessageIds.push(message.message_id);
    }
    return sentMessageIds;
}
export async function sendTelegramPlainMessage(params) {
    const message = await params.api.sendMessage(params.target.chatId, params.text, buildThreadOptions(params.target.threadId));
    return message.message_id;
}
export async function sendTelegramFile(params) {
    const baseOptions = buildThreadOptions(params.target.threadId);
    const options = params.caption !== undefined ? { ...baseOptions, caption: params.caption } : baseOptions;
    const message = await params.api.sendDocument(params.target.chatId, new InputFile(params.filePath), options);
    return message.message_id;
}
//# sourceMappingURL=message-delivery.js.map