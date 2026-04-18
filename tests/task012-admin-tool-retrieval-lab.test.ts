import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAdminRoute } from "../packages/core/src/api/routes/admin.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { recordControlEvent } from "../packages/core/src/control-plane/timeline.ts"
import { closeDb, insertSession } from "../packages/core/src/db/index.js"
import { recordMessageLedgerEvent } from "../packages/core/src/runs/message-ledger.ts"
import { createRootRun } from "../packages/core/src/runs/store.ts"

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
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-admin-tool-lab-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_ADMIN_UI"] = "1"
  delete process.env["NOBIE_CONFIG"]
  delete process.env["NODE_ENV"]
  reloadConfig()
}

function restoreEnv(): void {
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
}

function seedRun(): { runId: string; requestGroupId: string; sessionKey: string } {
  const now = Date.now()
  const runId = "run-task012-tool-lab"
  const requestGroupId = "group-task012-tool-lab"
  const sessionKey = "session-task012-tool-lab"
  insertSession({
    id: sessionKey,
    source: "telegram",
    source_id: "chat-task012",
    created_at: now,
    updated_at: now,
    summary: "task012 admin tool lab session",
  })
  createRootRun({
    id: runId,
    sessionId: sessionKey,
    requestGroupId,
    prompt: "지금 코스피 지수 얼마야",
    source: "telegram",
  })
  return { runId, requestGroupId, sessionKey }
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreEnv()
})

