/**
 * Screen capture tools.
 * Uses @nut-tree/nut-js when available, falls back to platform CLI tools.
 */

import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import type { AgentTool, ArtifactDeliveryResultDetails, ToolResult } from "../../types.js"
import {
  DEFAULT_YEONJANG_EXTENSION_ID,
  doesYeonjangCapabilitySupportMethod,
  doesYeonjangCapabilitySupportOutputMode,
  getYeonjangCapabilities,
  hasYeonjangCapabilityMatrix,
  invokeYeonjangMethod,
  isYeonjangUnavailableError,
  type YeonjangClientOptions,
} from "../../../yeonjang/mqtt-client.js"
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

function yeonjangCapabilityMatrixRequiredFailure(method: string): ToolResult {
  return {
    success: false,
    output: [
      `현재 연결된 Yeonjang이 \`${method}\` capability matrix를 제공하지 않는 오래된 버전입니다.`,
      "화면 캡처는 지원 여부와 결과 전달 형식(base64/file)을 확인한 뒤 실행해야 하므로, 최신 Yeonjang으로 재빌드하고 재시작해 주세요.",
    ].join("\n"),
    error: "YEONJANG_CAPABILITY_MATRIX_REQUIRED",
    details: {
      requiredExecutor: "yeonjang",
      requiredMethod: method,
      requiredCapabilityMatrix: true,
    },
  }
}

function yeonjangOutputModeFailure(method: string, outputMode: string): ToolResult {
  return {
    success: false,
    output: [
      `현재 연결된 Yeonjang이 \`${method}\` 결과를 \`${outputMode}\` 형식으로 반환할 수 없다고 보고했습니다.`,
      "요청한 결과물을 안전하게 전달할 수 없으므로 다른 출력 형식으로 임의 실행하지 않고 중단합니다.",
    ].join("\n"),
    error: "YEONJANG_OUTPUT_MODE_UNSUPPORTED",
    details: {
      requiredExecutor: "yeonjang",
      requiredMethod: method,
      requiredOutputMode: outputMode,
    },
  }
}

function yeonjangOutputModeUnknownFailure(method: string, outputMode: string): ToolResult {
  return {
    success: false,
    output: [
      `현재 연결된 Yeonjang이 \`${method}\`의 \`${outputMode}\` 결과 반환 가능 여부를 보고하지 않았습니다.`,
      "결과물이 필요한 요청이므로 출력 형식이 확인될 때까지 실행하지 않습니다. 최신 Yeonjang으로 재빌드하고 재시작해 주세요.",
    ].join("\n"),
    error: "YEONJANG_OUTPUT_MODE_UNKNOWN",
    details: {
      requiredExecutor: "yeonjang",
      requiredMethod: method,
      requiredOutputMode: outputMode,
    },
  }
}

