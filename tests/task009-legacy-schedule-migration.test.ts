import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerSchedulesRoute } from "../packages/core/src/api/routes/schedules.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getDb,
  getSchedule,
  insertSchedule,
  isLegacySchedule,
} from "../packages/core/src/db/index.js"
import {
  applyLegacyScheduleMigration,
  dryRunLegacyScheduleMigration,
  listLegacyScheduleMigrationItems,
} from "../packages/core/src/schedules/legacy-migration.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string }): Promise<{ statusCode: number; json(): unknown }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task009-legacy-schedule-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function insertLegacySchedule(id: string, overrides: Partial<Parameters<typeof insertSchedule>[0]> = {}): void {
  const now = Date.parse("2026-04-15T00:00:00.000Z")
  insertSchedule({
    id,
    name: `TASK009 ${id}`,
    cron_expression: "0 9 * * *",
    timezone: "Asia/Seoul",
    prompt: "매일 오전 9시에 알림이라고 보내줘",
    enabled: 1,
    target_channel: "telegram",
    target_session_id: "telegram:42120565",
    execution_driver: "internal",
    origin_run_id: "run-task009",
    origin_request_group_id: "group-task009",
    model: null,
    max_retries: 3,
    timeout_sec: 300,
    created_at: now,
    updated_at: now,
    ...overrides,
  })
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
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task009 legacy schedule migration", () => {
  it("lists legacy schedules with conversion risk without mutating rows", () => {
    insertLegacySchedule("schedule-task009-list")

    const items = listLegacyScheduleMigrationItems()
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scheduleId: "schedule-task009-list",
        legacy: true,
        convertible: true,
        risk: "low",
      }),
    ]))

    const row = getSchedule("schedule-task009-list")
    expect(row && isLegacySchedule(row)).toBe(true)
    expect(row?.contract_json).toBeNull()
  })

  it("returns dry-run contract and stable keys before opt-in conversion", () => {
    insertLegacySchedule("schedule-task009-dry-run")

    const report = dryRunLegacyScheduleMigration("schedule-task009-dry-run")
    expect(report?.convertible).toBe(true)
    expect(report?.contract?.payload.kind).toBe("literal_message")
    expect(report?.persistence?.identityKey).toMatch(/^schedule:v1:/)
    expect(report?.persistence?.payloadHash).toMatch(/^payload:v1:/)
    expect(report?.persistence?.deliveryKey).toMatch(/^delivery:v1:/)

    const row = getSchedule("schedule-task009-dry-run")
    expect(row && isLegacySchedule(row)).toBe(true)
  })

  it("converts only the selected legacy schedule and records audit", () => {
    insertLegacySchedule("schedule-task009-convert")
    insertLegacySchedule("schedule-task009-other")

    const result = applyLegacyScheduleMigration("schedule-task009-convert")
    expect(result.ok).toBe(true)

    const converted = getSchedule("schedule-task009-convert")
    expect(converted && isLegacySchedule(converted)).toBe(false)
    expect(converted?.contract_json).toContain("literal_message")
    expect(converted?.identity_key).toMatch(/^schedule:v1:/)
    expect(converted?.payload_hash).toMatch(/^payload:v1:/)
    expect(converted?.delivery_key).toMatch(/^delivery:v1:/)

    const untouched = getSchedule("schedule-task009-other")
    expect(untouched && isLegacySchedule(untouched)).toBe(true)

    const auditCount = getDb()
      .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE tool_name = 'legacy_schedule_contract_migration' AND result = 'success'")
      .get()?.n ?? 0
    expect(auditCount).toBe(1)
  })

  it("keeps blocked conversion as legacy and exposes API list/dry-run/convert routes", async () => {
    insertLegacySchedule("schedule-task009-invalid", { cron_expression: "bad cron" })
    const app = Fastify({ logger: false })
    registerSchedulesRoute(app)
    await app.ready()
    try {
      const list = await app.inject({ method: "GET", url: "/api/schedules/legacy" })
      expect(list.statusCode).toBe(200)
      expect(list.json().schedules).toEqual(expect.arrayContaining([
        expect.objectContaining({ scheduleId: "schedule-task009-invalid", convertible: false, risk: "blocked" }),
      ]))

      const dryRun = await app.inject({ method: "POST", url: "/api/schedules/schedule-task009-invalid/legacy/dry-run" })
      expect(dryRun.statusCode).toBe(200)
      expect(dryRun.json()).toEqual(expect.objectContaining({ convertible: false, status: "blocked" }))

      const convert = await app.inject({ method: "POST", url: "/api/schedules/schedule-task009-invalid/legacy/convert" })
      expect(convert.statusCode).toBe(409)
      expect(convert.json()).toEqual(expect.objectContaining({ ok: false }))
    } finally {
      await app.close()
    }

    const row = getSchedule("schedule-task009-invalid")
    expect(row && isLegacySchedule(row)).toBe(true)
    expect(row?.contract_json).toBeNull()
  })
})
