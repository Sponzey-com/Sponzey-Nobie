import { describe, expect, it } from "vitest"
import { errorCorpus } from "./fixtures/errors/corpus.ts"
import { sanitizeUserFacingError } from "../packages/core/src/runs/error-sanitizer.ts"
import { buildRecoveryKey } from "../packages/core/src/runs/recovery.ts"

describe("error sanitizer corpus", () => {
  it.each(errorCorpus)("sanitizes $id without leaking raw details", (sample) => {
    const sanitized = sanitizeUserFacingError(sample.raw)

    expect(sanitized.kind).toBe(sample.expectedKind)
    expect(sanitized.userMessage).toContain(sample.expectedUserMessageIncludes)
    expect(sanitized.actionHint).toContain(sample.expectedActionHintIncludes)
    for (const forbidden of sample.forbiddenUserMessageSubstrings) {
      expect(sanitized.userMessage.toLowerCase()).not.toContain(forbidden.toLowerCase())
      expect((sanitized.actionHint ?? "").toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it("keeps recovery keys stable for raw variants of the same normalized error", () => {
    const first = buildRecoveryKey({
      action: "command_failure",
      toolName: "shell_exec",
      channel: "webui",
      targetId: "local",
      error: "command not found: screencapture",
    })
    const second = buildRecoveryKey({
      action: "command_failure",
      toolName: "shell_exec",
      channel: "webui",
      targetId: "local",
      error: "command not found: powershell-screencap",
    })

    expect(first).toBe(second)
  })

  it("keeps recovery keys separated by channel and target", () => {
    const slack = buildRecoveryKey({
      action: "delivery",
      toolName: "file_delivery",
      channel: "slack",
      targetId: "channel:C01",
      error: "Slack upload failed: files.upload returned channel_not_found",
    })
    const telegram = buildRecoveryKey({
      action: "delivery",
      toolName: "file_delivery",
      channel: "telegram",
      targetId: "chat:42120565",
      error: "telegram_send_file failed: chat not found",
    })
    const firstExtension = buildRecoveryKey({
      action: "execution_failure",
      toolName: "screen_capture",
      channel: "webui",
      targetId: "yeonjang-main",
      error: "screen_capture failed: os error 267: The directory name is invalid",
    })
    const secondExtension = buildRecoveryKey({
      action: "execution_failure",
      toolName: "screen_capture",
      channel: "webui",
      targetId: "yeonjang-windows",
      error: "screen_capture failed: os error 267: The directory name is invalid",
    })

    expect(slack).not.toBe(telegram)
    expect(firstExtension).not.toBe(secondExtension)
    expect(slack).toContain("channel=slack")
    expect(telegram).toContain("channel=telegram")
    expect(firstExtension).toContain("target=yeonjang-main")
    expect(secondExtension).toContain("target=yeonjang-windows")
  })

  it("has recovery metadata for every corpus item", () => {
    for (const sample of errorCorpus) {
      expect(sample.recovery?.action).toBeTruthy()
      expect(sample.recovery?.toolName || sample.recovery?.channel || sample.recovery?.targetId).toBeTruthy()
    }
  })
})
