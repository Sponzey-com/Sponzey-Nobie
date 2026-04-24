import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Fastify from "../packages/core/node_modules/fastify/fastify.js"
import type { SubAgentResultReview } from "../packages/core/src/agent/sub-agent-result-review.ts"
import { registerDataExchangeRoutes } from "../packages/core/src/api/routes/data-exchanges.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  DataExchangePackage,
  ExpectedOutputContract,
  OwnerScope,
  ResultReport,
  RuntimeIdentity,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { closeDb, listControlEvents } from "../packages/core/src/db/index.js"
import {
  MemoryIsolationError,
  assertMemoryAccessAllowed,
  buildDataExchangeAdminRawView,
  buildDataExchangeSanitizedView,
  createDataExchangePackage,
  getDataExchangePackage,
  inspectDataExchangePayloadRisk,
  listActiveDataExchangePackagesForRecipient,
  persistDataExchangePackage,
  validateDataExchangePackage,
} from "../packages/core/src/memory/isolation.ts"
import { buildFeedbackLoopPackage } from "../packages/core/src/orchestration/feedback-loop.ts"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 20, 0, 0, 0)
const dayMs = 24 * 60 * 60 * 1_000

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task018-data-exchange-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = undefined
  reloadConfig()
}

function restoreState(): void {
  closeDb()
  if (previousStateDir === undefined) process.env.NOBIE_STATE_DIR = undefined
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) process.env.NOBIE_CONFIG = undefined
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

function owner(ownerType: OwnerScope["ownerType"], ownerId: string): OwnerScope {
  return { ownerType, ownerId }
}

function identity(
  entityType: RuntimeIdentity["entityType"],
  entityId: string,
  identityOwner: OwnerScope,
): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: identityOwner,
    idempotencyKey: `idempotency:${entityId}`,
    parent: { parentRunId: "run:task018" },
  }
}

function baseExchange(
  overrides: Partial<Parameters<typeof createDataExchangePackage>[0]> = {},
): DataExchangePackage {
  return createDataExchangePackage({
    sourceOwner: owner("nobie", "agent:nobie"),
    recipientOwner: owner("sub_agent", "agent:researcher"),
    sourceNicknameSnapshot: "Nobie",
    recipientNicknameSnapshot: "Researcher",
    purpose: "Share bounded task context.",
    allowedUse: "temporary_context",
    retentionPolicy: "session_only",
    redactionState: "not_sensitive",
    provenanceRefs: ["result:task018", "memory:coordinator"],
    payload: { summary: "safe summary" },
    exchangeId: `exchange:task018:${Math.random().toString(36).slice(2)}`,
    idempotencyKey: `exchange:task018:${Math.random().toString(36).slice(2)}`,
    now: () => now,
    ...overrides,
  })
}

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false })
  registerDataExchangeRoutes(app)
  await app.ready()
  try {
    await run(app)
  } finally {
    await app.close()
  }
}

function expectedOutput(): ExpectedOutputContract {
  return {
    outputId: "answer",
    kind: "text",
    description: "Answer with cited evidence.",
    required: true,
    acceptance: {
      requiredEvidenceKinds: ["source"],
      artifactRequired: false,
      reasonCodes: ["needs_source"],
    },
  }
}

function resultReport(): ResultReport {
  const agentOwner = owner("sub_agent", "agent:researcher")
  return {
    identity: identity("sub_session", "sub:task018", agentOwner),
    resultReportId: "result:feedback:task018",
    parentRunId: "run:task018",
    subSessionId: "sub:task018",
    source: {
      entityType: "sub_agent",
      entityId: "agent:researcher",
      nicknameSnapshot: "Researcher",
    },
    status: "completed",
    outputs: [
      {
        outputId: "answer",
        status: "partial",
        value: {
          draft: "OPENAI_API_KEY=sk-task018secretsecretsecret and <script>alert(1)</script>",
          contact: "owner@example.com",
        },
      },
    ],
    evidence: [{ evidenceId: "evidence:1", kind: "source", sourceRef: "tool_call:search:1" }],
    artifacts: [],
    risksOrGaps: ["missing citation"],
  }
}

function review(): SubAgentResultReview {
  return {
    accepted: false,
    status: "needs_revision",
    verdict: "needs_revision",
    parentIntegrationStatus: "requires_revision",
    issues: [
      {
        code: "required_evidence_missing",
        outputId: "answer",
        detail: "Missing source evidence.",
      },
    ],
    normalizedFailureKey: "required_evidence_missing:answer",
    missingItems: ["answer source evidence"],
    requiredChanges: ["Add cited source evidence."],
    risksOrGaps: ["missing citation"],
    retryBudgetLimit: 2,
    retryBudgetRemaining: 2,
    repeatedFailure: false,
    canRetry: true,
  }
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreState()
})

