import { describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const canYeonjangHandleMethod = vi.fn()
const invokeYeonjangMethod = vi.fn()
const isYeonjangUnavailableError = vi.fn(() => false)

vi.mock("../packages/core/src/yeonjang/mqtt-client.js", () => ({
  canYeonjangHandleMethod,
  invokeYeonjangMethod,
  isYeonjangUnavailableError,
}))

const { keyboardShortcutTool } = await import("../packages/core/src/tools/builtin/ui/keyboard.ts")

function createContext(): ToolContext {
  return {
    sessionId: "session-1",
    runId: "run-1",
    workDir: process.cwd(),
    userMessage: "단축키 실행해줘",
    source: "telegram",
    allowWebAccess: false,
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  }
}

describe("keyboard shortcut tool", () => {
  it("uses Yeonjang keyboard.action for shortcut requests", async () => {
    canYeonjangHandleMethod.mockResolvedValue(true)
    invokeYeonjangMethod.mockResolvedValue({
      accepted: true,
      action: "shortcut",
      key: "Space",
      modifiers: ["meta"],
      message: "Keyboard shortcut completed.",
    })

    const result = await keyboardShortcutTool.execute(
      { keys: ["Command", "Space"] },
      createContext(),
    )

    expect(canYeonjangHandleMethod).toHaveBeenCalledWith("keyboard.action")
    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      "keyboard.action",
      {
        action: "shortcut",
        key: "Space",
        modifiers: ["meta"],
      },
      { timeoutMs: 15_000 },
    )
    expect(result.success).toBe(true)
    expect(result.details).toMatchObject({
      via: "yeonjang",
      action: "shortcut",
      key: "Space",
      modifiers: ["meta"],
    })
  })

  it("rejects shortcuts that contain more than one non-modifier key", async () => {
    canYeonjangHandleMethod.mockReset()
    invokeYeonjangMethod.mockReset()

    await expect(keyboardShortcutTool.execute(
      { keys: ["Command", "K", "C"] },
      createContext(),
    )).rejects.toThrow("여러 일반 키를 동시에 누르는 단축키는 지원하지 않습니다")
  })
})
