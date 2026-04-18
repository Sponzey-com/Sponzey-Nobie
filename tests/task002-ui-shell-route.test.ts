import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerUiModeRoute } from "../packages/core/src/api/routes/ui-mode.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"

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
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-ui-shell-"))
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

describe("task002 UI shell route", () => {
  it("returns a compact shell summary without raw secrets or diagnostic payloads", async () => {
    const app = Fastify({ logger: false })
    registerUiModeRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/ui/shell" })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toEqual(expect.objectContaining({
        generatedAt: expect.any(Number),
        mode: expect.objectContaining({ mode: "beginner", preferredUiMode: "beginner", adminEnabled: false }),
        setupState: { completed: false },
        runtimeHealth: expect.objectContaining({
          ai: expect.objectContaining({ configured: expect.any(Boolean), modelConfigured: expect.any(Boolean) }),
          channels: expect.objectContaining({ webui: true, telegramConfigured: expect.any(Boolean), slackConfigured: expect.any(Boolean) }),
          yeonjang: expect.objectContaining({ mqttEnabled: expect.any(Boolean), connectedExtensions: expect.any(Number) }),
        }),
        activeRuns: expect.objectContaining({ total: expect.any(Number), pendingApprovals: expect.any(Number) }),
      }))
      expect(typeof body.runtimeHealth.ai.provider === "string" || body.runtimeHealth.ai.provider === null).toBe(true)
      expect(JSON.stringify(body)).not.toMatch(/botToken|appToken|apiKey|secret|stack|raw|diagnostic/i)
    } finally {
      await app.close()
    }
  })

  it("reports admin availability from the explicit runtime flag only", async () => {
    process.env["NOBIE_ADMIN_UI"] = "1"
    reloadConfig()
    const app = Fastify({ logger: false })
    registerUiModeRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/ui/shell" })
      expect(response.statusCode).toBe(200)
      expect(response.json().mode).toEqual(expect.objectContaining({
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
