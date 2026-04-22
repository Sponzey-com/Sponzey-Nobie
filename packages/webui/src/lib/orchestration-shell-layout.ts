export interface OrchestrationStudioShellLayout {
  root: string
  chromeStack: string
  viewportGrid: string
  mapStage: string
  sheetColumn: string
  validationRibbon: string
  footer: string
  sheetMode: "floating-desktop" | "stacked"
}

export function getOrchestrationStudioShellLayout(input: {
  surface: "page" | "settings"
  sheetOpen: boolean
}): OrchestrationStudioShellLayout {
  const { surface, sheetOpen } = input

  if (surface === "settings") {
    return {
      root: "space-y-4",
      chromeStack: "space-y-3",
      viewportGrid: "grid gap-4",
      mapStage: "min-w-0",
      sheetColumn: sheetOpen ? "order-last" : "hidden",
      validationRibbon: "rounded-[1.6rem] border border-stone-200 bg-white/90 p-4 shadow-[var(--orchestration-shadow-node)]",
      footer: "rounded-[1.6rem] border border-stone-200 bg-white/90 p-4 shadow-[var(--orchestration-shadow-node)]",
      sheetMode: "stacked",
    }
  }

  return {
    root: "space-y-4",
    chromeStack: "space-y-3",
    viewportGrid: "grid gap-4",
    mapStage: "min-w-0 space-y-4",
    sheetColumn: sheetOpen ? "" : "opacity-0 pointer-events-none",
    validationRibbon: "rounded-[1.6rem] border border-stone-200 bg-white/95 p-4 shadow-[var(--orchestration-shadow-node)] backdrop-blur-[2px]",
    footer: "rounded-[1.8rem] border border-stone-200 bg-white/95 p-4 shadow-[var(--orchestration-shadow-pop)] backdrop-blur-[4px]",
    sheetMode: "floating-desktop",
  }
}
