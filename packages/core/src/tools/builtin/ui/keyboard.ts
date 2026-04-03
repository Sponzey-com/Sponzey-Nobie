/**
 * Keyboard control tools.
 * Requires Yeonjang for execution.
 */

import type { AgentTool, ToolContext, ToolResult } from "../../types.js"
import { canYeonjangHandleMethod, invokeYeonjangMethod, isYeonjangUnavailableError } from "../../../yeonjang/mqtt-client.js"

const TYPE_DELAY_MS = 500

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

interface KeyboardTypeParams {
  text: string
}

interface KeyboardShortcutParams {
  keys: string[]
}

interface KeyboardActionParams {
  action: "type_text" | "shortcut" | "key_press" | "key_down" | "key_up"
  text?: string
  key?: string
  modifiers?: string[]
}

interface YeonjangKeyboardTypeResult {
  typed: boolean
  text_len: number
  message: string
}

interface YeonjangKeyboardActionResult {
  accepted: boolean
  action: string
  key?: string
  modifiers?: string[]
  text_len?: number
  message: string
}

const MODIFIER_KEY_ALIASES = new Map<string, string>([
  ["leftcontrol", "control"],
  ["rightcontrol", "control"],
  ["control", "control"],
  ["ctrl", "control"],
  ["leftctrl", "control"],
  ["rightctrl", "control"],
  ["leftshift", "shift"],
  ["rightshift", "shift"],
  ["shift", "shift"],
  ["leftalt", "alt"],
  ["rightalt", "alt"],
  ["alt", "alt"],
  ["option", "alt"],
  ["leftoption", "alt"],
  ["rightoption", "alt"],
  ["leftsuper", "meta"],
  ["rightsuper", "meta"],
  ["super", "meta"],
  ["meta", "meta"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["leftcommand", "meta"],
  ["rightcommand", "meta"],
  ["win", "meta"],
  ["windows", "meta"],
])

function normalizeModifierKey(key: string): string | null {
  return MODIFIER_KEY_ALIASES.get(key.trim().toLowerCase()) ?? null
}

function splitShortcutKeys(keys: string[]): { key: string; modifiers: string[] } {
  const trimmed = keys.map((key) => key.trim()).filter(Boolean)
  if (trimmed.length === 0) {
    throw new Error("단축키에는 최소 한 개 이상의 키가 필요합니다.")
  }

  const nonModifierKeys = trimmed.filter((key) => normalizeModifierKey(key) === null)
  if (nonModifierKeys.length === 0) {
    throw new Error("단축키에는 modifier가 아닌 일반 키가 하나 필요합니다.")
  }
  if (nonModifierKeys.length > 1) {
    throw new Error(`여러 일반 키를 동시에 누르는 단축키는 지원하지 않습니다: ${nonModifierKeys.join(", ")}`)
  }

  const primaryKey = nonModifierKeys[0]!
  const modifiers = Array.from(new Set(
    trimmed
      .filter((key) => key !== primaryKey)
      .map((key) => normalizeModifierKey(key))
      .filter((value): value is string => typeof value === "string"),
  ))

  return { key: primaryKey, modifiers }
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
  execute: async (params: KeyboardTypeParams, _ctx: ToolContext): Promise<ToolResult> => {
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
    }
    return yeonjangRequiredFailure("keyboard.type")
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
  execute: async (params: KeyboardShortcutParams, _ctx: ToolContext): Promise<ToolResult> => {
    await new Promise((r) => setTimeout(r, TYPE_DELAY_MS))

    const shortcut = splitShortcutKeys(params.keys)

    try {
      if (await canYeonjangHandleMethod("keyboard.action")) {
        const remote = await invokeYeonjangMethod<YeonjangKeyboardActionResult>(
          "keyboard.action",
          {
            action: "shortcut",
            key: shortcut.key,
            modifiers: shortcut.modifiers,
          },
          { timeoutMs: 15_000 },
        )
        return {
          success: remote.accepted,
          output: remote.message || `단축키 실행: ${params.keys.join("+")}`,
          details: {
            via: "yeonjang",
            action: remote.action,
            key: remote.key ?? shortcut.key,
            modifiers: remote.modifiers ?? shortcut.modifiers,
          },
          ...(remote.accepted ? {} : { error: "remote_keyboard_shortcut_failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 단축키 실행 실패: ${message}`, error: message }
      }
    }
    return yeonjangRequiredFailure("keyboard.action")
  },
}

export const keyboardActionTool: AgentTool<KeyboardActionParams> = {
  name: "keyboard_action",
  description: "키보드 액션을 실행합니다. type_text, shortcut, key_press, key_down, key_up을 지원합니다.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["type_text", "shortcut", "key_press", "key_down", "key_up"],
        description: "실행할 키보드 액션",
      },
      text: { type: "string", description: "type_text에서 입력할 텍스트" },
      key: { type: "string", description: "shortcut 또는 key_* 액션의 대상 키" },
      modifiers: {
        type: "array",
        items: { type: "string" },
        description: "함께 누를 modifier 키 목록",
      },
    },
    required: ["action"],
  },
  riskLevel: "moderate",
  requiresApproval: true,
  execute: async (params: KeyboardActionParams, _ctx: ToolContext): Promise<ToolResult> => {
    await new Promise((r) => setTimeout(r, TYPE_DELAY_MS))

    try {
      if (await canYeonjangHandleMethod("keyboard.action")) {
        const remote = await invokeYeonjangMethod<YeonjangKeyboardActionResult>(
          "keyboard.action",
          {
            action: params.action,
            ...(typeof params.text === "string" ? { text: params.text } : {}),
            ...(typeof params.key === "string" ? { key: params.key } : {}),
            ...(params.modifiers?.length ? { modifiers: params.modifiers } : {}),
          },
          { timeoutMs: 15_000 },
        )
        return {
          success: remote.accepted,
          output: remote.message || `키보드 액션 실행: ${params.action}`,
          details: {
            via: "yeonjang",
            action: remote.action,
            key: remote.key,
            modifiers: remote.modifiers,
            textLength: remote.text_len,
          },
          ...(remote.accepted ? {} : { error: "remote_keyboard_action_failed" }),
        }
      }
    } catch (error) {
      if (!isYeonjangUnavailableError(error)) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, output: `Yeonjang 키보드 액션 실패: ${message}`, error: message }
      }
    }

    return yeonjangRequiredFailure("keyboard.action")
  },
}
