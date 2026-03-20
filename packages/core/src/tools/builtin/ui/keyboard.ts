/**
 * Keyboard control tools. Uses @nut-tree/nut-js when available.
 */

import type { AgentTool, ToolResult } from "../../types.js"

const TYPE_DELAY_MS = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNutKeyboard(): Promise<{ keyboard: any; Key: any }> {
  for (const pkg of ["@nut-tree-fork/nut-js", "@nut-tree/nut-js"]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(pkg)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return mod as never
    } catch { /* try next */ }
  }
  throw new Error("@nut-tree/nut-js not installed. Run: pnpm add @nut-tree-fork/nut-js")
}

// ── keyboard_type ─────────────────────────────────────────────────────────

interface KeyboardTypeParams {
  text: string
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
  execute: async (params: KeyboardTypeParams): Promise<ToolResult> => {
    await new Promise((r) => setTimeout(r, TYPE_DELAY_MS))
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { keyboard } = await getNutKeyboard()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await keyboard.type(params.text)
      return { success: true, output: `텍스트 입력 완료: "${params.text.slice(0, 50)}${params.text.length > 50 ? "…" : ""}"` }
    } catch (err) {
      return { success: false, output: `키보드 입력 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

// ── keyboard_shortcut ─────────────────────────────────────────────────────

interface KeyboardShortcutParams {
  keys: string[]
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

      return { success: true, output: `단축키 실행: ${params.keys.join("+")}` }
    } catch (err) {
      return { success: false, output: `단축키 실행 실패: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}
