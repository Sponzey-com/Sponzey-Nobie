import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import {
  approveLearningEvent,
  buildHistoryVersion,
  buildLearningWritebackCandidate,
  dryRunRestoreHistoryVersion,
  evaluateLearningPolicy,
  listAgentLearningEvents,
  listHistoryVersions,
  listRestoreEvents,
  recordHistoryVersion,
  recordLearningEvent,
  restoreHistoryVersion,
  type MemoryWritebackReviewItem,
  type OwnerScope,
} from "../packages/core/src/index.ts"
import { buildMemoryQualitySnapshot } from "../packages/core/src/memory/quality.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task010-learning-history-"))
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

describe("task010 learning history restore", () => {
  it("auto-applies only high-confidence low-risk self memory learning", async () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const result = await recordLearningEvent({
      agentId: "agent:researcher",
      agentType: "sub_agent",
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "memory",
      before: {},
      after: { preference: "answer with one concise status line" },
      beforeSummary: "",
      afterSummary: "The researcher should answer with one concise status line.",
      evidenceRefs: ["session:task010:auto"],
      confidence: 0.92,
      auditCorrelationId: "audit:task010:auto",
      now: () => now,
    })

    expect(result.inserted).toBe(true)
    expect(result.policy.approvalState).toBe("auto_applied")
    expect(result.policy.reasonCode).toBe("auto_apply_self_memory_high_confidence")
    expect(result.history?.targetEntityType).toBe("memory")
    expect(result.memoryDocumentId).toBeTruthy()

    const events = listAgentLearningEvents("agent:researcher")
    expect(events).toHaveLength(1)
    expect(events[0]?.before).toEqual({})
    expect(events[0]?.after).toMatchObject({ preference: "answer with one concise status line" })
    expect(events[0]?.policyReasonCode).toBe("auto_apply_self_memory_high_confidence")
    expect(listHistoryVersions("memory", "agent:researcher")).toHaveLength(1)

    const document = getDb()
      .prepare<[string], { source_type: string; source_ref: string | null }>(
        "SELECT source_type, source_ref FROM memory_documents WHERE id = ?",
      )
      .get(result.memoryDocumentId!)
    expect(document).toMatchObject({
      source_type: "learning_event",
      source_ref: result.event.learningEventId,
    })

    const quality = buildMemoryQualitySnapshot({ now })
    expect(quality.learningHistory.autoApplied).toBe(1)
    expect(quality.learningHistory.historyVersions).toBe(1)
  })

  it("keeps medium-confidence learning pending and applies it only through explicit approval", async () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const pending = await recordLearningEvent({
      agentId: "agent:researcher",
      agentType: "sub_agent",
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "memory",
      before: {},
      after: { preference: "include evidence references when available" },
      beforeSummary: "",
      afterSummary: "Include evidence references when available.",
      evidenceRefs: ["session:task010:pending"],
      confidence: 0.74,
      auditCorrelationId: "audit:task010:pending",
      now: () => now,
    })

    expect(pending.policy.approvalState).toBe("pending_review")
    expect(pending.history).toBeUndefined()
    expect(pending.memoryDocumentId).toBeUndefined()
    expect(listHistoryVersions("memory", "agent:researcher")).toHaveLength(0)

    const approved = await approveLearningEvent({
      agentId: "agent:researcher",
      learningEventId: pending.event.learningEventId,
      owner: researcher,
      auditCorrelationId: "audit:task010:approve",
      now: () => now + 1,
    })

    expect(approved.ok).toBe(true)
    expect(approved.reasonCode).toBe("approved")
    expect(approved.event?.approvalState).toBe("applied_by_user")
    expect(approved.historyInserted).toBe(true)
    expect(approved.memoryDocumentId).toBeTruthy()
    expect(listAgentLearningEvents("agent:researcher")[0]?.approvalState).toBe("applied_by_user")
    expect(listHistoryVersions("memory", "agent:researcher")).toHaveLength(1)
  })

  it("blocks unsafe learning paths without semantic comparisons", () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const analyst = owner("sub_agent", "agent:analyst")

    const permissionExpansion = evaluateLearningPolicy({
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "memory",
      before: { enabledMcpServerIds: ["browser"] },
      after: { enabledMcpServerIds: ["browser", "database"] },
      confidence: 0.99,
    })
    expect(permissionExpansion.approvalState).toBe("pending_review")
    expect(permissionExpansion.reasonCode).toBe("pending_permission_or_capability_expansion")
    expect(permissionExpansion.autoApply).toBe(false)

    const locked = evaluateLearningPolicy({
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "personality",
      before: { personality: "direct" },
      after: { personality: "playful" },
      confidence: 0.95,
      lockedFields: ["personality"],
    })
    expect(locked.approvalState).toBe("pending_review")
    expect(locked.reasonCode).toBe("pending_locked_setting_conflict")

    const crossAgent = evaluateLearningPolicy({
      actorOwner: researcher,
      targetOwner: analyst,
      learningTarget: "memory",
      before: {},
      after: { preference: "use analyst private memory" },
      confidence: 0.99,
    })
    expect(crossAgent.approvalState).toBe("rejected")
    expect(crossAgent.reasonCode).toBe("rejected_cross_agent_write")

    const lowConfidence = evaluateLearningPolicy({
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "memory",
      before: {},
      after: { preference: "unreliable one-off behavior" },
      confidence: 0.42,
    })
    expect(lowConfidence.approvalState).toBe("rejected")
    expect(lowConfidence.reasonCode).toBe("rejected_low_confidence")
  })

  it("records restore as append-only event and redacts sensitive history payloads", () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const history = buildHistoryVersion({
      targetEntityType: "memory",
      targetEntityId: "agent:researcher",
      owner: researcher,
      before: {
        token: "sk-abcdefghijklmnopqrstuvwxyz012345",
        path: "/Users/dongwooshin/private/nobie.txt",
        preference: "before",
      },
      after: { preference: "after" },
      reasonCode: "task010_restore_test",
      historyVersionId: "history:task010:restore",
      idempotencyKey: "history:task010:restore",
      auditCorrelationId: "audit:task010:restore",
      now: () => now,
    })
    expect(recordHistoryVersion(history, { auditId: "audit:task010:restore" })).toBe(true)

    const dryRun = dryRunRestoreHistoryVersion({
      targetEntityType: "memory",
      targetEntityId: "agent:researcher",
      restoredHistoryVersionId: history.historyVersionId,
    })
    expect(dryRun.ok).toBe(true)
    expect(JSON.stringify(dryRun.restorePayload)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345")
    expect(JSON.stringify(dryRun.restorePayload)).not.toContain("/Users/dongwooshin")
    expect(dryRun.effectSummary.join("\n")).toContain("preference")

    const restored = restoreHistoryVersion({
      targetEntityType: "memory",
      targetEntityId: "agent:researcher",
      restoredHistoryVersionId: history.historyVersionId,
      owner: researcher,
      dryRun: true,
      restoreEventId: "restore:task010:dry-run",
      idempotencyKey: "restore:task010:dry-run",
      auditCorrelationId: "audit:task010:restore-event",
      now: () => now + 1,
    })
    expect(restored.inserted).toBe(true)
    expect(restored.applied).toBe(false)
    expect(listHistoryVersions("memory", "agent:researcher")).toHaveLength(1)
    expect(listRestoreEvents("memory", "agent:researcher")).toHaveLength(1)
  })

  it("builds learning candidates from memory writeback review items", () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const item: MemoryWritebackReviewItem = {
      id: "candidate:task010",
      scope: "long-term",
      ownerId: "agent:researcher",
      sourceType: "flash_feedback",
      sourceRunId: "run:task010",
      sourceChannel: "telegram",
      sessionId: "session:task010",
      requestGroupId: "request:task010",
      confidence: "high",
      ttl: "long_term",
      proposedText: "Always mention the source when reporting market data.",
      repeatExamples: [],
      blockReasons: [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }

    const candidate = buildLearningWritebackCandidate({
      item,
      agentId: "agent:researcher",
      agentType: "sub_agent",
      actorOwner: researcher,
      targetOwner: researcher,
    })

    expect(candidate.learningTarget).toBe("memory")
    expect(candidate.confidence).toBe(0.9)
    expect(candidate.evidenceRefs).toEqual(["memory_writeback:candidate:task010"])
    expect(candidate.after).toMatchObject({
      content: item.proposedText,
      sourceType: "flash_feedback",
      scope: "long-term",
    })
  })
})
