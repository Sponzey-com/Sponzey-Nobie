/**
 * Screen capture tools.
 * Uses @nut-tree/nut-js when available, falls back to platform CLI tools.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import type { AgentTool, ToolResult } from "../../types.js"
import { canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../../yeonjang/mqtt-client.js"
import { PATHS } from "../../../config/index.js"

const execFileAsync = promisify(execFile)

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

async function captureScreenToBase64(): Promise<string> {
  const tmpPath = join(tmpdir(), `nobie-screen-${Date.now()}.png`)

  const platform = process.platform
  if (platform === "darwin") {
    await execFileAsync("screencapture", ["-x", tmpPath])
  } else if (platform === "linux") {
    await execFileAsync("import", ["-window", "root", tmpPath])
  } else if (platform === "win32") {
    await execFileAsync("powershell", [
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen([System.Drawing.Point]::Empty, [System.Drawing.Point]::Empty, $bmp.Size); $bmp.Save('${tmpPath}')`,
    ])
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  const data = readFileSync(tmpPath)
  try { unlinkSync(tmpPath) } catch { /* ignore */ }
  return data.toString("base64")
}

export const screenCaptureTool: AgentTool<Record<string, never>> = {
  name: "screen_capture",
  description: "현재 화면을 캡처하여 base64 PNG 이미지로 반환합니다. 화면 내용을 분석할 때 사용하세요.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  riskLevel: "safe",
  requiresApproval: false,
  execute: async (): Promise<ToolResult> => {
    try {
      if (await canYeonjangHandleMethod("screen.capture")) {
        const remote = await invokeYeonjangMethod<YeonjangScreenCaptureResult>(
          "screen.capture",
          { inline_base64: true },
          { timeoutMs: 20_000 },
        )
        const base64 = validateYeonjangBinaryResult(remote)
        const localSavedPath = saveInlineScreenCapture(base64, remote.mime_type)
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
            localFileSize: statSync(localSavedPath).size,
          },
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 화면 캡처 실패: ${message}`, error: message }
      }
    }

    try {
      const base64 = await captureScreenToBase64()
      const localSavedPath = saveInlineScreenCapture(base64, "image/png")
      return {
        success: true,
        output: `스크린샷 캡처 완료.\n로컬 저장: ${localSavedPath}`,
        details: {
          via: "local",
          mimeType: "image/png",
          localSavedPath,
          localFileSize: statSync(localSavedPath).size,
        },
      }
    } catch (err) {
      return { success: false, output: `화면 캡처 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

interface ScreenFindTextParams {
  text: string
}

export const screenFindTextTool: AgentTool<ScreenFindTextParams> = {
  name: "screen_find_text",
  description: "현재 화면에서 특정 텍스트의 위치를 찾습니다. OCR을 사용합니다 (tesseract 필요).",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "찾을 텍스트" },
    },
    required: ["text"],
  },
  riskLevel: "safe",
  requiresApproval: false,
  execute: async (params: ScreenFindTextParams): Promise<ToolResult> => {
    try {
      const tmpPng = join(tmpdir(), `nobie-screen-ocr-${Date.now()}.png`)
      const tmpTxt = join(tmpdir(), `nobie-ocr-${Date.now()}`)

      const base64 = await captureScreenToBase64()
      writeFileSync(tmpPng, Buffer.from(base64, "base64"))

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
      return { success: false, output: `텍스트 검색 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}
