import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, insertSession, listControlEvents, listMessageLedgerEvents } from "../packages/core/src/db/index.js"
import {
  buildWebRetrievalPolicyDecision,
  evaluateSourceReliabilityGuard,
  recordBrowserSearchEvidence,
} from "../packages/core/src/runs/web-retrieval-policy.js"
import { createRootRun } from "../packages/core/src/runs/store.js"
import { ToolDispatcher } from "../packages/core/src/tools/dispatcher.js"
import { webFetchTool } from "../packages/core/src/tools/builtin/web-fetch.js"
import type { ToolContext } from "../packages/core/src/tools/types.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const originalFetch = globalThis.fetch
const tempDirs: string[] = []

function useTempConfig(prefix = "nobie-task010-web-"): string {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    memory: { searchMode: "fts", sessionRetentionDays: 30 },
    scheduler: { enabled: false, timezone: "Asia/Seoul" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
  return stateDir
}

function createTestRun(id = "run-web-policy-1") {
  insertSession({
    id: "session-web-policy",
    source: "telegram",
    source_id: "chat-1",
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: null,
  })
  return createRootRun({
    id,
    sessionId: "session-web-policy",
    requestGroupId: "request-web-policy",
    prompt: "지금 동천동 날씨 어때?",
    source: "telegram",
  })
}

function buildToolContext(run: ReturnType<typeof createTestRun>, userMessage = "지금 동천동 날씨 어때?"): ToolContext {
  return {
    sessionId: run.sessionId,
    runId: run.id,
    requestGroupId: run.requestGroupId,
    workDir: process.cwd(),
    userMessage,
    source: "telegram",
    allowWebAccess: true,
    onProgress: () => undefined,
    signal: new AbortController().signal,
  }
}

beforeEach(() => {
  useTempConfig()
})

afterEach(() => {
  globalThis.fetch = originalFetch
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

describe("task010 web retrieval policy", () => {
  it("dedupes equivalent web_fetch URLs and records skipped ledger/control events", async () => {
    const run = createTestRun("run-web-dedupe")
    const dispatcher = new ToolDispatcher()
    let executionCount = 0
    dispatcher.register({
      name: "web_fetch",
      description: "test fetch",
      parameters: { type: "object", properties: {} },
      riskLevel: "safe",
      requiresApproval: false,
      async execute() {
        executionCount += 1
        return { success: true, output: `fetch-${executionCount}` }
      },
    })
    const ctx = buildToolContext(run)

    const first = await dispatcher.dispatch("web_fetch", { url: "https://example.com/weather?b=2&utm_source=x&a=1#top" }, ctx)
    const duplicate = await dispatcher.dispatch("web_fetch", { url: "https://EXAMPLE.com/weather?a=1&b=2&utm_medium=y" }, ctx)
    const ledgerEvents = listMessageLedgerEvents({ requestGroupId: run.requestGroupId })
    const controlEvents = listControlEvents({ requestGroupId: run.requestGroupId })

    expect(first.output).toBe("fetch-1")
    expect(duplicate.success).toBe(true)
    expect(duplicate.output).toContain("중복 호출을 생략")
    expect(duplicate.output).toContain("dedupeKey=web:fetch:")
    expect(executionCount).toBe(1)
    expect(ledgerEvents.some((event) => event.event_kind === "tool_skipped" && event.status === "skipped")).toBe(true)
    expect(controlEvents.some((event) => event.event_type === "tool.skipped")).toBe(true)
  })

  it("keeps timestamp-less strict-policy evidence as limited success instead of guessing", () => {
    const guard = evaluateSourceReliabilityGuard({
      method: "direct_fetch",
      sourceKind: "third_party",
      reliability: "medium",
      sourceUrl: "https://example.com/current",
      sourceDomain: "example.com",
      sourceTimestamp: null,
      fetchTimestamp: "2026-04-17T00:00:00.000Z",
      freshnessPolicy: "strict_timestamp",
    })

    expect(guard.status).toBe("limited_success")
    expect(guard.mustAvoidGuessing).toBe(true)
    expect(guard.userMessage).toContain("기준 시각")
  })

  it("allows timestamp-less live quote direct fetch as collection-time approximate latest by source contract", () => {
    const policy = buildWebRetrievalPolicyDecision({
      toolName: "web_fetch",
      params: { url: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ" },
      userMessage: "지금 나스닥 지수는 얼마야?",
      now: new Date("2026-04-17T05:55:24.000Z"),
    })
    const guard = evaluateSourceReliabilityGuard({
      method: policy?.method ?? "direct_fetch",
      sourceKind: policy?.sourceKind ?? "first_party",
      reliability: policy?.reliability ?? "high",
      sourceUrl: "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
      sourceDomain: "www.google.com",
      sourceTimestamp: null,
      fetchTimestamp: policy?.fetchTimestamp ?? "2026-04-17T05:55:24.000Z",
      freshnessPolicy: policy?.freshnessPolicy ?? "normal",
    })

    expect(policy?.freshnessPolicy).toBe("latest_approximate")
    expect(policy?.answerDirective).toContain("수집 시각 기준 근사값")
    expect(policy?.answerDirective).toContain("근사 허용은 추정 허용이 아닙니다")
    expect(policy?.answerDirective).toContain("다른 티커")
    expect(guard.status).toBe("approximate_latest")
    expect(guard.mustAvoidGuessing).toBe(false)
  })

  it("keeps web_search as discovery without natural-language policy gating", () => {
    const policy = buildWebRetrievalPolicyDecision({
      toolName: "web_search",
      params: { query: "오늘 코스피 지수 얼마야?", maxResults: 5 },
      userMessage: "오늘 코스피 지수 얼마야?",
      now: new Date("2026-04-17T05:34:32.000Z"),
    })
    const guard = evaluateSourceReliabilityGuard({
      method: policy?.method ?? "fast_text_search",
      sourceKind: policy?.sourceKind ?? "search_index",
      reliability: policy?.reliability ?? "medium",
      sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX",
      sourceDomain: "www.google.com",
      sourceTimestamp: null,
      fetchTimestamp: policy?.fetchTimestamp ?? "2026-04-17T05:34:32.000Z",
      freshnessPolicy: policy?.freshnessPolicy ?? "normal",
    })

    expect(policy?.freshnessPolicy).toBe("latest_approximate")
    expect(policy?.answerDirective).not.toContain("민감/최신성")
    expect(policy?.answerDirective).not.toContain("코스피")
    expect(policy?.answerDirective).toContain("요청 대상과 같은 출처 항목")
    expect(policy?.answerDirective).toContain("web_search는 발견 단계")
    expect(policy?.answerDirective).toContain("web_fetch로 최소 1회 확인")
    expect(guard.status).toBe("approximate_latest")
    expect(guard.mustAvoidGuessing).toBe(false)
  })

  it("allows browser evidence as collection-time approximate latest by source policy", () => {
    const guard = evaluateSourceReliabilityGuard({
      method: "browser_search",
      sourceKind: "browser_evidence",
      reliability: "medium",
      sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX",
      sourceDomain: "www.google.com",
      sourceTimestamp: null,
      fetchTimestamp: "2026-04-17T05:34:32.000Z",
      freshnessPolicy: "latest_approximate",
    })

    expect(guard.status).toBe("approximate_latest")
    expect(guard.mustAvoidGuessing).toBe(false)
    expect(guard.userMessage).toContain("근사값")
  })

  it("does not relax timestamp requirements for explicit strict timestamp evidence", () => {
    const guard = evaluateSourceReliabilityGuard({
      method: "fast_text_search",
      sourceKind: "search_index",
      reliability: "medium",
      sourceUrl: "https://example.com/latest",
      sourceDomain: "example.com",
      sourceTimestamp: null,
      fetchTimestamp: "2026-04-17T05:34:32.000Z",
      freshnessPolicy: "strict_timestamp",
    })

    expect(guard.status).toBe("limited_success")
    expect(guard.mustAvoidGuessing).toBe(true)
  })

  it("stores browser search evidence as an artifact and diagnostic event without raw stack text", () => {
    const result = recordBrowserSearchEvidence({
      query: "동천동 날씨",
      url: "https://lite.duckduckgo.com/lite/?q=%EB%8F%99%EC%B2%9C%EB%8F%99%20%EB%82%A0%EC%94%A8",
      extractedText: "partial html text",
      timeoutReason: "timeout",
      error: new Error("Selenium timeout\n    at secretStack (/Users/example/private/file.js:1:1)"),
      runId: "run-browser-evidence",
      requestGroupId: "request-browser-evidence",
    })

    const payload = readFileSync(result.artifactPath, "utf-8")
    const diagnostic = getDb()
      .prepare<[], { kind: string; summary: string }>("SELECT kind, summary FROM diagnostic_events ORDER BY created_at DESC LIMIT 1")
      .get()

    expect(existsSync(result.artifactPath)).toBe(true)
    expect(result.artifactId).toEqual(expect.any(String))
    expect(result.diagnosticEventId).toEqual(expect.any(String))
    expect(payload).toContain("browser_search_evidence")
    expect(payload).not.toContain("secretStack")
    expect(diagnostic?.kind).toBe("browser_search_evidence")
  })

  it("adds source timestamps and reliability guard details to web_fetch output", async () => {
    const run = createTestRun("run-web-fetch-ready")
    const html = `<!doctype html><html><head><meta property="article:published_time" content="2026-04-17T09:30:00+09:00"></head><body><article><h1>동천동 날씨</h1><p>현재 20도입니다.</p></article></body></html>`
    globalThis.fetch = vi.fn(async () => new Response(html, { status: 200, statusText: "OK" })) as unknown as typeof fetch

    const result = await webFetchTool.execute({ url: "https://weather.example/current" }, buildToolContext(run))
    const details = result.details as { sourceGuard: { status: string }; sourceEvidence: { sourceTimestamp: string | null } }

    expect(result.success).toBe(true)
    expect(result.output).toContain("[출처 시각: 2026-04-17T09:30:00+09:00]")
    expect(details.sourceGuard.status).toBe("ready")
    expect(details.sourceEvidence.sourceTimestamp).toBe("2026-04-17T09:30:00+09:00")
  })

  it("completes strict timestamp fetch without source timestamp as limited success", async () => {
    const run = createTestRun("run-web-fetch-limited")
    const html = "<!doctype html><html><body><main><h1>Current page</h1><p>Current data page.</p></main></body></html>"
    globalThis.fetch = vi.fn(async () => new Response(html, { status: 200, statusText: "OK" })) as unknown as typeof fetch

    const result = await webFetchTool.execute({ url: "https://example.com/current", freshnessPolicy: "strict_timestamp" }, buildToolContext(run, "현재 값을 확인해줘"))
    const details = result.details as { sourceGuard: { status: string; mustAvoidGuessing: boolean } }

    expect(result.success).toBe(true)
    expect(result.output).toContain("[출처 시각: 확인 불가]")
    expect(result.output).toContain("[최신성 정책: strict_timestamp]")
    expect(result.output).toContain("[확정성: limited_success")
    expect(details.sourceGuard.status).toBe("limited_success")
    expect(details.sourceGuard.mustAvoidGuessing).toBe(true)
  })
})
