import { describe, expect, it } from "vitest"
import { getUiNavigation, resolveLegacyAdvancedRoute, resolveModeSwitchRoute, resolveRollbackRoute } from "../packages/webui/src/lib/ui-mode.js"

describe("task002 UI navigation policy", () => {
  it("keeps beginner navigation to the minimum operator surface", () => {
    expect(getUiNavigation("beginner", false).map((item) => item.path)).toEqual([
      "/chat",
      "/setup",
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
      "/advanced/dashboard",
      "/advanced/release",
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
    expect(resolveLegacyAdvancedRoute("/settings")).toBe("/advanced/ai")
    expect(resolveLegacyAdvancedRoute("/settings/ai")).toBe("/advanced/ai")
    expect(resolveLegacyAdvancedRoute("/runs")).toBe("/advanced/runs")
    expect(resolveLegacyAdvancedRoute("/chat")).toBeNull()
  })

  it("moves setup and core beginner routes to the right advanced destinations on mode switch", () => {
    expect(resolveModeSwitchRoute("/setup", "advanced")).toBe("/advanced/ai")
    expect(resolveModeSwitchRoute("/chat", "advanced")).toBe("/advanced/chat")
    expect(resolveModeSwitchRoute("/tasks", "advanced")).toBe("/advanced/runs")
    expect(resolveModeSwitchRoute("/status", "advanced")).toBe("/advanced/dashboard")
    expect(resolveRollbackRoute("/setup")).toBe("/advanced/ai")
  })
})
