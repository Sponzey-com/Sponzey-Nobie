import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const canYeonjangHandleMethod = vi.fn()
const invokeYeonjangMethod = vi.fn()
const isYeonjangUnavailableError = vi.fn((error: unknown) => error === "unavailable")
const mkdirSync = vi.fn()
const statSync = vi.fn(() => ({ size: 321 }))
const writeFileSync = vi.fn()

vi.mock("../packages/core/src/yeonjang/mqtt-client.js", () => ({
  canYeonjangHandleMethod,
  invokeYeonjangMethod,
  isYeonjangUnavailableError,
  DEFAULT_YEONJANG_EXTENSION_ID: "yeonjang-main",
}))

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    mkdirSync,
    statSync,
    writeFileSync,
  }
})

const { yeonjangCameraCaptureTool } = await import("../packages/core/src/tools/builtin/yeonjang.ts")

function createContext(): ToolContext {
  return {
    sessionId: "session-1",
    runId: "run-1",
    requestGroupId: "request-group-1",
    workDir: process.cwd(),
    userMessage: "FaceTime HD 카메라로 사진 찍어줘",
    source: "telegram",
    allowWebAccess: false,
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  }
}

describe("yeonjang camera capture tool", () => {
  beforeEach(() => {
    canYeonjangHandleMethod.mockReset()
    invokeYeonjangMethod.mockReset()
    isYeonjangUnavailableError.mockClear()
    mkdirSync.mockClear()
    statSync.mockClear()
    writeFileSync.mockClear()
    statSync.mockReturnValue({ size: 321 })
  })

  it("forces inline base64 capture and does not leak remote output paths", async () => {
    invokeYeonjangMethod.mockResolvedValueOnce({
      device_id: "camera-1",
      output_path: "/captures",
      file_name: "facetime.jpg",
      file_extension: "jpg",
      mime_type: "image/jpeg",
      size_bytes: 123,
      transfer_encoding: "base64",
      base64_data: "aGVsbG8=",
      message: "Camera capture completed.",
    })

    const result = await yeonjangCameraCaptureTool.execute({
      extensionId: "yeonjang-main",
      deviceId: "camera-1",
      outputPath: "/captures",
      inlineBase64: false,
      timeoutSec: 60,
    }, createContext())

    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      "camera.capture",
      {
        device_id: "camera-1",
        inline_base64: true,
      },
      {
        extensionId: "yeonjang-main",
        timeoutMs: 60_000,
        metadata: {
          runId: "run-1",
          requestGroupId: "request-group-1",
          sessionId: "session-1",
          source: "telegram",
        },
      },
    )
    expect(result.success).toBe(true)
    expect(result.details).toMatchObject({
      via: "yeonjang",
      extensionId: "yeonjang-main",
      deviceId: "camera-1",
      fileName: "facetime.jpg",
      fileExtension: "jpg",
      mimeType: "image/jpeg",
      sizeBytes: 123,
      transferEncoding: "base64",
    })
    expect(result.details).not.toHaveProperty("output_path")
    expect(result.details).not.toHaveProperty("base64_data")
    expect(writeFileSync).toHaveBeenCalledTimes(1)
  })

  it("stops early when the user requests front camera on an iPhone continuity device", async () => {
    invokeYeonjangMethod.mockResolvedValueOnce([
      {
        id: "iphone-camera",
        name: "SamJokO's iPhone-17 Pro Max",
        available: true,
      },
    ])

    const result = await yeonjangCameraCaptureTool.execute({
      extensionId: "yeonjang-main",
      deviceId: "iphone-camera",
      timeoutSec: 60,
    }, {
      ...createContext(),
      userMessage: "‘SamJokO’s iPhone-17 Pro Max’ 카메라에 연결해서 전면 카메라로 한장만 찍어줘",
    })

    expect(invokeYeonjangMethod).toHaveBeenCalledTimes(1)
    expect(invokeYeonjangMethod).toHaveBeenCalledWith(
      "camera.list",
      {},
      {
        extensionId: "yeonjang-main",
        timeoutMs: 15_000,
        metadata: {
          runId: "run-1",
          requestGroupId: "request-group-1",
          sessionId: "session-1",
          source: "telegram",
        },
      },
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe("CAMERA_FACING_SELECTION_UNSUPPORTED")
    expect(result.output).toContain("전면 카메라를 Nobie/Yeonjang에서 강제로 선택할 수 없습니다.")
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})
