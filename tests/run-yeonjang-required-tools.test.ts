import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const canYeonjangHandleMethod = vi.fn()
const invokeYeonjangMethod = vi.fn()
const isYeonjangUnavailableError = vi.fn((error: unknown) => error === "unavailable")

vi.mock("../packages/core/src/yeonjang/mqtt-client.js", () => ({
  canYeonjangHandleMethod,
  invokeYeonjangMethod,
  isYeonjangUnavailableError,
}))

const { shellExecTool } = await import("../packages/core/src/tools/builtin/shell.ts")
const { appLaunchTool } = await import("../packages/core/src/tools/builtin/app.ts")
const { processKillTool } = await import("../packages/core/src/tools/builtin/process.ts")
const { screenCaptureTool } = await import("../packages/core/src/tools/builtin/ui/screen.ts")
const { mouseMoveTool } = await import("../packages/core/src/tools/builtin/ui/mouse.ts")
const { keyboardTypeTool } = await import("../packages/core/src/tools/builtin/ui/keyboard.ts")
const { windowFocusTool } = await import("../packages/core/src/tools/builtin/ui/window.ts")

function createContext(): ToolContext {
  return {
    sessionId: "session-1",
    runId: "run-1",
    workDir: process.cwd(),
    userMessage: "연장으로 실행해줘",
    source: "telegram",
    allowWebAccess: false,
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  }
}

describe("yeonjang required tools", () => {
  beforeEach(() => {
    canYeonjangHandleMethod.mockReset()
    invokeYeonjangMethod.mockReset()
    isYeonjangUnavailableError.mockClear()
    canYeonjangHandleMethod.mockResolvedValue(false)
  })

  it("fails shell execution when Yeonjang system.exec is unavailable", async () => {
    const result = await shellExecTool.execute({ command: "pwd" }, createContext())

    expect(result.success).toBe(false)
    expect(result.error).toBe("YEONJANG_REQUIRED")
    expect(result.output).toContain("system.exec")
  })

  it("fails app launch when Yeonjang application.launch is unavailable", async () => {
    const result = await appLaunchTool.execute({ app: "Safari" }, createContext())

    expect(result.success).toBe(false)
    expect(result.error).toBe("YEONJANG_REQUIRED")
    expect(result.output).toContain("application.launch")
  })

  it("fails screen capture when Yeonjang screen.capture is unavailable", async () => {
    const result = await screenCaptureTool.execute({}, createContext())

    expect(result.success).toBe(false)
    expect(result.error).toBe("YEONJANG_REQUIRED")
    expect(result.output).toContain("screen.capture")
  })

  it("fails mouse move when Yeonjang mouse.move is unavailable", async () => {
    const result = await mouseMoveTool.execute({ x: 10, y: 20 }, createContext())

    expect(result.success).toBe(false)
    expect(result.error).toBe("YEONJANG_REQUIRED")
    expect(result.output).toContain("mouse.move")
  })

  it("fails keyboard typing when Yeonjang keyboard.type is unavailable", async () => {
    const result = await keyboardTypeTool.execute({ text: "hello" }, createContext())

    expect(result.success).toBe(false)
    expect(result.error).toBe("YEONJANG_REQUIRED")
    expect(result.output).toContain("keyboard.type")
  })

  it("fails process kill because core local process control is disabled", async () => {
    const result = await processKillTool.execute({ pid: 1234 }, createContext())

    expect(result.success).toBe(false)
    expect(result.error).toBe("YEONJANG_REQUIRED")
    expect(result.output).toContain("코어 로컬 경로")
  })

  it("fails window focus because core local window control is disabled", async () => {
    const result = await windowFocusTool.execute({ title: "Safari" }, createContext())

    expect(result.success).toBe(false)
    expect(result.error).toBe("YEONJANG_REQUIRED")
    expect(result.output).toContain("창 포커스")
  })
})
