import { mkdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentTool, ArtifactDeliveryResultDetails, ToolContext, ToolResult } from "../types.js"
import { invokeYeonjangMethod, DEFAULT_YEONJANG_EXTENSION_ID } from "../../yeonjang/mqtt-client.js"
import { resolvePreferredYeonjangExtensionId } from "./yeonjang-target.js"
import { PATHS } from "../../config/index.js"

interface YeonjangCameraDevice {
  id: string
  name: string
  position?: string
  available: boolean
}

type RequestedCameraFacing = "front" | "rear"

interface YeonjangCameraCaptureResult {
  device_id?: string
  output_path?: string
  file_name?: string
  file_extension?: string
  mime_type?: string
  size_bytes?: number
  transfer_encoding?: string
  base64_data?: string
  message: string
}

function validateYeonjangBinaryCaptureResult(result: YeonjangCameraCaptureResult): string {
  if (!result.base64_data) {
    throw new Error("연장 camera.capture 응답에 바이너리(base64_data)가 없습니다.")
  }
  if (result.transfer_encoding && result.transfer_encoding !== "base64") {
    throw new Error(`연장 camera.capture 응답 전달 형식이 base64가 아닙니다: ${result.transfer_encoding}`)
  }
  return result.base64_data
}

interface YeonjangCameraListParams {
  extensionId?: string
  timeoutSec?: number
}

interface YeonjangCameraCaptureDetails {
  via: "yeonjang"
  extensionId: string
  deviceId?: string
  deviceName?: string
  requestedFacing?: RequestedCameraFacing
  constraint?: "camera_facing_selection_unsupported"
  fileName?: string
  fileExtension?: string
  mimeType?: string
  sizeBytes?: number
  transferEncoding: "base64"
  localSavedPath?: string
  localFileSize?: number
  kind?: "artifact_delivery"
  channel?: "webui"
  filePath?: string
  size?: number
  source?: ToolContext["source"]
}

interface YeonjangCameraCaptureParams {
  extensionId?: string
  deviceId?: string
  outputPath?: string
  inlineBase64?: boolean
  timeoutSec?: number
}

const CAMERA_CAPTURE_INTENT_PATTERNS = [
  /\b(capture|photo|picture|snapshot|shot|take a photo|take photo)\b/i,
  /(?:사진|찍어|촬영|캡처|스냅샷)/u,
]

const FRONT_CAMERA_PATTERNS = [
  /\b(front camera|front-facing|selfie)\b/i,
  /(?:전면|셀카)/u,
]

const REAR_CAMERA_PATTERNS = [
  /\b(rear camera|back camera|rear-facing|back-facing)\b/i,
  /(?:후면|뒷면)/u,
]

function wantsCameraInventoryOnly(userMessage: string): boolean {
  const normalized = userMessage.trim()
  if (!normalized) return false
  if (CAMERA_CAPTURE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false
  }
  return /\b(camera|cameras|device|devices|list|count|what cameras)\b/i.test(normalized)
    || /(?:카메라|장치|목록|몇\s*개|뭐뭐|무엇)/u.test(normalized)
}

function resolveRequestedCameraFacing(userMessage: string): RequestedCameraFacing | null {
  if (FRONT_CAMERA_PATTERNS.some((pattern) => pattern.test(userMessage))) return "front"
  if (REAR_CAMERA_PATTERNS.some((pattern) => pattern.test(userMessage))) return "rear"
  return null
}

function isContinuityCameraDevice(device: YeonjangCameraDevice): boolean {
  return /\biphone\b/i.test(device.name)
}

function findCameraDeviceById(devices: YeonjangCameraDevice[], deviceId?: string): YeonjangCameraDevice | null {
  if (!deviceId) return null
  return devices.find((device) => device.id === deviceId) ?? null
}

function buildCameraFacingUnsupportedMessage(params: {
  deviceName: string
  facing: RequestedCameraFacing
}): string {
  const facingLabel = params.facing === "front" ? "전면" : "후면"
  return [
    `선택한 카메라 "${params.deviceName}" 에서는 ${facingLabel} 카메라를 Nobie/Yeonjang에서 강제로 선택할 수 없습니다.`,
    "iPhone 연속성 카메라는 현재 렌즈(전면/후면) 전환 제어를 노출하지 않습니다.",
    `iPhone에서 ${facingLabel} 카메라로 직접 전환한 뒤 다시 촬영하거나, 다른 카메라를 선택해 주세요.`,
  ].join("\n")
}


