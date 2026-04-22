import * as React from "react"
import { getOrchestrationContentShellClasses, getOrchestrationContentShellStyle } from "../../lib/orchestration-visual-theme"

export function OrchestrationContentShell({
  surface,
  children,
}: {
  surface: "page" | "settings"
  children: React.ReactNode
}) {
  const classes = getOrchestrationContentShellClasses(surface)

  return (
    <div
      data-orchestration-content-shell={surface}
      className={classes.outer}
      style={getOrchestrationContentShellStyle(surface)}
    >
      <div className={classes.inner}>
        {children}
      </div>
    </div>
  )
}

