/**
 * Mouse control tools.
 * Requires Yeonjang for execution.
 */

import type { AgentTool, ToolContext, ToolResult } from "../../types.js"
import { DEFAULT_YEONJANG_EXTENSION_ID, canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../../yeonjang/mqtt-client.js"
import { resolvePreferredYeonjangExtensionId } from "../yeonjang-target.js"

const MOVE_DELAY_MS = 500

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

interface MouseMoveParams {
  x: number
  y: number
  extensionId?: string
}

interface MouseClickParams {
  x: number
  y: number
  button?: "left" | "right" | "middle"
  double?: boolean
  extensionId?: string
}

interface MouseActionParams {
  action: "move" | "click" | "double_click" | "button_down" | "button_up" | "scroll"
  x?: number
  y?: number
  button?: "left" | "right" | "middle"
  deltaX?: number
  deltaY?: number
  extensionId?: string
}

interface YeonjangMouseMoveResult {
  moved: boolean
  x: number
  y: number
  message: string
}

interface YeonjangMouseClickResult {
  clicked: boolean
  x: number
  y: number
  button: string
  double: boolean
  message: string
}

interface YeonjangMouseActionResult {
  accepted: boolean
  action: string
  x?: number
  y?: number
  button?: string
  delta_x?: number
  delta_y?: number
  message: string
}

export const mouseMoveTool: AgentTool<MouseMoveParams> = {
  name: "mouse_move",
  description: "마우스 커서를 지정한 화면 좌표로 이동합니다.",
  parameters: {
    type: "object",
    properties: {
      x: { type: "number", description: "X 좌표 (픽셀)" },
      y: { type: "number", description: "Y 좌표 (픽셀)" },
      extensionId: {
        type: "string",
        description: `대상 Yeonjang 연장 ID. 사용자가 특정 컴퓨터/장치를 지목한 경우 지정합니다. 기본값: ${DEFAULT_YEONJANG_EXTENSION_ID}`,
      },
    },
    required: ["x", "y"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: MouseMoveParams, ctx: ToolContext): Promise<ToolResult> => {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: ctx.userMessage,
    })
    await new Promise((r) => setTimeout(r, MOVE_DELAY_MS))

    try {
      if (await canYeonjangHandleMethod("mouse.move", extensionId ? { extensionId } : {})) {
        const remote = await invokeYeonjangMethod<YeonjangMouseMoveResult>(
          "mouse.move",
          { x: params.x, y: params.y },
          { timeoutMs: 15_000, ...(extensionId ? { extensionId } : {}) },
        )
        return {
          success: remote.moved,
          output: remote.message || `마우스를 (${params.x}, ${params.y})로 이동했습니다.`,
          details: { via: "yeonjang", x: remote.x, y: remote.y },
          ...(remote.moved ? {} : { error: "remote_mouse_move_failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 마우스 이동 실패: ${message}`, error: message }
      }
    }
    return yeonjangRequiredFailure("mouse.move")
  },
}

export const mouseClickTool: AgentTool<MouseClickParams> = {
  name: "mouse_click",
  description: "지정한 좌표에서 마우스 클릭을 수행합니다.",
  parameters: {
    type: "object",
    properties: {
      x: { type: "number", description: "X 좌표 (픽셀)" },
      y: { type: "number", description: "Y 좌표 (픽셀)" },
      button: {
        type: "string",
        enum: ["left", "right", "middle"],
        description: "클릭할 마우스 버튼 (기본: left)",
      },
      double: { type: "boolean", description: "더블 클릭 여부 (기본: false)" },
      extensionId: {
        type: "string",
        description: `대상 Yeonjang 연장 ID. 사용자가 특정 컴퓨터/장치를 지목한 경우 지정합니다. 기본값: ${DEFAULT_YEONJANG_EXTENSION_ID}`,
      },
    },
    required: ["x", "y"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: MouseClickParams, ctx: ToolContext): Promise<ToolResult> => {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: ctx.userMessage,
    })
    await new Promise((r) => setTimeout(r, MOVE_DELAY_MS))

    try {
      if (await canYeonjangHandleMethod("mouse.click", extensionId ? { extensionId } : {})) {
        const remote = await invokeYeonjangMethod<YeonjangMouseClickResult>(
          "mouse.click",
          {
            x: params.x,
            y: params.y,
            ...(params.button ? { button: params.button } : {}),
            ...(params.double ? { double: params.double } : {}),
          },
          { timeoutMs: 15_000, ...(extensionId ? { extensionId } : {}) },
        )
        return {
          success: remote.clicked,
          output: remote.message || `(${params.x}, ${params.y}) 클릭 완료`,
          details: { via: "yeonjang", x: remote.x, y: remote.y, button: remote.button, double: remote.double },
          ...(remote.clicked ? {} : { error: "remote_mouse_click_failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 마우스 클릭 실패: ${message}`, error: message }
      }
    }
    return yeonjangRequiredFailure("mouse.click")
  },
}

export const mouseActionTool: AgentTool<MouseActionParams> = {
  name: "mouse_action",
  description: "마우스 액션을 실행합니다. move, click, double_click, button_down, button_up, scroll을 지원합니다.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["move", "click", "double_click", "button_down", "button_up", "scroll"],
        description: "실행할 마우스 액션",
      },
      x: { type: "number", description: "X 좌표 (선택)" },
      y: { type: "number", description: "Y 좌표 (선택)" },
      button: {
        type: "string",
        enum: ["left", "right", "middle"],
        description: "대상 버튼 (기본: left)",
      },
      deltaX: { type: "number", description: "가로 스크롤 값" },
      deltaY: { type: "number", description: "세로 스크롤 값" },
      extensionId: {
        type: "string",
        description: `대상 Yeonjang 연장 ID. 사용자가 특정 컴퓨터/장치를 지목한 경우 지정합니다. 기본값: ${DEFAULT_YEONJANG_EXTENSION_ID}`,
      },
    },
    required: ["action"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: MouseActionParams, ctx: ToolContext): Promise<ToolResult> => {
    const extensionId = resolvePreferredYeonjangExtensionId({
      requestedExtensionId: params.extensionId,
      userMessage: ctx.userMessage,
    })
    await new Promise((r) => setTimeout(r, MOVE_DELAY_MS))

    try {
      if (await canYeonjangHandleMethod("mouse.action", extensionId ? { extensionId } : {})) {
        const remote = await invokeYeonjangMethod<YeonjangMouseActionResult>(
          "mouse.action",
          {
            action: params.action,
            ...(typeof params.x === "number" ? { x: params.x } : {}),
            ...(typeof params.y === "number" ? { y: params.y } : {}),
            ...(params.button ? { button: params.button } : {}),
            ...(typeof params.deltaX === "number" ? { delta_x: params.deltaX } : {}),
            ...(typeof params.deltaY === "number" ? { delta_y: params.deltaY } : {}),
          },
          { timeoutMs: 15_000, ...(extensionId ? { extensionId } : {}) },
        )
        return {
          success: remote.accepted,
          output: remote.message || `마우스 액션 실행: ${params.action}`,
          details: {
            via: "yeonjang",
            action: remote.action,
            x: remote.x,
            y: remote.y,
            button: remote.button,
            deltaX: remote.delta_x,
            deltaY: remote.delta_y,
          },
          ...(remote.accepted ? {} : { error: "remote_mouse_action_failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 마우스 액션 실패: ${message}`, error: message }
      }
    }

    return yeonjangRequiredFailure("mouse.action")
  },
}
