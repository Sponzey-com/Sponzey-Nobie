import type { CSSProperties } from "react"

export type OrchestrationVisualTone = "neutral" | "ready" | "warning" | "danger" | "disabled"

export const ORCHESTRATION_VISUAL_THEME = {
  colors: {
    background: "#FFFBEF",
    canvas: "#FEF9EC",
    card: "#FFFFFF",
    panel: "#FEFCF4",
    ink: "#111111",
    inkMuted: "#5A5650",
    inkSoft: "#9B9489",
    border: "#1B1B1B",
    borderLight: "#E8E3D9",
    borderDashed: "#D0CBC0",
    yellow: "#F7DD4A",
    yellowSoft: "#FFF6C4",
    yellowRing: "#E8CC00",
    green: "#22A06B",
    greenSoft: "#DCFBEE",
    red: "#E05555",
    redSoft: "#FDEAEA",
    blueSoft: "#DCE6F2",
  },
  shadows: {
    node: "2px 3px 0 #1B1B1B",
    lift: "3px 5px 0 #1B1B1B",
    pop: "4px 6px 0 #1B1B1B",
  },
  fonts: {
    display: "\"Space Grotesk\", \"Avenir Next\", \"Segoe UI\", sans-serif",
    body: "\"Space Grotesk\", \"Avenir Next\", \"Segoe UI\", sans-serif",
    mono: "\"IBM Plex Mono\", \"SFMono-Regular\", \"Consolas\", monospace",
  },
  accents: [
    { id: "coral", background: "#FFD6C4", foreground: "#7A351E", border: "#D96B43" },
    { id: "teal", background: "#C8EDE8", foreground: "#1E5B5A", border: "#2D7A78" },
    { id: "purple", background: "#E6D6F7", foreground: "#51308A", border: "#8B5CF6" },
    { id: "gold", background: "#FFF0C4", foreground: "#7A5600", border: "#D3A64F" },
    { id: "blue", background: "#DCE6F2", foreground: "#284A70", border: "#5B8EC4" },
    { id: "olive", background: "#E4E8D0", foreground: "#52601F", border: "#7C8B3A" },
  ],
} as const

export function getOrchestrationContentShellClasses(surface: "page" | "settings"): { outer: string; inner: string } {
  if (surface === "settings") {
    return {
      outer: "space-y-6 rounded-[2rem] border border-stone-200 bg-[color:var(--orchestration-panel)]/90 p-4 shadow-[var(--orchestration-shadow-lift)] backdrop-blur-[2px]",
      inner: "space-y-6",
    }
  }

  return {
    outer: "h-full overflow-y-auto px-6 py-6",
    inner: "min-w-0 w-full space-y-6",
  }
}

export function getOrchestrationContentShellStyle(surface: "page" | "settings"): CSSProperties {
  const base = {
    color: ORCHESTRATION_VISUAL_THEME.colors.ink,
    fontFamily: ORCHESTRATION_VISUAL_THEME.fonts.body,
    "--orchestration-background": ORCHESTRATION_VISUAL_THEME.colors.background,
    "--orchestration-panel": ORCHESTRATION_VISUAL_THEME.colors.panel,
    "--orchestration-border": ORCHESTRATION_VISUAL_THEME.colors.border,
    "--orchestration-shadow-lift": ORCHESTRATION_VISUAL_THEME.shadows.lift,
    "--orchestration-shadow-node": ORCHESTRATION_VISUAL_THEME.shadows.node,
    "--orchestration-shadow-pop": ORCHESTRATION_VISUAL_THEME.shadows.pop,
  } as CSSProperties & Record<string, string>

  if (surface === "settings") {
    return {
      ...base,
      backgroundColor: ORCHESTRATION_VISUAL_THEME.colors.panel,
      backgroundImage: [
        `linear-gradient(180deg, ${ORCHESTRATION_VISUAL_THEME.colors.card} 0%, ${ORCHESTRATION_VISUAL_THEME.colors.panel} 100%)`,
        `radial-gradient(circle at top right, ${ORCHESTRATION_VISUAL_THEME.colors.yellowSoft} 0, transparent 38%)`,
      ].join(", "),
    }
  }

  return {
    ...base,
    backgroundColor: ORCHESTRATION_VISUAL_THEME.colors.background,
    backgroundImage: [
      `linear-gradient(180deg, ${ORCHESTRATION_VISUAL_THEME.colors.background} 0%, ${ORCHESTRATION_VISUAL_THEME.colors.canvas} 100%)`,
      `radial-gradient(circle at top left, ${ORCHESTRATION_VISUAL_THEME.colors.yellowSoft} 0, transparent 34%)`,
      `linear-gradient(90deg, transparent 0, transparent calc(100% - 1px), rgba(27, 27, 27, 0.03) calc(100% - 1px))`,
    ].join(", "),
    backgroundSize: "auto, auto, 24px 24px",
  }
}

export function getOrchestrationDisplayFontStyle(): CSSProperties {
  return { fontFamily: ORCHESTRATION_VISUAL_THEME.fonts.display }
}

export function getOrchestrationMonoFontStyle(): CSSProperties {
  return { fontFamily: ORCHESTRATION_VISUAL_THEME.fonts.mono }
}

export function getOrchestrationSurfaceToneClasses(tone: OrchestrationVisualTone, selected = false): string {
  if (selected) {
    return "border-stone-950 bg-stone-950 text-white shadow-[var(--orchestration-shadow-pop)]"
  }

  switch (tone) {
    case "ready":
      return "border-emerald-300 bg-gradient-to-b from-emerald-50 to-white text-emerald-950 shadow-[var(--orchestration-shadow-node)]"
    case "warning":
      return "border-amber-300 bg-gradient-to-b from-amber-50 to-white text-amber-950 shadow-[var(--orchestration-shadow-node)]"
    case "danger":
      return "border-red-300 bg-gradient-to-b from-red-50 to-white text-red-950 shadow-[var(--orchestration-shadow-node)]"
    case "disabled":
      return "border-stone-200 bg-gradient-to-b from-stone-100 to-white text-stone-700 shadow-[var(--orchestration-shadow-node)]"
    case "neutral":
    default:
      return "border-stone-200 bg-white text-stone-950 shadow-[var(--orchestration-shadow-node)]"
  }
}

export function getOrchestrationBadgeClasses(kind: "config" | "runtime" | "detail", selected = false): string {
  if (selected) {
    if (kind === "runtime") return "border border-white/20 bg-white/10 text-white"
    return "border border-white/20 bg-white/15 text-white"
  }

  switch (kind) {
    case "runtime":
      return "border border-sky-200 bg-sky-50 text-sky-900"
    case "detail":
      return "border border-stone-200 bg-white text-stone-700"
    case "config":
    default:
      return "border border-amber-200 bg-amber-50 text-amber-900"
  }
}

export function resolveOrchestrationAvatarAccent(seed: string) {
  const source = seed.trim() || "nobie"
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  }
  return ORCHESTRATION_VISUAL_THEME.accents[hash % ORCHESTRATION_VISUAL_THEME.accents.length]!
}