describe("task018 data exchange package redaction", () => {
  it("redacts every fixture taxonomy category and requires nickname and provenance metadata", () => {
    const fixtures = [
      {
        category: "secret_token_key_password_env",
        raw: "token=abcdefghijklmnopqrstuvwxyz0123456789",
        forbidden: "abcdefghijklmnopqrstuvwxyz0123456789",
      },
      {
        category: "raw_html_script_style",
        raw: "<html><body><script>alert('x')</script></body></html>",
        forbidden: "<script>",
      },
      {
        category: "stack_trace_log_dump",
        raw: "Error: boom\n    at run (/tmp/app.ts:1:2)",
        forbidden: "/tmp/app.ts:1:2",
      },
      {
        category: "contact_identity_payment_pii",
        raw: "email alice@example.com card 4111 1111 1111 1111 phone 415-555-1212",
        forbidden: "alice@example.com",
      },
      {
        category: "private_memory_excerpt",
        raw: "private memory excerpt: coordinator-only evidence",
        forbidden: "coordinator-only evidence",
      },
      {
        category: "external_artifact_preview",
        raw: "artifact preview: data:image/png;base64,abcdefghijklmnopqrstuvwxyz0123456789",
        forbidden: "abcdefghijklmnopqrstuvwxyz0123456789",
      },
    ] as const

    for (const fixture of fixtures) {
      const inspection = inspectDataExchangePayloadRisk({ summary: fixture.raw })
      expect(inspection.categories).toContain(fixture.category)
      const exchange = baseExchange({
        exchangeId: `exchange:task018:redaction:${fixture.category}`,
        idempotencyKey: `exchange:task018:redaction:${fixture.category}`,
        payload: { summary: fixture.raw },
      })
      expect(exchange.redactionState).toBe("redacted")
      expect(JSON.stringify(exchange.payload)).not.toContain(fixture.forbidden)
    }

    const valid = baseExchange({ exchangeId: "exchange:task018:valid" })
    const { sourceNicknameSnapshot: _sourceNicknameSnapshot, ...withoutSourceNickname } = valid
    const missingNickname = validateDataExchangePackage(
      withoutSourceNickname as DataExchangePackage,
      { now },
    )
    expect(missingNickname.ok).toBe(false)
    expect(missingNickname.issues.map((issue) => issue.code)).toContain("source_nickname_missing")

    const missingProvenance = validateDataExchangePackage({ ...valid, provenanceRefs: [] }, { now })
    expect(missingProvenance.ok).toBe(false)
    expect(missingProvenance.issues.map((issue) => issue.code)).toContain("provenance_refs_missing")
  })

  it("creates stored packages through the API, returns sanitized views, and blocks wrong recipients", async () => {
    await withApp(async (app) => {
      const create = await app.inject({
        method: "POST",
        url: "/api/data-exchanges",
        payload: {
          sourceOwner: owner("nobie", "agent:nobie"),
          recipientOwner: owner("sub_agent", "agent:researcher"),
          sourceNicknameSnapshot: "Nobie",
          recipientNicknameSnapshot: "Researcher",
          purpose: "temporary verification context",
          allowedUse: "temporary_context",
          retentionPolicy: "session_only",
          redactionState: "not_sensitive",
          provenanceRefs: ["result:task018:api", "tool_call:web:1"],
          payload: {
            summary: "token=abcdefghijklmnopqrstuvwxyz0123456789 and alice@example.com",
            raw: "<script>alert('x')</script>",
          },
          exchangeId: "exchange:task018:api",
          idempotencyKey: "exchange:task018:api",
        },
      })
      expect(create.statusCode, create.body).toBe(201)
      const created = create.json()
      expect(created.exchange.payload).toBeUndefined()
      expect(created.exchange.payloadSummary).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789")
      expect(created.exchange.payloadSummary).not.toContain("alice@example.com")
      expect(created.exchange.redactionState).toBe("redacted")
      expect(created.exchange.redactionCategories).toEqual(
        expect.arrayContaining([
          "secret_token_key_password_env",
          "contact_identity_payment_pii",
          "raw_html_script_style",
        ]),
      )
      expect(created.exchange.provenanceKinds).toEqual(
        expect.arrayContaining(["source_result", "tool_call"]),
      )

      const list = await app.inject({
        method: "GET",
        url: "/api/data-exchanges?recipientOwnerType=sub_agent&recipientOwnerId=agent:researcher&requesterOwnerType=sub_agent&requesterOwnerId=agent:researcher",
      })
      expect(list.statusCode).toBe(200)
      expect(list.json().exchanges).toHaveLength(1)

      const forbidden = await app.inject({
        method: "GET",
        url: "/api/data-exchanges/exchange:task018:api?requesterOwnerType=sub_agent&requesterOwnerId=agent:other",
      })
      expect(forbidden.statusCode).toBe(403)
      expect(forbidden.json().reasonCode).toBe("data_exchange_read_forbidden")
    })
  })

  it("excludes expired packages from retrieval and cross-agent memory access without exchange", () => {
    const nobie = owner("nobie", "agent:nobie")
    const researcher = owner("sub_agent", "agent:researcher")
    const exchange = baseExchange({
      sourceOwner: nobie,
      recipientOwner: researcher,
      exchangeId: "exchange:task018:ttl",
      idempotencyKey: "exchange:task018:ttl",
      expiresAt: now + 10,
    })
    expect(persistDataExchangePackage(exchange, { now })).toBe(true)
    expect(listActiveDataExchangePackagesForRecipient(researcher, { now })).toHaveLength(1)
    expect(listActiveDataExchangePackagesForRecipient(researcher, { now: now + 20 })).toHaveLength(
      0,
    )
    expect(getDataExchangePackage("exchange:task018:ttl", { now: now + 20 })).toBeUndefined()
    expect(
      getDataExchangePackage("exchange:task018:ttl", { now: now + 20, includeExpired: true }),
    ).toBeDefined()

    expect(() =>
      assertMemoryAccessAllowed({
        requester: researcher,
        owner: nobie,
        exchanges: [],
        now,
      }),
    ).toThrow(MemoryIsolationError)
  })

  it("requires admin raw access and audit, while keeping secret raw text unavailable", () => {
    const exchange = baseExchange({
      exchangeId: "exchange:task018:admin",
      idempotencyKey: "exchange:task018:admin",
      payload: {
        summary: "password=supersecretpassword and OPENAI_API_KEY=sk-task018secretsecretsecret",
      },
    })
    expect(persistDataExchangePackage(exchange, { now })).toBe(true)
    const stored = getDataExchangePackage("exchange:task018:admin", { includeExpired: true })
    expect(stored).toBeDefined()

    const denied = buildDataExchangeAdminRawView(stored as DataExchangePackage, {
      adminAccessGranted: false,
      reason: "incident review",
      requester: "admin",
      now,
    })
    expect(denied.ok).toBe(false)
    expect(denied.exchange).toBeUndefined()

    const allowed = buildDataExchangeAdminRawView(stored as DataExchangePackage, {
      adminAccessGranted: true,
      reason: "incident review",
      requester: "admin",
      now,
    })
    expect(allowed.ok).toBe(true)
    expect(allowed.auditEventId).toBeTruthy()
    expect(allowed.redactionCategories).toContain("secret_token_key_password_env")
    expect(JSON.stringify(allowed.exchange?.payload)).not.toContain("supersecretpassword")
    expect(JSON.stringify(allowed.exchange?.payload)).not.toContain("sk-task018secretsecretsecret")
    expect(listControlEvents({ eventType: "data_exchange.raw_view.opened" })).toHaveLength(1)
  })

  it("applies the same redaction, TTL, and provenance policy to FeedbackRequest synthesized context", () => {
    const built = buildFeedbackLoopPackage({
      resultReports: [resultReport()],
      review: review(),
      expectedOutputs: [expectedOutput()],
      targetAgentPolicy: "same_agent",
      targetAgentId: "agent:researcher",
      targetAgentNicknameSnapshot: "Researcher",
      requestingAgentId: "agent:nobie",
      requestingAgentNicknameSnapshot: "Nobie",
      parentRunId: "run:task018",
      persistSynthesizedContext: false,
      idProvider: () => "task018-feedback",
      now: () => now,
    })

    expect(built.synthesizedContext.expiresAt).toBe(now + dayMs)
    expect(built.synthesizedContext.redactionState).toBe("redacted")
    expect(built.synthesizedContext.sourceNicknameSnapshot).toBe("Nobie")
    expect(built.synthesizedContext.recipientNicknameSnapshot).toBe("Researcher")
    expect(built.synthesizedContext.provenanceRefs).toEqual(["result:feedback:task018"])
    expect(JSON.stringify(built.synthesizedContext.payload)).not.toContain(
      "sk-task018secretsecretsecret",
    )
    expect(JSON.stringify(built.synthesizedContext.payload)).not.toContain("<script>")
    expect(JSON.stringify(built.synthesizedContext.payload)).not.toContain("owner@example.com")

    const sanitized = buildDataExchangeSanitizedView(built.synthesizedContext, { now })
    expect(sanitized.provenanceKinds).toContain("source_result")
    expect(sanitized.payloadSummary).not.toContain("OPENAI_API_KEY")
    expect(sanitized.payloadSummary).not.toContain("<script>")
  })
})
