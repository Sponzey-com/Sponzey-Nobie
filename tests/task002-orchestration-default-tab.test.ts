import { describe, expect, it } from "vitest"
import { resolveDefaultDashboardTab } from "../packages/webui/src/components/orchestration/OrchestrationControlPanel.tsx"

describe("task002 orchestration default tab", () => {
  it("opens the map tab first for both standard and advanced agent routes", () => {
    expect(resolveDefaultDashboardTab("/agents")).toBe("map")
    expect(resolveDefaultDashboardTab("/advanced/agents")).toBe("map")
  })
})
