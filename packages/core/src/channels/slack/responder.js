import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { SlackRateLimitError, buildSlackSentDeliveryReceipt, parseSlackRetryAfterMs, splitSlackText, } from "./message-delivery.js";
export class SlackResponder {
    config;
    channelId;
    threadTs;
    constructor(config, channelId, threadTs) {
        this.config = config;
        this.channelId = channelId;
        this.threadTs = threadTs;
    }
    async api(method, body) {
        const isForm = body instanceof URLSearchParams;
        const response = await fetch(`https://slack.com/api/${method}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.botToken}`,
                ...(isForm ? { "Content-Type": "application/x-www-form-urlencoded" } : { "Content-Type": "application/json" }),
            },
            body: isForm ? body.toString() : JSON.stringify(body),
        });
        if (response.status === 429) {
            throw new SlackRateLimitError({
                method,
                retryAfterMs: parseSlackRetryAfterMs(response.headers) ?? 60_000,
            });
        }
        const payload = await response.json();
        if (!response.ok || payload.ok !== true) {
            if (payload.error === "ratelimited") {
                throw new SlackRateLimitError({
                    method,
                    retryAfterMs: parseSlackRetryAfterMs(response.headers) ?? 60_000,
                    message: payload.response_metadata?.messages?.join(", ") || "Slack API rate limit exceeded.",
                });
            }
            const message = payload.error
                || payload.response_metadata?.messages?.join(", ")
                || `Slack API ${method} failed`;
            throw new Error(message);
        }
        return payload;
    }
    async sendToolStatus(toolName) {
        const response = await this.api("chat.postMessage", {
            channel: this.channelId,
            thread_ts: this.threadTs,
            text: `Running: ${toolName}...`,
        });
        return response.ts;
    }
    async updateToolStatus(messageId, toolName, success) {
        await this.api("chat.update", {
            channel: this.channelId,
            ts: messageId,
            text: `${success ? "Done" : "Failed"}: ${toolName}`,
        });
    }
    async clearToolStatus(messageId) {
        try {
            await this.api("chat.delete", {
                channel: this.channelId,
                ts: messageId,
            });
        }
        catch {
            // Message may have been deleted or no longer editable — ignore
        }
    }
    async sendFinalResponse(text) {
        const messageIds = [];
        for (const part of splitSlackText(text)) {
            const response = await this.api("chat.postMessage", {
                channel: this.channelId,
                thread_ts: this.threadTs,
                text: part,
            });
            messageIds.push(response.ts);
        }
        return messageIds;
    }
    async sendFinalResponseWithReceipts(text, idempotencyKeyPrefix) {
        const messageIds = [];
        const receipts = [];
        const parts = splitSlackText(text);
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index] ?? "";
            const response = await this.api("chat.postMessage", {
                channel: this.channelId,
                thread_ts: this.threadTs,
                text: part,
            });
            messageIds.push(response.ts);
            receipts.push(buildSlackSentDeliveryReceipt({
                target: { channelId: this.channelId, threadTs: this.threadTs },
                idempotencyKey: `${idempotencyKeyPrefix}:part:${index + 1}`,
                messageId: response.ts,
                providerResponse: response,
            }));
        }
        return { messageIds, receipts };
    }
    async sendError(message) {
        const response = await this.api("chat.postMessage", {
            channel: this.channelId,
            thread_ts: this.threadTs,
            text: `Error: ${message}`,
        });
        return response.ts;
    }
    async sendReceipt(text) {
        const response = await this.api("chat.postMessage", {
            channel: this.channelId,
            thread_ts: this.threadTs,
            text,
        });
        return response.ts;
    }
    async sendApprovalRequest(runId, text) {
        const fallbackText = [
            "승인 대기 중입니다.",
            "바로 아래 버튼으로 승인하거나, 버튼이 보이지 않으면 이 스레드에 `approve`, `approve once`, `deny` 중 하나로 답해주세요.",
        ].join("\n");
        await this.api("chat.postMessage", {
            channel: this.channelId,
            thread_ts: this.threadTs,
            text: fallbackText,
        });
        const blocks = [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text,
                },
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: "전체 승인" },
                        action_id: "approval_allow_run",
                        value: runId,
                        style: "primary",
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "이번 단계만" },
                        action_id: "approval_allow_once",
                        value: runId,
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "거부" },
                        action_id: "approval_deny",
                        value: runId,
                        style: "danger",
                    },
                ],
            },
        ];
        const response = await this.api("chat.postMessage", {
            channel: this.channelId,
            thread_ts: this.threadTs,
            text: `승인 요청: ${text}`,
            blocks,
        });
        return response.ts;
    }
    async sendFile(filePath, caption) {
        const result = await this.sendFileWithReceipt(filePath, `slack:file:${this.channelId}:${this.threadTs}:${filePath}`, caption);
        return result.messageId;
    }
    async sendFileWithReceipt(filePath, idempotencyKey, caption) {
        const data = await readFile(filePath);
        const fileName = basename(filePath);
        const uploadInfo = await this.api("files.getUploadURLExternal", new URLSearchParams({
            filename: fileName,
            length: String(data.byteLength),
        }));
        const uploadResponse = await fetch(uploadInfo.upload_url, {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
            },
            body: data,
        });
        if (!uploadResponse.ok) {
            throw new Error(`Slack file upload failed: HTTP ${uploadResponse.status}`);
        }
        const complete = await this.api("files.completeUploadExternal", new URLSearchParams({
            files: JSON.stringify([{ id: uploadInfo.file_id, title: fileName }]),
            channel_id: this.channelId,
            thread_ts: this.threadTs,
            ...(caption ? { initial_comment: caption } : {}),
        }));
        const file = complete.files?.[0];
        const publicTs = file?.shares?.public ? Object.values(file.shares.public)[0]?.[0]?.ts : undefined;
        const privateTs = file?.shares?.private ? Object.values(file.shares.private)[0]?.[0]?.ts : undefined;
        const messageId = publicTs ?? privateTs ?? uploadInfo.file_id;
        return {
            messageId,
            fileId: uploadInfo.file_id,
            ...(file?.permalink ? { permalink: file.permalink } : {}),
            receipt: buildSlackSentDeliveryReceipt({
                target: { channelId: this.channelId, threadTs: this.threadTs },
                idempotencyKey,
                messageId,
                fileId: uploadInfo.file_id,
                providerResponse: {
                    uploadInfo,
                    complete,
                },
            }),
        };
    }
}
//# sourceMappingURL=responder.js.map