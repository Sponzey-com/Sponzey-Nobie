import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAdminRoute } from "../packages/core/src/api/routes/admin.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { PATHS } from "../packages/core/src/config/paths.js"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.js"
import { resolveAdminUiActivation } from "../packages/core/src/ui/mode.ts"

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
const previousAdminUiSource = process.env["NOBIE_ADMIN_UI_SOURCE"]
const previousLocalDevAdminUi = process.env["NOBIE_LOCAL_DEV_ADMIN_UI"]
const previousNodeEnv = process.env["NODE_ENV"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-admin-guard-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  delete process.env["NOBIE_ADMIN_UI"]
  delete process.env["NOBIE_ADMIN_UI_SOURCE"]
  delete process.env["NOBIE_LOCAL_DEV_ADMIN_UI"]
  delete process.env["NODE_ENV"]
  reloadConfig()
}

function writeConfig(value: unknown): void {
  mkdirSync(dirname(PATHS.configFile), { recursive: true })
  writeFileSync(PATHS.configFile, JSON.stringify(value, null, 2), "utf-8")
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
  if (previousAdminUiSource === undefined) delete process.env["NOBIE_ADMIN_UI_SOURCE"]
  else process.env["NOBIE_ADMIN_UI_SOURCE"] = previousAdminUiSource
  if (previousLocalDevAdminUi === undefined) delete process.env["NOBIE_LOCAL_DEV_ADMIN_UI"]
  else process.env["NOBIE_LOCAL_DEV_ADMIN_UI"] = previousLocalDevAdminUi
  if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]
  else process.env["NODE_ENV"] = previousNodeEnv
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task009 admin activation and guard", () => {
  it("resolves admin activation from env, CLI, local script, and production config gate", () => {
    expect(resolveAdminUiActivation({ env: {}, argv: [], configEnabled: false, nodeEnv: "development" })).toEqual(expect.objectContaining({
      enabled: false,
      reason: "disabled",
    }))

    expect(resolveAdminUiActivation({ env: { NOBIE_ADMIN_UI: "1" }, argv: [], configEnabled: false, nodeEnv: "development" })).toEqual(expect.objectContaining({
      enabled: true,
      envEnabled: true,
      reason: "enabled_by_runtime_flag",
    }))

    expect(resolveAdminUiActivation({ env: {}, argv: ["nobie", "serve", "--admin-ui"], configEnabled: false, nodeEnv: "development" })).toEqual(expect.objectContaining({
      enabled: true,
      cliEnabled: true,
      reason: "enabled_by_runtime_flag",
    }))

    expect(resolveAdminUiActivation({ env: { NOBIE_ADMIN_UI: "1", NOBIE_ADMIN_UI_SOURCE: "local-script" }, argv: [], configEnabled: false, nodeEnv: "development" })).toEqual(expect.objectContaining({
      enabled: true,
      localDevScriptEnabled: true,
      reason: "enabled_by_local_dev_script",
    }))

    expect(resolveAdminUiActivation({ env: { NOBIE_ADMIN_UI: "1" }, argv: [], configEnabled: false, nodeEnv: "production" })).toEqual(expect.objectContaining({
      enabled: false,
      productionMode: true,
      reason: "blocked_by_production_config_gate",
    }))

    expect(resolveAdminUiActivation({ env: { NOBIE_ADMIN_UI: "1" }, argv: [], configEnabled: true, nodeEnv: "production" })).toEqual(expect.objectContaining({
      enabled: true,
      productionMode: true,
      reason: "enabled_by_config_and_runtime_flag",
    }))
  })

  it("blocks admin API by default and records a diagnostic event", async () => {
    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/admin/runtime" })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual(expect.objectContaining({ ok: false, error: "admin_ui_disabled" }))
      const event = getDb()
        .prepare<[], { kind: string; summary: string; detail_json: string }>("SELECT kind, summary, detail_json FROM diagnostic_events WHERE kind = 'admin.guard.denied' ORDER BY created_at DESC LIMIT 1")
        .get()
      expect(event).toEqual(expect.objectContaining({ kind: "admin.guard.denied" }))
      expect(event?.summary).toContain("Admin API access denied")
      expect(event?.detail_json).toContain("/api/admin/runtime")
    } finally {
      await app.close()
    }
  })

  it("opens admin API only when the explicit runtime flag is enabled", async () => {
    process.env["NOBIE_ADMIN_UI"] = "1"
    reloadConfig()
    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/admin/runtime" })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(expect.objectContaining({
        ok: true,
        mode: expect.objectContaining({ adminEnabled: true, availableModes: ["beginner", "advanced", "admin"] }),
        manifest: expect.objectContaining({ adminUi: expect.objectContaining({ enabled: true }) }),
      }))
    } finally {
      await app.close()
    }
  })

  it("keeps production admin API closed until config and runtime flag are both enabled", async () => {
    process.env["NODE_ENV"] = "production"
    process.env["NOBIE_ADMIN_UI"] = "1"
    reloadConfig()
    const blockedApp = Fastify({ logger: false })
    registerAdminRoute(blockedApp)
    await blockedApp.ready()
    try {
      const blocked = await blockedApp.inject({ method: "GET", url: "/api/admin/runtime" })
      expect(blocked.statusCode).toBe(403)
    } finally {
      await blockedApp.close()
    }

    writeConfig({ webui: { admin: { enabled: true } } })
    const enabledApp = Fastify({ logger: false })
    registerAdminRoute(enabledApp)
    await enabledApp.ready()
    try {
      const enabled = await enabledApp.inject({ method: "GET", url: "/api/admin/runtime" })
      expect(enabled.statusCode).toBe(200)
      expect(enabled.json().manifest.adminUi).toEqual(expect.objectContaining({
        enabled: true,
        configEnabled: true,
        runtimeFlagEnabled: true,
        productionMode: true,
      }))
    } finally {
      await enabledApp.close()
    }
  })

  it("adds a doctor blocked warning when admin UI is enabled on a remote unauthenticated host", () => {
    process.env["NOBIE_ADMIN_UI"] = "1"
    writeConfig({
      webui: {
        host: "0.0.0.0",
        auth: { enabled: false },
        admin: { enabled: true },
      },
    })

    const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const adminCheck = report.checks.find((check) => check.name === "admin.ui")
    expect(adminCheck).toEqual(expect.objectContaining({
      status: "blocked",
      message: expect.stringContaining("Admin UI"),
    }))
    expect(adminCheck?.detail).toEqual(expect.objectContaining({
      enabled: true,
      host: "0.0.0.0",
      authEnabled: false,
    }))
  })
})
