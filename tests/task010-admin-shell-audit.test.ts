import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAdminRoute } from "../packages/core/src/api/routes/admin.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.js"
import { buildAdminShellView } from "../packages/webui/src/lib/admin-shell.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousAdminUi = process.env["NOBIE_ADMIN_UI"]
const previousConfig = process.env["NOBIE_CONFIG"]
const previousNodeEnv = process.env["NODE_ENV"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-admin-shell-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  delete process.env["NOBIE_ADMIN_UI"]
  delete process.env["NODE_ENV"]
  reloadConfig()
}

function enableAdminUi(): void {
  process.env["NOBIE_ADMIN_UI"] = "1"
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousAdminUi === undefined) delete process.env["NOBIE_ADMIN_UI"]
  else process.env["NOBIE_ADMIN_UI"] = previousAdminUi
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]
  else process.env["NODE_ENV"] = previousNodeEnv
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task010 admin shell, dangerous actions, and audit", () => {
  it("builds an admin shell view with warning badges and confirmation phrases", () => {
    const view = buildAdminShellView({ language: "ko", adminEnabled: true, subscriptionCount: 2 })

    expect(view.warning).toContain("개발자용")
    expect(view.badges).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "ADMIN 활성", tone: "danger" }),
      expect.objectContaining({ label: "구독 2" }),
    ]))
    expect(view.actions.map((action) => action.requiredConfirmation)).toEqual([
      "CONFIRM RETRY",
      "CONFIRM PURGE",
      "CONFIRM REPLAY",
      "CONFIRM EXPORT",
    ])
    expect(JSON.stringify(view)).not.toMatch(/raw|runId|requestGroupId|stack trace/i)
  })

  it("blocks admin shell by default and writes guard diagnostic plus audit", async () => {
    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/admin/shell" })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual(expect.objectContaining({ ok: false, error: "admin_ui_disabled" }))

      const audit = getDb()
        .prepare<[], { tool_name: string; result: string; error_code: string }>("SELECT tool_name, result, error_code FROM audit_logs WHERE tool_name = 'admin.guard' ORDER BY timestamp DESC LIMIT 1")
        .get()
      expect(audit).toEqual(expect.objectContaining({ tool_name: "admin.guard", result: "blocked", error_code: "admin_ui_disabled" }))

      const diagnostic = getDb()
        .prepare<[], { kind: string }>("SELECT kind FROM diagnostic_events WHERE kind = 'admin.guard.denied' ORDER BY created_at DESC LIMIT 1")
        .get()
      expect(diagnostic).toEqual({ kind: "admin.guard.denied" })
    } finally {
      await app.close()
    }
  })

  it("exposes admin shell state and subscription count through API and doctor", async () => {
    enableAdminUi()
    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/admin/shell" })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(expect.objectContaining({
        ok: true,
        shell: expect.objectContaining({
          kind: "admin_shell",
          auditRequired: true,
          subscriptions: { webSocketClients: 0 },
          dangerousActions: expect.arrayContaining([
            expect.objectContaining({ id: "purge", requiredConfirmation: "CONFIRM PURGE", auditRequired: true }),
          ]),
        }),
        manifest: expect.objectContaining({ adminUi: expect.objectContaining({ enabled: true, subscriptionCount: 0 }) }),
      }))

      const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
      const adminCheck = report.checks.find((check) => check.name === "admin.ui")
      expect(adminCheck?.detail).toEqual(expect.objectContaining({ enabled: true, subscriptionCount: 0 }))
    } finally {
      await app.close()
    }
  })

  it("requires explicit confirmation before dangerous admin actions and redacts audit params", async () => {
    enableAdminUi()
    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const blocked = await app.inject({
        method: "POST",
        url: "/api/admin/actions",
        payload: {
          action: "purge",
          targetId: "history",
          reason: "cleanup Bearer sk-task010-secret-1234567890",
          params: { apiKey: "sk-task010-api-secret-1234567890", nested: { token: "xoxb-task010-secret-1234567890" } },
        },
      })
      expect(blocked.statusCode).toBe(409)
      expect(blocked.json()).toEqual(expect.objectContaining({
        ok: false,
        error: "admin_action_confirmation_required",
        status: "needs_confirmation",
        requiredConfirmation: "CONFIRM PURGE",
      }))

      const blockedAudit = getDb()
        .prepare<[], { result: string; approval_required: number; approved_by: string | null; error_code: string; params: string; output: string }>("SELECT result, approval_required, approved_by, error_code, params, output FROM audit_logs WHERE tool_name = 'admin.action.purge' ORDER BY timestamp DESC LIMIT 1")
        .get()
      expect(blockedAudit).toEqual(expect.objectContaining({ result: "blocked", approval_required: 1, approved_by: null, error_code: "confirmation_required" }))
      expect(`${blockedAudit?.params} ${blockedAudit?.output}`).not.toMatch(/sk-task010|xoxb-task010|Bearer sk-/i)

      const accepted = await app.inject({
        method: "POST",
        url: "/api/admin/actions",
        payload: { action: "purge", targetId: "history", confirmation: "CONFIRM PURGE", reason: "operator confirmed" },
      })
      expect(accepted.statusCode).toBe(202)
      expect(accepted.json()).toEqual(expect.objectContaining({ ok: true, action: "purge", status: "accepted" }))

      const acceptedAudit = getDb()
        .prepare<[], { result: string; approval_required: number; approved_by: string | null; error_code: string | null }>("SELECT result, approval_required, approved_by, error_code FROM audit_logs WHERE tool_name = 'admin.action.purge' ORDER BY timestamp DESC LIMIT 1")
        .get()
      expect(acceptedAudit).toEqual(expect.objectContaining({ result: "accepted", approval_required: 1, approved_by: "explicit_confirmation", error_code: null }))
    } finally {
      await app.close()
    }
  })
})
