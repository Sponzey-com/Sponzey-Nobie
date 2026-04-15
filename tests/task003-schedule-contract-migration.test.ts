import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getDb,
  getSchedule,
  insertSchedule,
  isLegacySchedule,
  prepareScheduleContractPersistence,
} from "../packages/core/src/db/index.ts"
import { runMigrations } from "../packages/core/src/db/migrations.ts"
import {
  CONTRACT_SCHEMA_VERSION,
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  toCanonicalJson,
  type ScheduleContract,
} from "../packages/core/src/index.ts"

type SqliteStatement = {
  run(...args: unknown[]): unknown
  all(): unknown[]
}

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

type BetterSqlite3Factory = new (filename: string) => SqliteDatabase

const require = createRequire(import.meta.url)
const BetterSqlite3 = require("../packages/core/node_modules/better-sqlite3") as BetterSqlite3Factory

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task003-schedule-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function scheduleContract(overrides: Partial<ScheduleContract> = {}): ScheduleContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: "recurring",
    time: {
      cron: "0 9 * * *",
      timezone: "Asia/Seoul",
      missedPolicy: "next_only",
    },
    payload: {
      kind: "literal_message",
      literalText: "알림",
    },
    delivery: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      mode: "channel_message",
      channel: "telegram",
      sessionId: "telegram:42120565",
      threadId: "main",
    },
    source: {
      originRunId: "run-task003",
      originRequestGroupId: "group-task003",
    },
    displayName: "아침 알림",
    rawText: "매일 오전 9시에 알림이라고 보내줘",
    ...overrides,
  }
}

function insertBaseSchedule(id: string, contract?: ScheduleContract): void {
  const now = Date.parse("2026-04-15T00:00:00.000Z")
  insertSchedule({
    id,
    name: `TASK003 ${id}`,
    cron_expression: "0 9 * * *",
    timezone: "Asia/Seoul",
    prompt: "매일 오전 9시에 알림이라고 보내줘",
    enabled: 1,
    target_channel: "telegram",
    target_session_id: "telegram:42120565",
    execution_driver: "internal",
    origin_run_id: "run-task003",
    origin_request_group_id: "group-task003",
    model: null,
    max_retries: 3,
    timeout_sec: 300,
    ...(contract ? { contract } : {}),
    created_at: now,
    updated_at: now,
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

describe("task003 schedule contract migration", () => {
  it("adds schedule contract columns on fresh and legacy schemas idempotently", () => {
    const freshColumns = getDb().prepare("PRAGMA table_info(schedules)").all() as Array<{ name: string }>
    expect(freshColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "contract_json",
      "identity_key",
      "payload_hash",
      "delivery_key",
      "contract_schema_version",
    ]))

    const legacyDb = new BetterSqlite3(":memory:")
    try {
      legacyDb.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        CREATE TABLE schedules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          cron_expression TEXT NOT NULL,
          timezone TEXT,
          prompt TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          target_channel TEXT DEFAULT 'telegram',
          target_session_id TEXT,
          execution_driver TEXT DEFAULT 'internal',
          origin_run_id TEXT,
          origin_request_group_id TEXT,
          model TEXT,
          max_retries INTEGER DEFAULT 3,
          timeout_sec INTEGER DEFAULT 300,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
      const insertMigration = legacyDb.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      for (let version = 1; version <= 21; version += 1) insertMigration.run(version, 1)

      runMigrations(legacyDb)
      runMigrations(legacyDb)

      const columns = legacyDb.prepare("PRAGMA table_info(schedules)").all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "contract_json",
        "identity_key",
        "payload_hash",
        "delivery_key",
        "contract_schema_version",
      ]))
    } finally {
      legacyDb.close()
    }
  })

  it("stores validated contract json and stable keys for new schedules", () => {
    const contract = scheduleContract()
    insertBaseSchedule("schedule-contract-task003", contract)

    const row = getSchedule("schedule-contract-task003")
    expect(row?.contract_json).toBe(toCanonicalJson(contract))
    expect(row?.identity_key).toBe(buildScheduleIdentityKey(contract))
    expect(row?.payload_hash).toBe(buildPayloadHash(contract.payload))
    expect(row?.delivery_key).toBe(buildDeliveryKey(contract.delivery))
    expect(row?.contract_schema_version).toBe(CONTRACT_SCHEMA_VERSION)
    expect(row?.legacy).toBe(0)
    expect(row && isLegacySchedule(row)).toBe(false)
  })

  it("stores literal, agent, and tool payload contracts with stable fields", () => {
    const cases: Array<[string, ScheduleContract["payload"]]> = [
      ["literal", { kind: "literal_message", literalText: "알림" }],
      ["agent", { kind: "agent_task", literalText: "메일 정리하고 요약해줘" }],
      ["tool", { kind: "tool_task", toolName: "screen_capture", toolParams: { display: 1 } }],
    ]

    for (const [suffix, payload] of cases) {
      const contract = scheduleContract({
        payload,
        displayName: `TASK003 ${suffix}`,
        rawText: `${suffix} payload 저장`,
      })
      insertBaseSchedule(`schedule-${suffix}-payload-task003`, contract)

      const row = getSchedule(`schedule-${suffix}-payload-task003`)
      expect(row?.contract_json).toBe(toCanonicalJson(contract))
      expect(row?.identity_key).toBe(buildScheduleIdentityKey(contract))
      expect(row?.payload_hash).toBe(buildPayloadHash(payload))
      expect(row?.delivery_key).toBe(buildDeliveryKey(contract.delivery))
      expect(row?.contract_schema_version).toBe(CONTRACT_SCHEMA_VERSION)
      expect(row?.legacy).toBe(0)
    }
  })

  it("keeps schedules without contracts as legacy-compatible rows", () => {
    insertBaseSchedule("schedule-legacy-task003")

    const row = getSchedule("schedule-legacy-task003")
    expect(row?.contract_json).toBeNull()
    expect(row?.identity_key).toBeNull()
    expect(row?.payload_hash).toBeNull()
    expect(row?.delivery_key).toBeNull()
    expect(row?.contract_schema_version).toBeNull()
    expect(row?.legacy).toBe(1)
    expect(row && isLegacySchedule(row)).toBe(true)
  })

  it("rejects invalid contracts before inserting a schedule row", () => {
    const invalidContract = scheduleContract({ kind: "bad" as ScheduleContract["kind"] })
    expect(() => prepareScheduleContractPersistence(invalidContract)).toThrow("실행 계약")
    expect(() => insertBaseSchedule("schedule-invalid-contract-task003", invalidContract)).toThrow("실행 계약")
    expect(getSchedule("schedule-invalid-contract-task003")).toBeUndefined()
  })
})

