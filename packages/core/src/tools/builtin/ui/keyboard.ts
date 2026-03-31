/**
 * Keyboard control tools. Uses Yeonjang first when available,
 * then falls back to local nut-js control.
 */

import type { AgentTool, ToolContext, ToolResult } from "../../types.js"
import { canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../../yeonjang/mqtt-client.js"

const TYPE_DELAY_MS = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNutKeyboard(): Promise<{ keyboard: any; Key: any }> {
  for (const pkg of ["@nut-tree-fork/nut-js", "@nut-tree/nut-js"]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(pkg)
      return mod as never
    } catch {
      // try next package
    }
  }
  throw new Error("@nut-tree/nut-js not installed. Run: pnpm add @nut-tree-fork/nut-js")
}

interface KeyboardTypeParams {
  text: string
}

interface KeyboardShortcutParams {
  keys: string[]
}

interface YeonjangKeyboardTypeResult {
  typed: boolean
  text_len: number
  message: string
}

export const keyboardTypeTool: AgentTool<KeyboardTypeParams> = {
  name: "keyboard_type",
  description: "키보드로 텍스트를 입력합니다. 현재 포커스된 입력창에 텍스트가 입력됩니다.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "입력할 텍스트" },
    },
    required: ["text"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: KeyboardTypeParams, ctx: ToolContext): Promise<ToolResult> => {
    await new Promise((r) => setTimeout(r, TYPE_DELAY_MS))

    try {
      if (await canYeonjangHandleMethod("keyboard.type")) {
        const remote = await invokeYeonjangMethod<YeonjangKeyboardTypeResult>(
          "keyboard.type",
          { text: params.text },
          { timeoutMs: 15_000 },
        )
        return {
          success: remote.typed,
          output: remote.message || `텍스트 입력 완료: "${params.text.slice(0, 50)}${params.text.length > 50 ? "…" : ""}"`,
          details: { via: "yeonjang", textLength: remote.text_len },
          ...(remote.typed ? {} : { error: "remote_keyboard_type_failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 키보드 입력 실패: ${message}`, error: message }
      }
      ctx.onProgress("Yeonjang 연장을 찾지 못해 로컬 키보드 입력으로 전환합니다.")
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { keyboard } = await getNutKeyboard()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await keyboard.type(params.text)
      return {
        success: true,
        output: `텍스트 입력 완료: "${params.text.slice(0, 50)}${params.text.length > 50 ? "…" : ""}"`,
        details: { via: "local" },
      }
    } catch (err) {
      return { success: false, output: `키보드 입력 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

export const keyboardShortcutTool: AgentTool<KeyboardShortcutParams> = {
  name: "keyboard_shortcut",
  description: "키보드 단축키를 실행합니다. 예: Ctrl+C, Cmd+Space, Alt+F4 등.",
  parameters: {
    type: "object",
    properties: {
      keys: {
        type: "array",
        items: { type: "string" },
        description: "누를 키 목록 (예: [\"LeftControl\", \"c\"] for Ctrl+C). nut-js Key enum 기준.",
      },
    },
    required: ["keys"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: KeyboardShortcutParams): Promise<ToolResult> => {
    await new Promise((r) => setTimeout(r, TYPE_DELAY_MS))
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { keyboard, Key } = await getNutKeyboard()

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      const resolvedKeys: any[] = params.keys.map((k) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const resolved = (Key as Record<string, unknown>)[k]
        if (resolved === undefined) throw new Error(`알 수 없는 키: ${k}`)
        return resolved
      })

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await keyboard.pressKey(...resolvedKeys)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await keyboard.releaseKey(...resolvedKeys.reverse())

      return { success: true, output: `단축키 실행: ${params.keys.join("+")}`, details: { via: "local" } }
    } catch (err) {
      return { success: false, output: `단축키 실행 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}
