/**
 * Screen capture tools.
 * Uses @nut-tree/nut-js when available, falls back to platform CLI tools.
 */

import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import type { AgentTool, ArtifactDeliveryResultDetails, ToolResult } from "../../types.js"
import { DEFAULT_YEONJANG_EXTENSION_ID, canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../../yeonjang/mqtt-client.js"
import { resolvePreferredYeonjangExtensionId } from "../yeonjang-target.js"
import { PATHS } from "../../../config/index.js"

interface YeonjangScreenCaptureResult {
  output_path?: string
  file_name?: string
  file_extension?: string
  mime_type?: string
  size_bytes?: number
  transfer_encoding?: string
  base64_data?: string
  message: string
}

interface ScreenCaptureFailureDetails {
  via: "yeonjang"
  extensionId?: string
  stopAfterFailure?: boolean
  failureKind?: "path_bug" | "timeout" | "remote_failure"
}

const DEFAULT_SCREEN_CAPTURE_TIMEOUT_MS = 60_000

function extensionFromMimeType(mimeType?: string): string {
  switch ((mimeType ?? "").toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg"
    case "image/webp":
      return "webp"
    case "image/png":
    default:
      return "png"
  }
}

function saveInlineScreenCapture(base64: string, mimeType?: string): string {
  const artifactsDir = join(PATHS.stateDir, "artifacts", "screens")
  mkdirSync(artifactsDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = join(artifactsDir, `screen-capture-${timestamp}.${extensionFromMimeType(mimeType)}`)
  writeFileSync(filePath, Buffer.from(base64, "base64"))
  return filePath
}

function validateYeonjangBinaryResult(remote: YeonjangScreenCaptureResult): string {
  if (!remote.base64_data) {
    throw new Error("연장 screen.capture 응답에 바이너리(base64_data)가 없습니다.")
  }
  if (remote.transfer_encoding && remote.transfer_encoding !== "base64") {
    throw new Error(`연장 screen.capture 응답 전달 형식이 base64가 아닙니다: ${remote.transfer_encoding}`)
  }
  return remote.base64_data
}


function yeonjangRequiredFailure(method: string): ToolResult {
  return {
    success: false,
    output: `이 작업은 Yeonjang 연장을 통해서만 실행할 수 있습니다. 현재 연결된 연장이 \`${method}\` 메서드를 지원하지 않거나 연결되어 있지 않습니다.`,
    error: "YEONJANG_REQUIRED",
    details: {
      requiredExecutor: "yeonjang",
      requiredMethod: method,
    },
  }
}

function classifyYeonjangScreenCaptureFailure(message: string): {
  code: string
  output: string
  details: ScreenCaptureFailureDetails
} {
  if (/(getdirectoryname|output path is empty|argumentexception|directory name is invalid)/i.test(message)
    || /디렉터리 이름이 올바르지|경로 처리/.test(message)) {
    return {
      code: "YEONJANG_SCREEN_CAPTURE_PATH_BUG",
      output: [
        'Windows 연장의 `screen.capture` 내부 경로 처리 오류 때문에 화면 캡처가 실패했습니다.',
        '이 문제는 다른 도구 조합으로 우회하기보다 Windows Yeonjang을 최신 버전으로 다시 빌드하고 재시작해야 해결됩니다.',
        'Windows에서 `build-yeonjang-windows.bat`를 실행해 재빌드한 뒤 다시 시도해 주세요.',
      ].join('\n'),
      details: {
        via: "yeonjang",
        stopAfterFailure: true,
        failureKind: "path_bug",
      },
    }
  }

  if (/(응답 시간이 초과되었습니다|연결 시간이 초과되었습니다|timed out|timeout)/i.test(message)) {
    return {
      code: "YEONJANG_SCREEN_CAPTURE_TIMEOUT",
      output: [
        '연장의 화면 캡처가 제한 시간 안에 끝나지 않았습니다.',
        'Windows Yeonjang을 다시 시작한 뒤 다시 시도해 주세요.',
      ].join('\n'),
      details: {
        via: "yeonjang",
        stopAfterFailure: true,
        failureKind: "timeout",
      },
    }
  }

  return {
    code: "YEONJANG_SCREEN_CAPTURE_REMOTE_FAILURE",
    output: `Yeonjang 화면 캡처 실패: ${message}`,
    details: {
      via: "yeonjang",
      stopAfterFailure: true,
      failureKind: "remote_failure",
    },
  }
}

interface ScreenCaptureParams {
  extensionId?: string
}

interface ScreenFindTextParams {
  text: string
  extensionId?: string
}

async function captureScreenViaYeonjang(extensionId?: string): Promise<{
  base64: string
  remote: YeonjangScreenCaptureResult
}> {
  const remote = await invokeYeonjangMethod<YeonjangScreenCaptureResult>(
    "screen.capture",
    { inline_base64: true },
    { timeoutMs: DEFAULT_SCREEN_CAPTURE_TIMEOUT_MS, ...(extensionId ? { extensionId } : {}) },
  )
  return {
    base64: validateYeonjangBinaryResult(remote),
    remote,
  }
}

export const screenCaptureTool: AgentTool<ScreenCaptureParams> = {
  name: "screen_capture",
  description: "현재 화면을 캡처하여 base64 PNG 이미지로 반환합니다. 화면 내용을 분석할 때 사용하세요.",
  parameters: {
    type: "object",
    properties: {
      extensionId: {
        type: "string",
        description: `대상 Yeonjang 연장 ID. 사용자가 특정 컴퓨터/장치를 지목한 경우 지정합니다. 기본값: ${DEFAULT_YEONJANG_EXTENSION_ID}`,
      },
    },
    required: [],
  },
  riskLevel: "safe",
  requiresApproval: false,
  execute: async (params, ctx): Promise<ToolResult> => {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: ctx.userMessage,
    })
    try {
      if (await canYeonjangHandleMethod("screen.capture", extensionId ? { extensionId } : {})) {
        const { base64, remote } = await captureScreenViaYeonjang(extensionId)
        const localSavedPath = saveInlineScreenCapture(base64, remote.mime_type)
        const localFileSize = statSync(localSavedPath).size
        const artifactDetails: ArtifactDeliveryResultDetails | undefined = ctx.source === "webui" && localSavedPath
          ? {
              kind: "artifact_delivery",
              channel: "webui",
              filePath: localSavedPath,
              mimeType: remote.mime_type ?? "image/png",
              size: localFileSize,
              source: ctx.source,
            }
          : undefined
        return {
          success: true,
          output: `Yeonjang 스크린샷 캡처 완료.\n로컬 저장: ${localSavedPath}`,
          details: {
            via: "yeonjang",
            fileName: remote.file_name,
            fileExtension: remote.file_extension,
            mimeType: remote.mime_type ?? "image/png",
            sizeBytes: remote.size_bytes,
            transferEncoding: "base64",
            localSavedPath,
            localFileSize,
            ...(artifactDetails ?? {}),
          },
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        const classified = classifyYeonjangScreenCaptureFailure(message)
        return {
          success: false,
          output: classified.output,
          error: classified.code,
          details: {
            ...classified.details,
            ...(extensionId ? { extensionId } : {}),
          },
        }
      }
    }
    return yeonjangRequiredFailure("screen.capture")
  },
}

export const screenFindTextTool: AgentTool<ScreenFindTextParams> = {
  name: "screen_find_text",
  description: "현재 화면에서 특정 텍스트의 위치를 찾습니다. OCR을 사용합니다 (tesseract 필요).",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "찾을 텍스트" },
      extensionId: {
        type: "string",
        description: `대상 Yeonjang 연장 ID. 사용자가 특정 컴퓨터/장치를 지목한 경우 지정합니다. 기본값: ${DEFAULT_YEONJANG_EXTENSION_ID}`,
      },
    },
    required: ["text"],
  },
  riskLevel: "safe",
  requiresApproval: false,
  execute: async (params: ScreenFindTextParams): Promise<ToolResult> => {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: params.text,
    })
    try {
      if (!await canYeonjangHandleMethod("screen.capture", extensionId ? { extensionId } : {})) {
        return yeonjangRequiredFailure("screen.capture")
      }
      const tmpPng = join(tmpdir(), `nobie-screen-ocr-${Date.now()}.png`)
      const tmpTxt = join(tmpdir(), `nobie-ocr-${Date.now()}`)

      const { base64 } = await captureScreenViaYeonjang(extensionId)
      writeFileSync(tmpPng, Buffer.from(base64, "base64"))

      const { execFile } = await import("node:child_process")
      const { promisify } = await import("node:util")
      const execFileAsync = promisify(execFile)
      await execFileAsync("tesseract", [tmpPng, tmpTxt, "-l", "eng+kor"])
      const ocrText = readFileSync(`${tmpTxt}.txt`, "utf8")

      try { unlinkSync(tmpPng) } catch { /* ignore */ }
      try { unlinkSync(`${tmpTxt}.txt`) } catch { /* ignore */ }

      const found = ocrText.toLowerCase().includes(params.text.toLowerCase())
      return {
        success: true,
        output: found
          ? `"${params.text}" 텍스트를 화면에서 찾았습니다.`
          : `"${params.text}" 텍스트를 화면에서 찾을 수 없습니다.`,
      }
    } catch (err) {
      if (isYeonjangUnavailableError(err)) {
        return yeonjangRequiredFailure("screen.capture")
      }
      return { success: false, output: `텍스트 검색 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}
