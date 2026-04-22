import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import type { MemoryPolicy, OwnerScope } from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  MemoryIsolationError,
  buildMemorySummaryDataExchange,
  createDataExchangePackage,
  listActiveDataExchangePackagesForRecipient,
  persistDataExchangePackage,
  prepareAgentMemoryWritebackQueueInput,
  searchOwnerScopedMemory,
  storeOwnerScopedMemory,
  validateDataExchangePackage,
} from "../packages/core/src/memory/isolation.ts"
import { validateAgentPromptBundleContextScope } from "../packages/core/src/runs/context-preflight.ts"
import { buildDataExchangeJournalRecord } from "../packages/core/src/runs/journaling.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task008-memory-isolation-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

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

beforeEach(() => {
  useTempState()
})

function owner(ownerType: OwnerScope["ownerType"], ownerId: string): OwnerScope {
  return { ownerType, ownerId }
}

function memoryPolicy(writeOwner: OwnerScope): MemoryPolicy {
  return {
    owner: writeOwner,
    visibility: "private",
    readScopes: [writeOwner],
    writeScope: writeOwner,
    retentionPolicy: "long_term",
    writebackReviewRequired: true,
  }
}

describe("task008 memory isolation and data exchange", () => {
  it("keeps owner memory scoped and requires data exchange for cross-agent context", async () => {
    const nobie = owner("nobie", "agent:nobie")
    const researcher = owner("sub_agent", "agent:researcher")
    const stored = await storeOwnerScopedMemory({
      owner: nobie,
      visibility: "private",
      retentionPolicy: "long_term",
      rawText: "TASK008_NOBIE_PRIVATE_CONTEXT coordinator-only evidence",
      sourceType: "test",
      title: "coordinator memory",
    })

    const document = getDb()
      .prepare<[string], { owner_id: string; metadata_json: string | null }>(
        `SELECT owner_id, metadata_json FROM memory_documents WHERE id = ?`,
      )
      .get(stored.documentId)
    expect(document?.owner_id).toBe("agent:nobie")
    expect(JSON.parse(document?.metadata_json ?? "{}")).toMatchObject({
      ownerType: "nobie",
      ownerId: "agent:nobie",
      visibility: "private",
      retentionPolicy: "long_term",
      historyVersion: 1,
    })

    await expect(searchOwnerScopedMemory({
      requester: researcher,
      owner: nobie,
      query: "TASK008_NOBIE_PRIVATE_CONTEXT",
    })).rejects.toMatchObject({
      reasonCode: "cross_agent_memory_requires_data_exchange",
    })

    const direct = await searchOwnerScopedMemory({
      requester: nobie,
      owner: nobie,
      query: "TASK008_NOBIE_PRIVATE_CONTEXT",
    })
    expect(direct.accessMode).toBe("owner_direct")
    expect(direct.memoryResults).toHaveLength(1)

    const exchange = buildMemorySummaryDataExchange({
      sourceOwner: nobie,
      recipientOwner: researcher,
      purpose: "temporary sub-agent context",
      allowedUse: "temporary_context",
      retentionPolicy: "session_only",
      redactionState: "not_sensitive",
      memoryResults: direct.memoryResults,
      exchangeId: "exchange:task008:context",
      idempotencyKey: "exchange:task008:context",
      expiresAt: now + 60_000,
      now: () => now,
    })
    expect(exchange.provenanceRefs.every((ref) => ref.startsWith("opaque:"))).toBe(true)
    expect(JSON.stringify(exchange.payload)).not.toContain(direct.memoryResults[0]!.chunkId)
    expect(persistDataExchangePackage(exchange, { now })).toBe(true)
    expect(listActiveDataExchangePackagesForRecipient(researcher, { now })).toHaveLength(1)
    expect(listActiveDataExchangePackagesForRecipient(researcher, { now: now + 120_000 })).toHaveLength(0)

    const viaExchange = await searchOwnerScopedMemory({
      requester: researcher,
      owner: nobie,
      query: "TASK008_NOBIE_PRIVATE_CONTEXT",
      exchanges: [exchange],
      now,
    })
    expect(viaExchange.accessMode).toBe("recipient_via_exchange")
    expect(viaExchange.memoryResults).toHaveLength(0)
    expect(viaExchange.exchangeRefs).toMatchObject([{
      owner: nobie,
      visibility: "private",
      sourceRef: "exchange:exchange:task008:context",
      dataExchangeId: "exchange:task008:context",
    }])
  })

  it("redacts sensitive exchange payloads and validates required exchange metadata", () => {
    const pkg = createDataExchangePackage({
      sourceOwner: owner("nobie", "agent:nobie"),
      recipientOwner: owner("sub_agent", "agent:researcher"),
      purpose: "verification",
      allowedUse: "verification_only",
      retentionPolicy: "session_only",
      redactionState: "not_sensitive",
      provenanceRefs: ["opaque:source"],
      payload: {
        summary: "token=abcdefghijklmnopqrstuvwxyz0123456789 and /Users/dongwooshin/secret.txt",
      },
      exchangeId: "exchange:task008:redacted",
      idempotencyKey: "exchange:task008:redacted",
      now: () => now,
    })

    expect(pkg.redactionState).toBe("redacted")
    expect(JSON.stringify(pkg.payload)).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789")
    expect(JSON.stringify(pkg.payload)).not.toContain("/Users/dongwooshin")
    expect(validateDataExchangePackage(pkg, { now }).ok).toBe(true)

    const invalid = { ...pkg, purpose: "", provenanceRefs: [] }
    const validation = validateDataExchangePackage(invalid, { now })
    expect(validation.ok).toBe(false)
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "purpose_missing",
      "provenance_refs_missing",
    ]))
  })

  it("blocks prompt context when exchange is expired, missing provenance, or not context-allowed", () => {
    const nobie = owner("nobie", "agent:nobie")
    const researcher = owner("sub_agent", "agent:researcher")
    const bundle = {
      agentId: "agent:researcher",
      agentType: "sub_agent" as const,
      memoryPolicy: memoryPolicy(researcher),
    }
    const baseMemoryRef = {
      owner: nobie,
      visibility: "private" as const,
      sourceRef: "memory:coordinator-private",
    }

    const noExchange = validateAgentPromptBundleContextScope({
      bundle,
      memoryRefs: [baseMemoryRef],
      now: () => now,
    })
    expect(noExchange.issueCodes).toContain("private_memory_without_explicit_exchange")

    const expired = createDataExchangePackage({
      sourceOwner: nobie,
      recipientOwner: researcher,
      purpose: "context",
      allowedUse: "temporary_context",
      retentionPolicy: "session_only",
      redactionState: "not_sensitive",
      provenanceRefs: ["opaque:source"],
      payload: { summary: "expired" },
      exchangeId: "exchange:task008:expired",
      idempotencyKey: "exchange:task008:expired",
      expiresAt: now - 1,
      now: () => now,
    })
    const expiredValidation = validateAgentPromptBundleContextScope({
      bundle,
      memoryRefs: [{ ...baseMemoryRef, dataExchangeId: expired.exchangeId }],
      dataExchangePackages: [expired],
      now: () => now,
    })
    expect(expiredValidation.issueCodes).toContain("data_exchange_expired")

    const memoryCandidate = createDataExchangePackage({
      sourceOwner: nobie,
      recipientOwner: researcher,
      purpose: "candidate",
      allowedUse: "memory_candidate",
      retentionPolicy: "long_term_candidate",
      redactionState: "not_sensitive",
      provenanceRefs: ["opaque:source"],
      payload: { summary: "candidate" },
      exchangeId: "exchange:task008:candidate",
      idempotencyKey: "exchange:task008:candidate",
      now: () => now,
    })
    const candidateValidation = validateAgentPromptBundleContextScope({
      bundle,
      memoryRefs: [{ ...baseMemoryRef, dataExchangeId: memoryCandidate.exchangeId }],
      dataExchangePackages: [memoryCandidate],
      now: () => now,
    })
    expect(candidateValidation.issueCodes).toContain("data_exchange_not_context_allowed")
  })

  it("keeps memory writeback candidates inside the agent write scope", () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const policy = memoryPolicy(researcher)

    const prepared = prepareAgentMemoryWritebackQueueInput({
      memoryPolicy: policy,
      candidate: {
        scope: "long-term",
        sourceType: "result_summary",
        content: "TASK008_RESEARCHER_WRITEBACK stays under researcher owner",
      },
    })
    expect(prepared.ownerId).toBe("agent:researcher")
    expect(prepared.metadata).toMatchObject({
      ownerType: "sub_agent",
      ownerId: "agent:researcher",
      visibility: "private",
      retentionPolicy: "long_term",
      memoryIsolation: "owner_scoped_writeback",
    })

    expect(() => prepareAgentMemoryWritebackQueueInput({
      memoryPolicy: policy,
      candidate: {
        scope: "long-term",
        ownerId: "agent:writer",
        sourceType: "result_summary",
        content: "wrong owner",
      },
    })).toThrow(MemoryIsolationError)
  })

  it("records exchange id and source session in the run journal payload", () => {
    const exchange = createDataExchangePackage({
      sourceOwner: owner("sub_agent", "agent:researcher"),
      recipientOwner: owner("nobie", "agent:nobie"),
      purpose: "parent verification",
      allowedUse: "verification_only",
      retentionPolicy: "discard_after_review",
      redactionState: "not_sensitive",
      provenanceRefs: ["result:task008"],
      payload: { summary: "review result" },
      parentSessionId: "session:source",
      exchangeId: "exchange:task008:journal",
      idempotencyKey: "exchange:task008:journal",
      now: () => now,
    })
    const record = buildDataExchangeJournalRecord({
      exchange,
      runId: "run:task008",
      sessionId: "session:parent",
      requestGroupId: "request:task008",
    })
    expect(record.source).toBe("data_exchange")
    expect(record.tags).toEqual(expect.arrayContaining(["data_exchange", "verification_only"]))
    expect(record.content).toContain("exchange:task008:journal")
    expect(record.content).toContain("session:source")
  })
})