function resolveTimeoutMs(timeoutSec?: number): number | undefined {
  if (!Number.isFinite(timeoutSec)) return undefined
  return Math.max(1, Math.min(60, Math.floor(timeoutSec!))) * 1000
}

const DEFAULT_CAMERA_CAPTURE_TIMEOUT_MS = 70_000

function formatCameraList(extensionId: string, devices: YeonjangCameraDevice[]): string {
  if (devices.length === 0) {
    return `연장 "${extensionId}" 에서 사용 가능한 카메라를 찾지 못했습니다.`
  }

  const lines = devices.map((device) => {
    const parts = [device.name]
    if (device.position) parts.push(device.position)
    parts.push(device.available ? "사용 가능" : "사용 불가")
    return `- ${parts.join(" · ")} (${device.id})`
  })

  return `연장 "${extensionId}" 카메라 ${devices.length}개:\n${lines.join("\n")}`
}

function formatCaptureOutput(extensionId: string, result: YeonjangCameraCaptureResult): string {
  const lines = [`연장 "${extensionId}" 카메라 캡처 완료.`]
  if (result.device_id) lines.push(`장치: ${result.device_id}`)
  if (result.file_name) lines.push(`파일명: ${result.file_name}`)
  if (result.file_extension) lines.push(`확장자: ${result.file_extension}`)
  if (result.mime_type) lines.push(`유형: ${result.mime_type}`)
  if (typeof result.size_bytes === "number") lines.push(`크기: ${result.size_bytes} bytes`)
  if (result.transfer_encoding) lines.push(`전달 형식: ${result.transfer_encoding}`)
  if (result.base64_data) {
    lines.push(`인라인 이미지: ${Math.round(result.base64_data.length / 1024)}KB base64`)
  }
  if (result.message) lines.push(result.message)
  return lines.join("\n")
}

function extensionFromMimeType(mimeType?: string): string {
  switch ((mimeType ?? "").toLowerCase()) {
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/jpeg":
    case "image/jpg":
    default:
      return "jpg"
  }
}

function saveInlineCapture(extensionId: string, result: YeonjangCameraCaptureResult): string | null {
  if (!result.base64_data) return null
  const artifactsDir = join(PATHS.stateDir, "artifacts", "yeonjang")
  mkdirSync(artifactsDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = join(artifactsDir, `${extensionId}-camera-${timestamp}.${extensionFromMimeType(result.mime_type)}`)
  writeFileSync(filePath, Buffer.from(result.base64_data, "base64"))
  return filePath
}

export const yeonjangCameraListTool: AgentTool<YeonjangCameraListParams> = {
  name: "yeonjang_camera_list",
  description: "MQTT로 연결된 Yeonjang 연장에 카메라 목록 조회를 요청합니다.",
  parameters: {
    type: "object",
    properties: {
      extensionId: {
        type: "string",
        description: "대상 연장 ID. 기본값은 yeonjang-main 입니다.",
      },
      timeoutSec: {
        type: "number",
        description: "응답 대기 시간(초). 기본값은 15초입니다.",
      },
    },
    required: [],
  },
  riskLevel: "safe",
  requiresApproval: false,
  async execute(params: YeonjangCameraListParams, ctx: ToolContext): Promise<ToolResult> {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: ctx.userMessage,
    }) ?? DEFAULT_YEONJANG_EXTENSION_ID
    ctx.onProgress(`연장 ${extensionId} 카메라 목록을 조회합니다.`)
    try {
      const timeoutMs = resolveTimeoutMs(params.timeoutSec)
      const devices = await invokeYeonjangMethod<YeonjangCameraDevice[]>(
        "camera.list",
        {},
        {
          extensionId,
          ...(timeoutMs != null ? { timeoutMs } : {}),
        },
      )
      return {
        success: true,
        output: formatCameraList(extensionId, devices),
        details: {
          via: "yeonjang",
          extensionId,
          devices,
          ...(wantsCameraInventoryOnly(ctx.userMessage) ? { responseOwnership: "final_text" as const } : {}),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        output: `연장 "${extensionId}" 카메라 목록 조회 실패: ${message}`,
        error: message,
      }
    }
  },
}

