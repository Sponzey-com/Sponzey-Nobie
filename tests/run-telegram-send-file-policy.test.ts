import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { telegramSendFileTool } from "../packages/core/src/tools/builtin/telegram-send.ts"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const tempDirs: string[] = []

function createToolContext(userMessage: string): ToolContext {
  return {
    sessionId: "session-1",
    runId: "run-1",
    workDir: process.cwd(),
    userMessage,
    source: "telegram",
    allowWebAccess: false,
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  }
}

function createTempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-nobie-telegram-file-"))
  tempDirs.push(dir)
  const filePath = join(dir, name)
  writeFileSync(filePath, contents)
  return filePath
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("telegram send file policy", () => {
  it("rejects document-like attachments for simple status requests", async () => {
    const filePath = createTempFile("monitor-status.txt", "display count: 2")

    const result = await telegramSendFileTool.execute(
      { filePath, caption: "모니터 연결 현황" },
      createToolContext("지금 모니터 몇 개 연결됐는지 확인해줘"),
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe("DOCUMENT_ATTACHMENT_NOT_REQUESTED")
    expect(result.output).toContain("일반 메시지")
  })

  it("allows document-like attachments when the user explicitly asks for a file", async () => {
    const filePath = createTempFile("monitor-status.txt", "display count: 2")

    const result = await telegramSendFileTool.execute(
      { filePath, caption: "모니터 연결 현황" },
      createToolContext("현재 모니터 연결 현황을 txt 파일로 첨부해서 보내줘"),
    )

    expect(result.success).toBe(true)
    expect(result.details).toMatchObject({
      kind: "artifact_delivery",
      channel: "telegram",
      filePath,
    })
  })

  it("allows image artifacts without an explicit file request", async () => {
    const filePath = createTempFile("main-display.png", "png-binary")

    const result = await telegramSendFileTool.execute(
      { filePath, caption: "메인 화면 캡처" },
      createToolContext("지금 메인 화면 캡처해줘"),
    )

    expect(result.success).toBe(true)
    expect(result.details).toMatchObject({
      kind: "artifact_delivery",
      channel: "telegram",
      filePath,
    })
  })
})
