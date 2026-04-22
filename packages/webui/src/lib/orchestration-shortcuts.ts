import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type OrchestrationShortcutAction =
  | "zoom_in"
  | "zoom_out"
  | "reset_view"
  | "close_overlay"
  | "save_draft"

export interface OrchestrationShortcutEventLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

export interface OrchestrationShortcutHint {
  action: OrchestrationShortcutAction
  label: string
  combo: string
}

export function resolveOrchestrationShortcut(
  event: OrchestrationShortcutEventLike,
): OrchestrationShortcutAction | null {
  const key = event.key.trim()
  const lower = key.toLowerCase()
  const withPrimaryModifier = Boolean(event.metaKey || event.ctrlKey)

  if (withPrimaryModifier && lower === "s") return "save_draft"
  if (key === "=" || key === "+") return "zoom_in"
  if (key === "-" || key === "_") return "zoom_out"
  if (key === "0") return "reset_view"
  if (key === "Escape") return "close_overlay"
  return null
}

export function getOrchestrationShortcutHints(language: UiLanguage): OrchestrationShortcutHint[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    { action: "zoom_in", label: t("확대", "Zoom in"), combo: "=" },
    { action: "zoom_out", label: t("축소", "Zoom out"), combo: "-" },
    { action: "reset_view", label: t("뷰 리셋", "Reset view"), combo: "0" },
    { action: "close_overlay", label: t("닫기", "Close overlay"), combo: "Esc" },
    { action: "save_draft", label: t("초안 저장", "Save draft"), combo: "Cmd/Ctrl+S" },
  ]
}

export function shouldIgnoreOrchestrationShortcutTarget(
  target: EventTarget | null,
  action: OrchestrationShortcutAction | null,
): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return action !== "save_draft" && action !== "close_overlay"
  const tagName = target.tagName.toLowerCase()
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return action !== "save_draft" && action !== "close_overlay"
  }
  return false
}

export function trapOrchestrationFocus(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  root: HTMLElement | null,
): boolean {
  if (event.key !== "Tab" || !root) return false
  const focusable = getOrchestrationFocusableElements(root)
  if (focusable.length === 0) return false
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return false

  if (!active || !root.contains(active)) {
    event.preventDefault()
    first.focus()
    return true
  }

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
    return true
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
    return true
  }

  return false
}

export function getOrchestrationFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true")
}
