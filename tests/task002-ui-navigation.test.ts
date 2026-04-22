import { describe, expect, it } from "vitest"
import { getUiNavigation, resolveLegacyAdvancedRoute } from "../packages/webui/src/lib/ui-mode.js"

describe("task002 UI navigation policy", () => {
  it("keeps beginner navigation to the minimum operator surface", () => {
    expect(getUiNavigation("beginner", false).map((item) => item.path)).toEqual([
      "/chat",
      "/setup",
      "/agents",
      "/tasks",
      "/status",
    ])
  })

  it("uses advanced routes for the current full control surface", () => {
    expect(getUiNavigation("advanced", false).map((item) => item.path)).toEqual([
      "/advanced/chat",
      "/advanced/runs",
      "/advanced/ai",
      "/advanced/channels",
      "/advanced/extensions",
      "/advanced/schedules",
      "/advanced/memory",
      "/advanced/tools",
      "/advanced/agents",
      "/advanced/dashboard",
      "/advanced/release",
      "/advanced/settings",
      "/advanced/audit",
      "/advanced/plugins",
    ])
  })

  it("exposes admin navigation only when the explicit admin flag is enabled", () => {
    expect(getUiNavigation("advanced", false).some((item) => item.path === "/admin")).toBe(false)
    expect(getUiNavigation("beginner", true).some((item) => item.path === "/admin")).toBe(true)
    expect(getUiNavigation("advanced", true).some((item) => item.path === "/admin")).toBe(true)
  })

  it("maps legacy control-plane routes to advanced routes during migration", () => {
    expect(resolveLegacyAdvancedRoute("/settings")).toBe("/advanced/settings")
    expect(resolveLegacyAdvancedRoute("/settings/ai")).toBe("/advanced/settings/ai")
    expect(resolveLegacyAdvancedRoute("/runs")).toBe("/advanced/runs")
    expect(resolveLegacyAdvancedRoute("/chat")).toBeNull()
  })
})