describe("task012 admin tool calls and web retrieval lab", () => {
  it("shows tool calls with redacted params, approval state, result, duration, and retry count", async () => {
    const { runId, requestGroupId } = seedRun()
    recordMessageLedgerEvent({
      runId,
      eventKind: "tool_started",
      status: "started",
      summary: "web_fetch started",
      detail: { toolName: "web_fetch", params: { url: "https://www.google.com/finance/quote/KOSPI:KRX", apiKey: "sk-task012-secret-1234567890" } },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "approval_requested",
      status: "pending",
      summary: "web_fetch approval requested",
      detail: { toolName: "web_fetch" },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "approval_received",
      status: "succeeded",
      summary: "web_fetch approval approved",
      detail: { toolName: "web_fetch", decision: "approved" },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "tool_done",
      status: "succeeded",
      summary: "web_fetch done",
      detail: { toolName: "web_fetch", durationMs: 42, retryCount: 1, output: { text: "Bearer sk-task012-output-secret-1234567890 KOSPI 3085.42" } },
    })

    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: `/api/admin/tool-lab?requestGroupId=${encodeURIComponent(requestGroupId)}&limit=50` })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      const call = body.toolCalls.calls.find((item: any) => item.toolName === "web_fetch")
      expect(call).toEqual(expect.objectContaining({
        toolName: "web_fetch",
        status: "succeeded",
        approvalState: "approved",
        durationMs: 42,
        retryCount: 1,
      }))
      expect(JSON.stringify(call)).not.toMatch(/sk-task012|Bearer sk-/i)
      expect(call.redactionApplied).toBe(true)
    } finally {
      await app.close()
    }
  })

  it("tracks web retrieval source ladder, attempts, candidate extraction, completion checks, cache, and adapter metadata", async () => {
    const { runId, requestGroupId } = seedRun()
    recordMessageLedgerEvent({
      runId,
      eventKind: "tool_started",
      status: "started",
      summary: "web_search started",
      detail: { toolName: "web_search", params: { query: "지금 코스피 지수 얼마야" } },
    })
    recordMessageLedgerEvent({
      runId,
      eventKind: "tool_done",
      status: "succeeded",
      summary: "web_search done",
      detail: { toolName: "web_search", output: { source: "search_index", value: "3085.42" } },
    })
    recordControlEvent({
      eventType: "web_retrieval.source.checked",
      component: "web_retrieval",
      runId,
      requestGroupId,
      summary: "finance source checked",
      detail: {
        sourceEvidence: {
          method: "direct_fetch",
          sourceKind: "first_party",
          reliability: "high",
          sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX",
          sourceDomain: "www.google.com",
          sourceLabel: "KOSPI",
          sourceTimestamp: null,
          fetchTimestamp: "2026-04-17T05:55:24.000Z",
          freshnessPolicy: "latest_approximate",
          adapterId: "finance-index-known-source",
          adapterVersion: "2026.04.17",
          parserVersion: "finance-parser-1",
          adapterStatus: "active",
        },
      },
    })
    recordControlEvent({
      eventType: "web_retrieval.candidate.extracted",
      component: "web_retrieval",
      runId,
      requestGroupId,
      summary: "candidate extracted",
      detail: { candidateCount: 1, candidates: [{ normalizedValue: "3085.42", evidenceField: "quote_card" }] },
    })
    recordControlEvent({
      eventType: "web_retrieval.verification.completed",
      component: "web_retrieval",
      runId,
      requestGroupId,
      summary: "completion check passed",
      detail: {
        status: "ready",
        mustAvoidGuessing: false,
        verdict: {
          canAnswer: true,
          evidenceSufficiency: "sufficient_approximate",
          acceptedValue: "3085.42",
          rejectionReason: null,
          policy: "latest_approximate",
          conflicts: [],
        },
      },
    })

    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: `/api/admin/tool-lab?requestGroupId=${encodeURIComponent(requestGroupId)}&query=${encodeURIComponent("지금 코스피 지수 얼마야")}` })
      expect(response.statusCode).toBe(200)
      const session = response.json().webRetrieval.sessions[0]
      expect(session.sourceLadder.map((source: any) => source.sourceDomain)).toEqual(expect.arrayContaining(["www.google.com", "www.investing.com", "finance.naver.com"]))
      expect(session.queryVariants).toEqual(expect.arrayContaining(["지금 코스피 지수 얼마야", "https://www.google.com/finance/quote/KOSPI:KRX"]))
      expect(session.fetchAttempts.length).toBeGreaterThanOrEqual(1)
      expect(session.candidateExtraction).toEqual(expect.objectContaining({ candidateCount: 1 }))
      expect(session.verification).toEqual(expect.objectContaining({
        canAnswer: true,
        evidenceSufficiency: "sufficient_approximate",
        completionStrict: true,
        semanticComparisonAllowed: false,
        verificationMode: "contract_fields",
      }))
      expect(session.cache).toEqual(expect.objectContaining({ status: expect.any(String), entryCount: expect.any(Number) }))
      expect(session.adapterMetadata[0]).toEqual(expect.objectContaining({ adapterId: "finance-index-known-source", parserVersion: "finance-parser-1", checksum: expect.any(String) }))
      expect(session.policySeparation).toEqual({ discovery: "loose_search", completion: "strict_contract_fields", semanticComparisonAllowed: false })
    } finally {
      await app.close()
    }
  })

  it("replays web retrieval fixtures offline without semantic string checks", async () => {
    const app = Fastify({ logger: false })
    registerAdminRoute(app)
    await app.ready()
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/web-retrieval-fixtures/replay",
        payload: { fixtureIds: ["finance-kospi-latest", "finance-nasdaq-browser-timeout-fallback", "weather-dongcheon-partial"] },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.networkUsed).toBe(false)
      expect(body.semanticComparisonAllowed).toBe(false)
      expect(body.verificationMode).toBe("contract_fields")
      expect(body.fixtureCount).toBe(3)
      expect(body.summary.status).toBe("passed")
      expect(body.results.map((result: any) => result.fixtureId)).toEqual(["finance-kospi-latest", "finance-nasdaq-browser-timeout-fallback", "weather-dongcheon-partial"])
      expect(JSON.stringify(body)).not.toMatch(/semantic_match|embedding_judge|llm_judge/i)
    } finally {
      await app.close()
    }
  })
})
