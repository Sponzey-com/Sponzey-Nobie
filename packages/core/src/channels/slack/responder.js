import { basename } from "node:path";
import { readFile } from "node:fs/promises";
function splitSlackText(text, maxLength = 3000) {
    const normalized = text.trim();
    if (!normalized)
        return [];
    if (normalized.length <= maxLength)
        return [normalized];
    const parts = [];
    let remaining = normalized;
    while (remaining.length > maxLength) {
        let splitIndex = remaining.lastIndexOf("\n", maxLength);
        if (splitIndex < Math.floor(maxLength * 0.5)) {
            splitIndex = remaining.lastIndexOf(" ", maxLength);
        }
        if (splitIndex < Math.floor(maxLength * 0.5)) {
            splitIndex = maxLength;
        }
        parts.push(remaining.slice(0, splitIndex).trim());
        remaining = remaining.slice(splitIndex).trim();
    }
    if (remaining)
        parts.push(remaining);
    return parts;
}
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
        const payload = await response.json();
        if (!response.ok || payload.ok !== true) {
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
        const sharedTs = complete.files?.[0]?.shares?.public
            ? Object.values(complete.files[0].shares.public)[0]?.[0]?.ts
            : undefined;
        return sharedTs ?? uploadInfo.file_id;
    }
}
//# sourceMappingURL=responder.js.map