/**
 * Mouse control tools. Uses Yeonjang first when available,
 * then falls back to local nut-js control.
 */

import type { AgentTool, ToolContext, ToolResult } from "../../types.js"
import { canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../../yeonjang/mqtt-client.js"

const MOVE_DELAY_MS = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNutMouse(): Promise<{ mouse: any; Point: any; Button: any }> {
  for (const pkg of ["@nut-tree-fork/nut-js", "@nut-tree/nut-js"]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(pkg)
      return mod as { mouse: unknown; Point: unknown; Button: unknown } as never
    } catch {
      // try next package
    }
  }
  throw new Error("@nut-tree/nut-js not installed. Run: pnpm add @nut-tree-fork/nut-js")
}

interface MouseMoveParams {
  x: number
  y: number
}

interface MouseClickParams {
  x: number
  y: number
  button?: "left" | "right" | "middle"
  double?: boolean
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

export const mouseMoveTool: AgentTool<MouseMoveParams> = {
  name: "mouse_move",
  description: "마우스 커서를 지정한 화면 좌표로 이동합니다.",
  parameters: {
    type: "object",
    properties: {
      x: { type: "number", description: "X 좌표 (픽셀)" },
      y: { type: "number", description: "Y 좌표 (픽셀)" },
    },
    required: ["x", "y"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: MouseMoveParams, ctx: ToolContext): Promise<ToolResult> => {
    await new Promise((r) => setTimeout(r, MOVE_DELAY_MS))

    try {
      if (await canYeonjangHandleMethod("mouse.move")) {
        const remote = await invokeYeonjangMethod<YeonjangMouseMoveResult>(
          "mouse.move",
          { x: params.x, y: params.y },
          { timeoutMs: 15_000 },
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
      ctx.onProgress("Yeonjang 연장을 찾지 못해 로컬 마우스 이동으로 전환합니다.")
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { mouse, Point } = await getNutMouse()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await mouse.move([new Point(params.x, params.y)])
      return { success: true, output: `마우스를 (${params.x}, ${params.y})로 이동했습니다.`, details: { via: "local" } }
    } catch (err) {
      return { success: false, output: `마우스 이동 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
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
    },
    required: ["x", "y"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: MouseClickParams, ctx: ToolContext): Promise<ToolResult> => {
    await new Promise((r) => setTimeout(r, MOVE_DELAY_MS))

    try {
      if (await canYeonjangHandleMethod("mouse.click")) {
        const remote = await invokeYeonjangMethod<YeonjangMouseClickResult>(
          "mouse.click",
          {
            x: params.x,
            y: params.y,
            ...(params.button ? { button: params.button } : {}),
            ...(params.double ? { double: params.double } : {}),
          },
          { timeoutMs: 15_000 },
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
      ctx.onProgress("Yeonjang 연장을 찾지 못해 로컬 마우스 클릭으로 전환합니다.")
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { mouse, Point, Button } = await getNutMouse()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await mouse.move([new Point(params.x, params.y)])

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const btn = params.button === "right" ? Button.RIGHT : params.button === "middle" ? Button.MIDDLE : Button.LEFT

      if (params.double) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await mouse.doubleClick(btn)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await mouse.click(btn)
      }

      const action = params.double ? "더블 클릭" : "클릭"
      return { success: true, output: `(${params.x}, ${params.y}) ${action} 완료`, details: { via: "local" } }
    } catch (err) {
      return { success: false, output: `마우스 클릭 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}
