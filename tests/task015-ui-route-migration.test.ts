import { createRequire } from "node:module"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerUiModeRoute } from "../packages/core/src/api/routes/ui-mode.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { PATHS } from "../packages/core/src/config/paths.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { resolveUiMode, resolveUiModeRollbackActivation } from "../packages/core/src/ui/mode.ts"
import {
  getDeprecatedUiRoutes,
  getUiRouteInventory,
  resolveLegacyAdvancedRoute,
  resolveRollbackRoute,
  resolveRouteMigration,
} from "../packages/webui/src/lib/ui-mode.js"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const previousAdminUi = process.env["NOBIE_ADMIN_UI"]
const previousRollback = process.env["NOBIE_UI_MODE_ROLLBACK"]
const previousLegacyUi = process.env["NOBIE_LEGACY_UI"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task015-ui-migration-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  delete process.env["NOBIE_ADMIN_UI"]
  delete process.env["NOBIE_UI_MODE_ROLLBACK"]
  delete process.env["NOBIE_LEGACY_UI"]
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  if (previousAdminUi === undefined) delete process.env["NOBIE_ADMIN_UI"]
  else process.env["NOBIE_ADMIN_UI"] = previousAdminUi
  if (previousRollback === undefined) delete process.env["NOBIE_UI_MODE_ROLLBACK"]
  else process.env["NOBIE_UI_MODE_ROLLBACK"] = previousRollback
  if (previousLegacyUi === undefined) delete process.env["NOBIE_LEGACY_UI"]
  else process.env["NOBIE_LEGACY_UI"] = previousLegacyUi
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task015 UI route migration and rollback", () => {
  it("keeps a route inventory with mode ownership, API calls, and replacement paths", () => {
    const inventory = getUiRouteInventory()
    const paths = inventory.map((item) => item.path)

    expect(paths).toEqual(expect.arrayContaining([
      "/chat",
      "/tasks",
      "/dashboard",
      "/settings",
      "/ai",
      "/channels",
      "/advanced/dashboard",
      "/advanced/settings",
      "/admin",
    ]))
    expect(inventory.find((item) => item.path === "/chat")).toEqual(expect.objectContaining({
      mode: "beginner",
      component: "ChatPage",
      status: "kept",
    }))
    expect(inventory.find((item) => item.path === "/dashboard")).toEqual(expect.objectContaining({
      mode: "advanced",
      status: "redirect",
      replacementPath: "/advanced/dashboard",
    }))
    expect(inventory.find((item) => item.path === "/ai")).toEqual(expect.objectContaining({
      mode: "advanced",
      status: "deprecated",
      replacementPath: "/advanced/ai",
    }))
    expect(inventory.every((item) => item.apiCalls.length > 0 || item.component === "Navigate")).toBe(true)
    expect(getDeprecatedUiRoutes().every((item) => item.replacementPath?.startsWith("/advanced/"))).toBe(true)
  })

  it("redirects legacy and deprecated URLs without leaving blank screens", () => {
    expect(resolveLegacyAdvancedRoute("/settings")).toBe("/advanced/settings")
    expect(resolveLegacyAdvancedRoute("/settings/ai")).toBe("/advanced/settings/ai")
    expect(resolveLegacyAdvancedRoute("/runs")).toBe("/advanced/runs")
    expect(resolveLegacyAdvancedRoute("/ai")).toBe("/advanced/ai")
    expect(resolveLegacyAdvancedRoute("/channels/slack")).toBe("/advanced/channels/slack")
    expect(resolveLegacyAdvancedRoute("/memory")).toBe("/advanced/memory")
    expect(resolveLegacyAdvancedRoute("/chat")).toBeNull()

    expect(resolveRouteMigration("/release")).toEqual(expect.objectContaining({
      from: "/release",
      to: "/advanced/release",
      status: "deprecated",
      component: "SettingsPage",
    }))
  })

  it("provides a rollback route policy for the mode shell", () => {
    expect(resolveRollbackRoute("/")).toBe("/advanced/dashboard")
    expect(resolveRollbackRoute("/chat")).toBe("/advanced/dashboard")
    expect(resolveRollbackRoute("/setup")).toBe("/advanced/settings")
    expect(resolveRollbackRoute("/settings/mqtt")).toBe("/advanced/settings/mqtt")
    expect(resolveRollbackRoute("/advanced/runs")).toBe("/advanced/runs")
  })

  it("uses an environment rollback flag to disable UI mode switching without data migration", async () => {
    process.env["NOBIE_UI_MODE_ROLLBACK"] = "1"
    reloadConfig()

    expect(resolveUiModeRollbackActivation()).toEqual(expect.objectContaining({
      enabled: true,
      reason: "enabled_by_ui_mode_rollback",
    }))
    expect(resolveUiMode({ preferredUiMode: "beginner", adminEnabled: false })).toEqual(expect.objectContaining({
      mode: "advanced",
      preferredUiMode: "advanced",
      availableModes: ["advanced"],
      canSwitchInUi: false,
    }))

    const app = Fastify({ logger: false })
    registerUiModeRoute(app)
    await app.ready()
    try {
      const mode = await app.inject({ method: "GET", url: "/api/ui/mode" })
      expect(mode.statusCode).toBe(200)
      expect(mode.json()).toEqual(expect.objectContaining({
        mode: "advanced",
        preferredUiMode: "advanced",
        availableModes: ["advanced"],
        canSwitchInUi: false,
      }))

      const saved = await app.inject({ method: "POST", url: "/api/ui/mode", payload: { mode: "beginner" } })
      expect(saved.statusCode).toBe(200)
      expect(saved.json()).toEqual(expect.objectContaining({
        ok: true,
        mode: "advanced",
        preferredUiMode: "advanced",
        canSwitchInUi: false,
      }))
      if (existsSync(PATHS.configFile)) {
        expect(readFileSync(PATHS.configFile, "utf-8")).not.toContain("preferredUiMode")
      }
    } finally {
      await app.close()
    }
  })

  it("keeps the existing settings save path when rollback is not enabled", async () => {
    const app = Fastify({ logger: false })
    registerUiModeRoute(app)
    await app.ready()
    try {
      const saved = await app.inject({ method: "POST", url: "/api/ui/mode", payload: { mode: "advanced" } })
      expect(saved.statusCode).toBe(200)
      expect(saved.json()).toEqual(expect.objectContaining({ ok: true, mode: "advanced", preferredUiMode: "advanced" }))
      expect(readFileSync(PATHS.configFile, "utf-8")).toContain("preferredUiMode")
    } finally {
      await app.close()
    }
  })
})
