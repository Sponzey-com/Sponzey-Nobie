import * as React from "react"
import { getOrchestrationDisplayFontStyle, getOrchestrationMonoFontStyle, resolveOrchestrationAvatarAccent, type OrchestrationVisualTone } from "../../lib/orchestration-visual-theme"

type AvatarMode = "card" | "character"
type AvatarSize = "sm" | "md" | "lg"

export function OrchestrationAgentAvatar({
  seed,
  displayName,
  role = "",
  mode = "card",
  size = "md",
  tone = "neutral",
}: {
  seed: string
  displayName: string
  role?: string
  mode?: AvatarMode
  size?: AvatarSize
  tone?: OrchestrationVisualTone
}) {
  const accent = resolveOrchestrationAvatarAccent(seed)
  const initials = buildInitials(displayName)
  const sizeClass = avatarSizeClass(mode, size)
  const roleGlyph = roleAccentGlyph(role)

  return (
    <div
      data-orchestration-agent-avatar={accent.id}
      data-orchestration-agent-avatar-mode={mode}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-[1.2rem] border-[1.5px] ${sizeClass} ${
        tone === "disabled" ? "opacity-75 grayscale-[0.2]" : ""
      }`}
      style={{
        backgroundColor: accent.background,
        borderColor: accent.border,
        color: accent.foreground,
        boxShadow: "var(--orchestration-shadow-node)",
      }}
      aria-hidden="true"
    >
      <span className="absolute left-2 top-1 rounded-full bg-white/75 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-700" style={getOrchestrationMonoFontStyle()}>
        {roleGlyph}
      </span>
      <span className={`${mode === "character" ? "text-xl" : "text-sm"} font-extrabold uppercase`} style={getOrchestrationDisplayFontStyle()}>
        {initials}
      </span>
    </div>
  )
}

function buildInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (parts.length === 0) return "NB"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return parts.map((part) => part[0]!.toUpperCase()).join("")
}

function avatarSizeClass(mode: AvatarMode, size: AvatarSize): string {
  if (mode === "character") {
    switch (size) {
      case "lg":
        return "h-20 w-20 rounded-[1.6rem]"
      case "sm":
        return "h-14 w-14 rounded-[1.25rem]"
      case "md":
      default:
        return "h-16 w-16 rounded-[1.4rem]"
    }
  }

  switch (size) {
    case "lg":
      return "h-14 w-14"
    case "sm":
      return "h-10 w-10"
    case "md":
    default:
      return "h-12 w-12"
  }
}

function roleAccentGlyph(role: string): string {
  const normalized = role.toLowerCase()
  if (normalized.includes("review")) return "RV"
  if (normalized.includes("oper")) return "OP"
  if (normalized.includes("build")) return "BD"
  if (normalized.includes("research")) return "RS"
  return "AG"
}

