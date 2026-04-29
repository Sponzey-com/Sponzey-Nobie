import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SlackResponder } from "../packages/core/src/channels/slack/responder.ts"
import type { SlackConfig } from "../packages/core/src/config/types.ts"

const slackConfig: SlackConfig = {
  enabled: true,
  botToken: "xoxb-slack-secret-token",
  appToken: "xapp-slack-secret-token",
  allowedUserIds: [],
  allowedChannelIds: [],
}

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("Slack responder delivery receipts", () => {
  it("returns file upload delivery receipt with Slack file permalink", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nobie-slack-responder-"))
    tempDirs.push(tempDir)
    const filePath = join(tempDir, "report.txt")
    writeFileSync(filePath, "hello")

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const urlText = String(url)
      if (urlText.endsWith("/files.getUploadURLExternal")) {
        return new Response(JSON.stringify({
          ok: true,
          upload_url: "https://upload.slack.test/file",
          file_id: "F123",
        }))
      }
      if (urlText === "https://upload.slack.test/file") {
        return new Response("", { status: 200 })
      }
      if (urlText.endsWith("/files.completeUploadExternal")) {
        return new Response(JSON.stringify({
          ok: true,
          files: [{
            id: "F123",
            permalink: "https://slack.com/files/F123",
            shares: {
              private: {
                C_SLACK: [{ ts: "1710000100.000900" }],
              },
            },
          }],
        }))
      }
      return new Response(JSON.stringify({ ok: false, error: "unexpected_method" }), { status: 500 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const responder = new SlackResponder(slackConfig, "C_SLACK", "thread-1")
    const result = await responder.sendFileWithReceipt(filePath, "slack:file:fixture", "결과 파일")

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      messageId: "1710000100.000900",
      fileId: "F123",
      permalink: "https://slack.com/files/F123",
      receipt: {
        provider: "slack",
        status: "sent",
        messageId: "1710000100.000900",
        threadId: "thread-1",
        idempotencyKey: "slack:file:fixture",
        parts: [{ status: "sent", attachmentId: "F123" }],
      },
    })
  })

  it("throws SlackRateLimitError with retry-after backoff", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
        status: 429,
        headers: { "retry-after": "2" },
      }),
    ))

    const responder = new SlackResponder(slackConfig, "C_SLACK", "thread-1")

    await expect(responder.sendFinalResponseWithReceipts("hello", "slack:final:fixture"))
      .rejects
      .toMatchObject({
        name: "SlackRateLimitError",
        retryAfterMs: 2_000,
        method: "chat.postMessage",
      })
  })
})
