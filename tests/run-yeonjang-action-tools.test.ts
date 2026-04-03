import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const canYeonjangHandleMethod = vi.fn()
const invokeYeonjangMethod = vi.fn()
const isYeonjangUnavailableError = vi.fn(() => false)

vi.mock("../packages/core/src/yeonjang/mqtt-client.js", () => ({
  canYeonjangHandleMethod,
  invokeYeonjangMethod,
  isYeonjangUnavailableError,
}))

const { shellExecTool } = await import("../packages/core/src/tools/builtin/shell.ts")
const { mouseActionTool } = await import("../packages/core/src/tools/builtin/ui/mouse.ts")
const { keyboardActionTool } = await import("../packages/core/src/tools/builtin/ui/keyboard.ts")

function createContext(): ToolContext {
  return {
    sessionId: "session-1",
    runId: "run-1",
    workDir: process.cwd(),
    userMessage: "연장 액션 실행",
    source: "telegram",
    allowWebAccess: false,
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  }
}

describe("yeonjang action tools", () => {
  beforeEach(() => {
    canYeonjangHandleMethod.mockReset()
    invokeYeonjangMethod.mockReset()
    isYeonjangUnavailableError.mockClear()
  })

  it("forwards shell env and timeout to Yeonjang system.exec", async () => {
    canYeonjangHandleMethod.mockResolvedValue(true)
    invokeYeonjangMethod.mockResolvedValue({
      success: true,
      exit_code: 0,
      stdout: "ok",
      stderr: "",
    })

    await shellExecTool.execute(
      {
        command: "echo $HELLO",
        timeoutSec: 12,
        env: { HELLO: "world" },
      },
      createContext(),
    )

    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      "system.exec",
      {
        command: "echo $HELLO",
        args: [],
        cwd: process.cwd(),
        shell: true,
        env: { HELLO: "world" },
        timeout_sec: 12,
      },
      { timeoutMs: 12_000 },
    )
  })

  it("uses Yeonjang mouse.action for scroll requests", async () => {
    canYeonjangHandleMethod.mockResolvedValue(true)
    invokeYeonjangMethod.mockResolvedValue({
      accepted: true,
      action: "scroll",
      delta_x: 10,
      delta_y: -40,
      message: "Mouse scroll completed.",
    })

    const result = await mouseActionTool.execute(
      {
        action: "scroll",
        deltaX: 10,
        deltaY: -40,
      },
      createContext(),
    )

    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      "mouse.action",
      {
        action: "scroll",
        delta_x: 10,
        delta_y: -40,
      },
      { timeoutMs: 15_000 },
    )
    expect(result.success).toBe(true)
    expect(result.details).toMatchObject({
      via: "yeonjang",
      action: "scroll",
      deltaX: 10,
      deltaY: -40,
    })
  })

  it("uses Yeonjang keyboard.action for key press requests", async () => {
    canYeonjangHandleMethod.mockResolvedValue(true)
    invokeYeonjangMethod.mockResolvedValue({
      accepted: true,
      action: "key_press",
      key: "c",
      modifiers: ["meta"],
      message: "Keyboard key_press completed.",
    })

    const result = await keyboardActionTool.execute(
      {
        action: "key_press",
        key: "c",
        modifiers: ["meta"],
      },
      createContext(),
    )

    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      "keyboard.action",
      {
        action: "key_press",
        key: "c",
        modifiers: ["meta"],
      },
      { timeoutMs: 15_000 },
    )
    expect(result.success).toBe(true)
    expect(result.details).toMatchObject({
      via: "yeonjang",
      action: "key_press",
      key: "c",
      modifiers: ["meta"],
    })
  })
})
