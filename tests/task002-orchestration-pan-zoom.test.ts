import { describe, expect, it } from "vitest"
import {
  createDefaultOrchestrationViewportState,
  fitAllOrchestrationViewport,
  fitSelectionOrchestrationViewport,
  formatOrchestrationViewportTransform,
  panOrchestrationViewport,
  zoomOrchestrationViewport,
} from "../packages/webui/src/lib/orchestration-viewport.ts"

describe("task002 orchestration viewport", () => {
  it("supports default, pan, and bounded zoom transitions", () => {
    const initial = createDefaultOrchestrationViewportState()
    const panned = panOrchestrationViewport(initial, { x: 24, y: -12 })
    const zoomed = zoomOrchestrationViewport(panned, "in")

    expect(initial).toEqual({ zoom: 1, offsetX: 0, offsetY: 0, focus: "overview" })
    expect(panned).toEqual({ zoom: 1, offsetX: 24, offsetY: -12, focus: "overview" })
    expect(zoomed.zoom).toBe(1.12)
    expect(formatOrchestrationViewportTransform(zoomed)).toBe("translate(24px, -12px) scale(1.12)")
  })

  it("fits the whole board or the selected team/agent with predictable presets", () => {
    expect(fitAllOrchestrationViewport()).toEqual(createDefaultOrchestrationViewportState())
    expect(fitSelectionOrchestrationViewport({ kind: "team", id: "team-research-r1" })).toEqual({
      zoom: 1.08,
      offsetX: -44,
      offsetY: -20,
      focus: "selection",
    })
    expect(fitSelectionOrchestrationViewport({ kind: "agent", id: "agent-alpha-a1" })).toEqual({
      zoom: 1.16,
      offsetX: 68,
      offsetY: -16,
      focus: "selection",
    })
  })
})
