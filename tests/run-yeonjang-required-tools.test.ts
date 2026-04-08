import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const canYeonjangHandleMethod = vi.fn()
const invokeYeonjangMethod = vi.fn()
const isYeonjangUnavailableError = vi.fn((error: unknown) => error === "unavailable")
const getMqttExtensionSnapshots = vi.fn()

vi.mock("../packages/core/src/yeonjang/mqtt-client.js", () => ({
  canYeonjangHandleMethod,
  invokeYeonjangMethod,
  isYeonjangUnavailableError,
  DEFAULT_YEONJANG_EXTENSION_ID: "yeonjang-main",
}))

vi.mock("../packages/core/src/mqtt/broker.js", () => ({
  getMqttExtensionSnapshots,
}))

const { shellExecTool } = await import("../packages/core/src/tools/builtin/shell.ts")
const { appLaunchTool } = await import("../packages/core/src/tools/builtin/app.ts")
const { processKillTool } = await import("../packages/core/src/tools/builtin/process.ts")
const { screenCaptureTool } = await import("../packages/core/src/tools/builtin/ui/screen.ts")
const { mouseMoveTool } = await import("../packages/core/src/tools/builtin/ui/mouse.ts")
const { keyboardTypeTool } = await import("../packages/core/src/tools/builtin/ui/keyboard.ts")
const { windowFocusTool } = await import("../packages/core/src/tools/builtin/ui/window.ts")

function createContext(userMessage = "연장으로 실행해줘", source: ToolContext["source"] = "telegram"): ToolContext {
  return {
    sessionId: "session-1",
    runId: "run-1",
    workDir: process.cwd(),
    userMessage,
    source,
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
    getMqttExtensionSnapshots.mockReturnValue([
      {
        extensionId: 'yeonjang-main',
        displayName: 'Yeonjang-osx',
        state: 'online',
        message: 'macOS connected',
        methods: ['screen.capture'],
      },
      {
        extensionId: 'yeonjang-dongwooshinc28b-92049',
        displayName: 'Yeonjang-windows',
        state: 'online',
        message: 'windows connected',
        methods: ['screen.capture', 'system.exec'],
      },
    ])
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

  it("returns a terminal guidance message when remote screen capture hits the Windows path bug", async () => {
    canYeonjangHandleMethod.mockResolvedValueOnce(true)
    invokeYeonjangMethod.mockRejectedValueOnce(new Error(
      'screen capture failed: "1" can not be passed to "GetDirectoryName".',
    ))

    const result = await screenCaptureTool.execute({ extensionId: 'yeonjang-windows' }, createContext('윈도우 메인화면 캡처해서 보여줘'))

    expect(result.success).toBe(false)
    expect(result.error).toBe('YEONJANG_SCREEN_CAPTURE_PATH_BUG')
    expect(result.output).toContain('Windows 연장의 `screen.capture` 내부 경로 처리 오류')
    expect(result.details).toEqual({
      via: 'yeonjang',
      stopAfterFailure: true,
      failureKind: 'path_bug',
      extensionId: 'yeonjang-dongwooshinc28b-92049',
    })
    expect(canYeonjangHandleMethod).toHaveBeenCalledWith('screen.capture', { extensionId: 'yeonjang-dongwooshinc28b-92049' })
  })

  it("uses the windows-like user request to avoid falling back to yeonjang-main", async () => {
    canYeonjangHandleMethod.mockResolvedValueOnce(true)
    invokeYeonjangMethod.mockResolvedValueOnce({
      base64_data: Buffer.from('png').toString('base64'),
      mime_type: 'image/png',
      file_name: 'screen.png',
      file_extension: 'png',
      size_bytes: 3,
    })

    const result = await screenCaptureTool.execute({}, createContext('윈도우 메인화면 캡처해서 보여줘'))

    expect(result.success).toBe(true)
    expect(canYeonjangHandleMethod).toHaveBeenCalledWith('screen.capture', { extensionId: 'yeonjang-dongwooshinc28b-92049' })
    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      'screen.capture',
      { inline_base64: true },
      expect.objectContaining({ extensionId: 'yeonjang-dongwooshinc28b-92049', timeoutMs: 60000 }),
    )
  })

  it("passes the requested second-monitor capture target through to Yeonjang", async () => {
    canYeonjangHandleMethod.mockResolvedValueOnce(true)
    invokeYeonjangMethod.mockResolvedValueOnce({
      base64_data: Buffer.from('png').toString('base64'),
      mime_type: 'image/png',
      file_name: 'screen.png',
      file_extension: 'png',
      size_bytes: 3,
    })

    const result = await screenCaptureTool.execute({}, createContext('윈도우 2번째 모니터 캡쳐해서 보여줘'))

    expect(result.success).toBe(true)
    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      'screen.capture',
      { inline_base64: true, display: 1 },
      expect.objectContaining({ extensionId: 'yeonjang-dongwooshinc28b-92049', timeoutMs: 60000 }),
    )
  })

  it("respects an explicit display parameter when provided", async () => {
    canYeonjangHandleMethod.mockResolvedValueOnce(true)
    invokeYeonjangMethod.mockResolvedValueOnce({
      base64_data: Buffer.from('png').toString('base64'),
      mime_type: 'image/png',
      file_name: 'screen.png',
      file_extension: 'png',
      size_bytes: 3,
    })

    const result = await screenCaptureTool.execute({ display: 1 }, createContext('외부모니터 화면 캡쳐해서 보여줘'))

    expect(result.success).toBe(true)
    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      'screen.capture',
      { inline_base64: true, display: 1 },
      { timeoutMs: 60000 },
    )
  })

  it("returns slack artifact delivery details for screen capture requested from slack", async () => {
    canYeonjangHandleMethod.mockResolvedValueOnce(true)
    invokeYeonjangMethod.mockResolvedValueOnce({
      base64_data: Buffer.from('png').toString('base64'),
      mime_type: 'image/png',
      file_name: 'screen.png',
      file_extension: 'png',
      size_bytes: 3,
    })

    const result = await screenCaptureTool.execute({}, createContext('메인 화면 캡쳐해서 보여줘', 'slack'))

    expect(result.success).toBe(true)
    expect(result.details).toMatchObject({
      kind: 'artifact_delivery',
      channel: 'slack',
      source: 'slack',
    })
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
