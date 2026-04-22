import { describe, expect, it } from "vitest"
import {
  ORCHESTRATION_VISUAL_THEME,
  getOrchestrationContentShellClasses,
  getOrchestrationContentShellStyle,
  getOrchestrationSurfaceToneClasses,
  resolveOrchestrationAvatarAccent,
} from "../packages/webui/src/lib/orchestration-visual-theme.ts"

describe("task001 orchestration visual theme", () => {
  it("exposes the design-token palette and local-first font stacks", () => {
    expect(ORCHESTRATION_VISUAL_THEME.colors.background).toBe("#FFFBEF")
    expect(ORCHESTRATION_VISUAL_THEME.colors.canvas).toBe("#FEF9EC")
    expect(ORCHESTRATION_VISUAL_THEME.colors.yellow).toBe("#F7DD4A")
    expect(ORCHESTRATION_VISUAL_THEME.fonts.display).toContain("Space Grotesk")
    expect(ORCHESTRATION_VISUAL_THEME.fonts.mono).toContain("IBM Plex Mono")
    expect(ORCHESTRATION_VISUAL_THEME.accents).toHaveLength(6)
  })

  it("defines page and settings content-shell spacing with shared local theme styles", () => {
    const pageClasses = getOrchestrationContentShellClasses("page")
    const settingsClasses = getOrchestrationContentShellClasses("settings")
    const pageStyle = getOrchestrationContentShellStyle("page")
    const settingsStyle = getOrchestrationContentShellStyle("settings")

    expect(pageClasses.outer).toContain("overflow-y-auto")
    expect(pageClasses.inner).toContain("w-full")
    expect(pageClasses.inner).toContain("min-w-0")
    expect(settingsClasses.outer).toContain("rounded-[2rem]")
    expect(settingsClasses.outer).toContain("shadow-[var(--orchestration-shadow-lift)]")
    expect(String(pageStyle.backgroundColor)).toBe("#FFFBEF")
    expect(String(settingsStyle.backgroundColor)).toBe("#FEFCF4")
    expect(String(pageStyle["--orchestration-shadow-pop" as keyof typeof pageStyle])).toContain("4px 6px 0")
  })

  it("keeps tone classes and avatar accent selection deterministic", () => {
    expect(getOrchestrationSurfaceToneClasses("ready")).toContain("emerald")
    expect(getOrchestrationSurfaceToneClasses("warning")).toContain("amber")
    expect(getOrchestrationSurfaceToneClasses("disabled")).toContain("stone")
    expect(getOrchestrationSurfaceToneClasses("neutral", true)).toContain("bg-stone-950")

    const alpha = resolveOrchestrationAvatarAccent("agent-alpha-a1")
    const alphaAgain = resolveOrchestrationAvatarAccent("agent-alpha-a1")
    const beta = resolveOrchestrationAvatarAccent("agent-beta-b2")

    expect(alpha.id).toBe(alphaAgain.id)
    expect(alpha.background).toBe(alphaAgain.background)
    expect(beta.id).not.toBe("")
  })
})