async function preflightYeonjangScreenCapture(options: YeonjangClientOptions): Promise<ToolResult | null> {
  const method = "screen.capture"
  try {
    const capabilities = await getYeonjangCapabilities(options)
    if (!doesYeonjangCapabilitySupportMethod(capabilities, method)) {
      return yeonjangRequiredFailure(method)
    }
    if (!hasYeonjangCapabilityMatrix(capabilities)) {
      return yeonjangCapabilityMatrixRequiredFailure(method)
    }

    const base64Support = doesYeonjangCapabilitySupportOutputMode(capabilities, method, "base64")
    if (base64Support === false) return yeonjangOutputModeFailure(method, "base64")
    if (base64Support === null) return yeonjangOutputModeUnknownFailure(method, "base64")
    return null
  } catch (error) {
    if (isYeonjangUnavailableError(error)) return yeonjangRequiredFailure(method)
    throw error
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
  display?: number | string
}

interface ScreenFindTextParams {
  text: string
  extensionId?: string
}

function resolveRequestedDisplay(display: number | string | undefined, userMessage: string): number | undefined {
  if (typeof display === "number" && Number.isInteger(display) && display >= 0) return display
  if (typeof display === "string") {
    const trimmed = display.trim().toLowerCase()
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
    if (trimmed === "main" || trimmed === "primary") return 0
    if (trimmed === "secondary" || trimmed === "external") return 1
  }

  const trimmedMessage = userMessage.trim()
  const koreanOrdinal = trimmedMessage.match(/(\d+)\s*(?:번째|번)\s*(?:모니터|디스플레이|화면)/u)
  if (koreanOrdinal) {
    const ordinal = Number.parseInt(koreanOrdinal[1] ?? "", 10)
    if (Number.isInteger(ordinal) && ordinal > 0) return ordinal - 1
  }

  const englishOrdinal = trimmedMessage.match(/\b(\d+)(?:st|nd|rd|th)?\s+(?:monitor|display|screen)\b/i)
  if (englishOrdinal) {
    const ordinal = Number.parseInt(englishOrdinal[1] ?? "", 10)
    if (Number.isInteger(ordinal) && ordinal > 0) return ordinal - 1
  }

  if (/(외부\s*모니터|서브\s*모니터|보조\s*모니터|두\s*번째\s*모니터|두번째\s*모니터)/u.test(trimmedMessage)) return 1
  if (/\b(?:second|secondary|external)\s+(?:monitor|display|screen)\b/i.test(trimmedMessage)) return 1
  if (/(메인\s*모니터|주\s*모니터|기본\s*모니터)/u.test(trimmedMessage)) return 0
  if (/\b(?:main|primary)\s+(?:monitor|display|screen)\b/i.test(trimmedMessage)) return 0

  return undefined
}

async function captureScreenViaYeonjang(params: {
  extensionId?: string
  display?: number
}): Promise<{
  base64: string
  remote: YeonjangScreenCaptureResult
}> {
  const remote = await invokeYeonjangMethod<YeonjangScreenCaptureResult>(
    "screen.capture",
    {
      inline_base64: true,
      ...(params.display !== undefined ? { display: params.display } : {}),
    },
    { timeoutMs: DEFAULT_SCREEN_CAPTURE_TIMEOUT_MS, ...(params.extensionId ? { extensionId: params.extensionId } : {}) },
  )
  return {
    base64: validateYeonjangBinaryResult(remote),
    remote,
  }
}

export const screenCaptureTool: AgentTool<ScreenCaptureParams> = {
  name: "screen_capture",
  description: "현재 화면을 캡처하여 base64 PNG 이미지로 반환합니다. 특정 모니터를 캡처하려면 display를 지정하세요. 예: 메인 모니터=0, 두 번째 모니터=1.",
  parameters: {
    type: "object",
    properties: {
      extensionId: {
        type: "string",
        description: `대상 Yeonjang 연장 ID. 사용자가 특정 컴퓨터/장치를 지목한 경우 지정합니다. 기본값: ${DEFAULT_YEONJANG_EXTENSION_ID}`,
      },
      display: {
        type: "integer",
        description: "캡처할 모니터 인덱스. 0은 메인, 1은 두 번째 모니터입니다. 사용자가 특정 모니터를 지목한 경우 지정합니다.",
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
    const display = resolveRequestedDisplay(params.display, ctx.userMessage)
    try {
      const yeonjangOptions = extensionId ? { extensionId } : {}
      const preflightFailure = await preflightYeonjangScreenCapture(yeonjangOptions)
      if (preflightFailure) return preflightFailure

      {
        const { base64, remote } = await captureScreenViaYeonjang({
          ...(extensionId ? { extensionId } : {}),
          ...(display !== undefined ? { display } : {}),
        })
        const localSavedPath = saveInlineScreenCapture(base64, remote.mime_type)
        const localFileSize = statSync(localSavedPath).size
        const artifactChannel = ctx.source === "webui" || ctx.source === "telegram" || ctx.source === "slack"
          ? ctx.source
          : null
        const artifactDetails: ArtifactDeliveryResultDetails | undefined = artifactChannel && localSavedPath
          ? {
              kind: "artifact_delivery",
              channel: artifactChannel,
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
            ...(display !== undefined ? { display } : {}),
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
  execute: async (params: ScreenFindTextParams, ctx): Promise<ToolResult> => {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: ctx.userMessage || params.text,
    })
    try {
      const preflightFailure = await preflightYeonjangScreenCapture(extensionId ? { extensionId } : {})
      if (preflightFailure) return preflightFailure
      const tmpPng = join(tmpdir(), `nobie-screen-ocr-${Date.now()}.png`)
      const tmpTxt = join(tmpdir(), `nobie-ocr-${Date.now()}`)

      const { base64 } = await captureScreenViaYeonjang(extensionId ? { extensionId } : {})
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
