export interface OrchestrationViewportState {
  zoom: number
  offsetX: number
  offsetY: number
  focus: "overview" | "selection"
}

export interface OrchestrationViewportSelection {
  kind: "agent" | "team"
  id: string
}

const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.82
const MAX_ZOOM = 1.32
const ZOOM_STEP = 0.12

export function createDefaultOrchestrationViewportState(): OrchestrationViewportState {
  return {
    zoom: DEFAULT_ZOOM,
    offsetX: 0,
    offsetY: 0,
    focus: "overview",
  }
}

export function panOrchestrationViewport(
  state: OrchestrationViewportState,
  delta: { x: number; y: number },
): OrchestrationViewportState {
  return {
    ...state,
    offsetX: roundViewportNumber(state.offsetX + delta.x),
    offsetY: roundViewportNumber(state.offsetY + delta.y),
  }
}

export function zoomOrchestrationViewport(
  state: OrchestrationViewportState,
  direction: "in" | "out",
): OrchestrationViewportState {
  const nextZoom = direction === "in"
    ? state.zoom + ZOOM_STEP
    : state.zoom - ZOOM_STEP
  return {
    ...state,
    zoom: clampViewportZoom(nextZoom),
  }
}

export function fitAllOrchestrationViewport(): OrchestrationViewportState {
  return createDefaultOrchestrationViewportState()
}

export function fitSelectionOrchestrationViewport(
  selection: OrchestrationViewportSelection | null | undefined,
): OrchestrationViewportState {
  if (!selection) return fitAllOrchestrationViewport()

  if (selection.kind === "team") {
    return {
      zoom: 1.08,
      offsetX: -44,
      offsetY: -20,
      focus: "selection",
    }
  }

  return {
    zoom: 1.16,
    offsetX: 68,
    offsetY: -16,
    focus: "selection",
  }
}

export function formatOrchestrationViewportTransform(state: OrchestrationViewportState): string {
  return `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.zoom})`
}

function clampViewportZoom(value: number): number {
  return roundViewportNumber(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)))
}

function roundViewportNumber(value: number): number {
  return Math.round(value * 100) / 100
}
