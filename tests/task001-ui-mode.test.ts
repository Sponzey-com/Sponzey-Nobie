import { createRequire } from "node:module"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerUiModeRoute } from "../packages/core/src/api/routes/ui-mode.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { PATHS } from "../packages/core/src/config/paths.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { resolveUiMode } from "../packages/core/src/ui/mode.ts"

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

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-ui-mode-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  delete process.env["NOBIE_ADMIN_UI"]
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
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task001 UI mode contract", () => {
  it("falls back to beginner for unknown or disabled admin modes", () => {
    expect(resolveUiMode({ preferredUiMode: "missing", adminEnabled: false })).toEqual(expect.objectContaining({
      mode: "beginner",
      preferredUiMode: "beginner",
      availableModes: ["beginner", "advanced"],
      adminEnabled: false,
      schemaVersion: 1,
    }))

    expect(resolveUiMode({ preferredUiMode: "advanced", requestedMode: "admin", adminEnabled: false })).toEqual(expect.objectContaining({
      mode: "advanced",
      preferredUiMode: "advanced",
      availableModes: ["beginner", "advanced"],
    }))
  })

  it("allows admin as a runtime mode only when the admin flag is enabled", () => {
    expect(resolveUiMode({ preferredUiMode: "beginner", requestedMode: "admin", adminEnabled: true })).toEqual(expect.objectContaining({
      mode: "admin",
      preferredUiMode: "beginner",
      availableModes: ["beginner", "advanced", "admin"],
      adminEnabled: true,
    }))
  })

  it("exposes the default beginner mode without raw diagnostic payloads", async () => {
    const app = Fastify({ logger: false })
    registerUiModeRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/ui/mode" })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        mode: "beginner",
        preferredUiMode: "beginner",
        availableModes: ["beginner", "advanced"],
        adminEnabled: false,
        canSwitchInUi: true,
        schemaVersion: 1,
      })
      expect(JSON.stringify(response.json())).not.toMatch(/token|stack|diagnostic|requestGroup|checksum/i)
    } finally {
      await app.close()
    }
  })

  it("persists beginner and advanced modes but rejects admin preference saves", async () => {
    const app = Fastify({ logger: false })
    registerUiModeRoute(app)
    await app.ready()
    try {
      const saved = await app.inject({ method: "POST", url: "/api/ui/mode", payload: { mode: "advanced" } })
      expect(saved.statusCode).toBe(200)
      expect(saved.json()).toEqual(expect.objectContaining({ ok: true, mode: "advanced", preferredUiMode: "advanced" }))

      const reloaded = await app.inject({ method: "GET", url: "/api/ui/mode" })
      expect(reloaded.json()).toEqual(expect.objectContaining({ mode: "advanced", preferredUiMode: "advanced" }))
      expect(existsSync(PATHS.configFile)).toBe(true)
      expect(readFileSync(PATHS.configFile, "utf-8")).toContain("preferredUiMode")

      const rejected = await app.inject({ method: "POST", url: "/api/ui/mode", payload: { mode: "admin" } })
      expect(rejected.statusCode).toBe(400)
      expect(rejected.json()).toEqual({ ok: false, error: "invalid ui mode", allowedModes: ["beginner", "advanced"] })
    } finally {
      await app.close()
    }
  })

  it("reports admin availability from NOBIE_ADMIN_UI without saving admin as the preference", async () => {
    process.env["NOBIE_ADMIN_UI"] = "1"
    reloadConfig()
    const app = Fastify({ logger: false })
    registerUiModeRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/ui/mode" })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(expect.objectContaining({
        mode: "beginner",
        preferredUiMode: "beginner",
        adminEnabled: true,
        availableModes: ["beginner", "advanced", "admin"],
      }))
    } finally {
      await app.close()
    }
  })
})
