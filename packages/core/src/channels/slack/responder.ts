import { basename } from "node:path"
import { readFile } from "node:fs/promises"
import type { SlackConfig } from "../../config/types.js"

interface SlackApiEnvelope<T = Record<string, unknown>> {
  ok: boolean
  error?: string
  ts?: string
  upload_url?: string
  file_id?: string
  response_metadata?: {
    messages?: string[]
  }
  team?: {
    name?: string
  }
  [key: string]: unknown
}

interface SlackBlockText {
  type: "mrkdwn" | "plain_text"
  text: string
}

interface SlackBlockElement {
  type: "button"
  text: SlackBlockText
  action_id: string
  value: string
  style?: "primary" | "danger"
}

interface SlackBlock {
  type: "section" | "actions"
  text?: SlackBlockText
  elements?: SlackBlockElement[]
}

function splitSlackText(text: string, maxLength = 3000): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  if (normalized.length <= maxLength) return [normalized]

  const parts: string[] = []
  let remaining = normalized
  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength)
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = remaining.lastIndexOf(" ", maxLength)
    }
    if (splitIndex < Math.floor(maxLength * 0.5)) {
      splitIndex = maxLength
    }
    parts.push(remaining.slice(0, splitIndex).trim())
    remaining = remaining.slice(splitIndex).trim()
  }
  if (remaining) parts.push(remaining)
  return parts
}

export class SlackResponder {
  constructor(
    private config: SlackConfig,
    private channelId: string,
    private threadTs: string,
  ) {}

  private async api<T extends SlackApiEnvelope = SlackApiEnvelope>(
    method: string,
    body: URLSearchParams | Record<string, unknown>,
  ): Promise<T> {
    const isForm = body instanceof URLSearchParams
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
        ...(isForm ? { "Content-Type": "application/x-www-form-urlencoded" } : { "Content-Type": "application/json" }),
      },
      body: isForm ? body.toString() : JSON.stringify(body),
    })

    const payload = await response.json() as T
    if (!response.ok || payload.ok !== true) {
      const message =
        payload.error
        || payload.response_metadata?.messages?.join(", ")
        || `Slack API ${method} failed`
      throw new Error(message)
    }
    return payload
  }

  async sendToolStatus(toolName: string): Promise<string> {
    const response = await this.api<{ ok: boolean; ts: string }>("chat.postMessage", {
      channel: this.channelId,
      thread_ts: this.threadTs,
      text: `Running: ${toolName}...`,
    })
    return response.ts
  }

  async updateToolStatus(messageId: string, toolName: string, success: boolean): Promise<void> {
    await this.api("chat.update", {
      channel: this.channelId,
      ts: messageId,
      text: `${success ? "Done" : "Failed"}: ${toolName}`,
    })
  }

  async sendFinalResponse(text: string): Promise<string[]> {
    const messageIds: string[] = []
    for (const part of splitSlackText(text)) {
      const response = await this.api<{ ok: boolean; ts: string }>("chat.postMessage", {
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: part,
      })
      messageIds.push(response.ts)
    }
    return messageIds
  }

  async sendError(message: string): Promise<string> {
    const response = await this.api<{ ok: boolean; ts: string }>("chat.postMessage", {
      channel: this.channelId,
      thread_ts: this.threadTs,
      text: `Error: ${message}`,
    })
    return response.ts
  }

  async sendReceipt(text: string): Promise<string> {
    const response = await this.api<{ ok: boolean; ts: string }>("chat.postMessage", {
      channel: this.channelId,
      thread_ts: this.threadTs,
      text,
    })
    return response.ts
  }

  async sendApprovalRequest(runId: string, text: string): Promise<string> {
    const fallbackText = [
      "승인 대기 중입니다.",
      "바로 아래 버튼으로 승인하거나, 버튼이 보이지 않으면 이 스레드에 `approve`, `approve once`, `deny` 중 하나로 답해주세요.",
    ].join("\n")

    await this.api<{ ok: boolean; ts: string }>("chat.postMessage", {
      channel: this.channelId,
      thread_ts: this.threadTs,
      text: fallbackText,
    })

    const blocks: SlackBlock[] = [
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
    ]

    const response = await this.api<{ ok: boolean; ts: string }>("chat.postMessage", {
      channel: this.channelId,
      thread_ts: this.threadTs,
      text: `승인 요청: ${text}`,
      blocks,
    })
    return response.ts
  }

  async sendFile(filePath: string, caption?: string): Promise<string> {
    const data = await readFile(filePath)
    const fileName = basename(filePath)
    const uploadInfo = await this.api<{ ok: boolean; upload_url: string; file_id: string }>(
      "files.getUploadURLExternal",
      new URLSearchParams({
        filename: fileName,
        length: String(data.byteLength),
      }),
    )

    const uploadResponse = await fetch(uploadInfo.upload_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: data,
    })
    if (!uploadResponse.ok) {
      throw new Error(`Slack file upload failed: HTTP ${uploadResponse.status}`)
    }

    const complete = await this.api<{ ok: boolean; files?: Array<{ id?: string; shares?: { public?: Record<string, Array<{ ts?: string }>> } }> }>(
      "files.completeUploadExternal",
      new URLSearchParams({
        files: JSON.stringify([{ id: uploadInfo.file_id, title: fileName }]),
        channel_id: this.channelId,
        thread_ts: this.threadTs,
        ...(caption ? { initial_comment: caption } : {}),
      }),
    )

    const sharedTs = complete.files?.[0]?.shares?.public
      ? Object.values(complete.files[0].shares.public)[0]?.[0]?.ts
      : undefined
    return sharedTs ?? uploadInfo.file_id
  }
}