export const yeonjangCameraCaptureTool: AgentTool<YeonjangCameraCaptureParams> = {
  name: "yeonjang_camera_capture",
  description: "MQTT로 연결된 Yeonjang 연장에 카메라 캡처를 요청합니다.",
  parameters: {
    type: "object",
    properties: {
      extensionId: {
        type: "string",
        description: "대상 연장 ID. 기본값은 yeonjang-main 입니다.",
      },
      deviceId: {
        type: "string",
        description: "캡처할 카메라 장치 ID. 비우면 기본 카메라를 사용합니다.",
      },
      outputPath: {
        type: "string",
        description: "연장 장치 쪽에 저장할 출력 경로입니다.",
      },
      inlineBase64: {
        type: "boolean",
        description: "이미지 base64 데이터를 응답에 포함합니다. 기본값은 true 입니다.",
      },
      timeoutSec: {
        type: "number",
        description: "응답 대기 시간(초). 기본값은 60초입니다.",
      },
    },
    required: [],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  async execute(params: YeonjangCameraCaptureParams, ctx: ToolContext): Promise<ToolResult> {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: ctx.userMessage,
    }) ?? DEFAULT_YEONJANG_EXTENSION_ID
    const inlineBase64 = true
    ctx.onProgress(`연장 ${extensionId} 카메라 캡처를 요청합니다.`)
    try {
      const requestedFacing = resolveRequestedCameraFacing(ctx.userMessage)
      if (requestedFacing && params.deviceId) {
        const listTimeoutMs = resolveTimeoutMs(15)
        const listedDevices = await invokeYeonjangMethod<YeonjangCameraDevice[]>(
          "camera.list",
          {},
          {
            extensionId,
            ...(listTimeoutMs != null ? { timeoutMs: listTimeoutMs } : {}),
          },
        )
        const selectedDevice = findCameraDeviceById(listedDevices, params.deviceId)
        if (selectedDevice && isContinuityCameraDevice(selectedDevice)) {
          return {
            success: false,
            output: buildCameraFacingUnsupportedMessage({
              deviceName: selectedDevice.name,
              facing: requestedFacing,
            }),
            error: "CAMERA_FACING_SELECTION_UNSUPPORTED",
            details: {
              via: "yeonjang",
              extensionId,
              deviceId: params.deviceId,
              deviceName: selectedDevice.name,
              requestedFacing,
              constraint: "camera_facing_selection_unsupported",
            },
          }
        }
      }

      const result = await invokeYeonjangMethod<YeonjangCameraCaptureResult>(
        "camera.capture",
        {
          ...(params.deviceId ? { device_id: params.deviceId } : {}),
          inline_base64: inlineBase64,
        },
        {
          extensionId,
          timeoutMs: resolveTimeoutMs(params.timeoutSec) ?? DEFAULT_CAMERA_CAPTURE_TIMEOUT_MS,
        },
      )

      const details: YeonjangCameraCaptureDetails = {
        via: "yeonjang",
        extensionId,
        ...(result.device_id ? { deviceId: result.device_id } : {}),
        ...(requestedFacing ? { requestedFacing } : {}),
        ...(result.file_name ? { fileName: result.file_name } : {}),
        ...(result.file_extension ? { fileExtension: result.file_extension } : {}),
        ...(result.mime_type ? { mimeType: result.mime_type } : {}),
        ...(typeof result.size_bytes === "number" ? { sizeBytes: result.size_bytes } : {}),
        transferEncoding: "base64",
      }

      validateYeonjangBinaryCaptureResult(result)
      const localSavedPath = saveInlineCapture(extensionId, result)
      let artifactDetails: ArtifactDeliveryResultDetails | undefined
      if (localSavedPath) {
        const localFileSize = statSync(localSavedPath).size
        details.localSavedPath = localSavedPath
        details.localFileSize = localFileSize
        if (ctx.source === "webui") {
          artifactDetails = {
            kind: "artifact_delivery",
            channel: "webui",
            filePath: localSavedPath,
            size: localFileSize,
            source: ctx.source,
            ...(result.mime_type ? { mimeType: result.mime_type } : {}),
          }
        }
      }

      return {
        success: true,
        output: `${formatCaptureOutput(extensionId, result)}${localSavedPath ? `\n로컬 저장: ${localSavedPath}` : ""}`,
        details: {
          ...details,
          ...(artifactDetails ?? {}),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        output: `연장 "${extensionId}" 카메라 캡처 실패: ${message}`,
        error: message,
      }
    }
  },
}
