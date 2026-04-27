import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import type {
  MemoryPolicy,
  OwnerScope,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  closeDb,
  enqueueMemoryWritebackCandidate,
  getDb,
  listMemoryAccessTraceForRun,
} from "../packages/core/src/db/index.js"
import {
  MemoryIsolationError,
  buildMemorySummaryDataExchange,
  prepareAgentMemoryWritebackQueueInput,
  preparePolicyControlledMemoryWritebackQueueInput,
  resolveMemoryOwnerScopePolicy,
  searchOwnerScopedMemory,
  storeOwnerScopedMemory,
} from "../packages/core/src/memory/isolation.ts"
import { reviewMemoryWritebackCandidate } from "../packages/core/src/memory/writeback.ts"
import {
  buildCleanMachineInstallChecklist,
  buildReleasePipelinePlan,
} from "../packages/core/src/release/package.ts"
import { validateAgentPromptBundleContextScope } from "../packages/core/src/runs/context-preflight.ts"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task019-memory-isolation-"))
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

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreState()
})

describe("task019 memory isolation and writeback policy", () => {
  it("blocks sibling and Nobie private memory reads, and records denied memory access audit", async () => {
    const nobie = owner("nobie", "agent:nobie")
    const writer = owner("sub_agent", "agent:writer")
    const reader = owner("sub_agent", "agent:reader")

    await storeOwnerScopedMemory({
      owner: writer,
      visibility: "private",
      retentionPolicy: "long_term",
      rawText: "TASK019_WRITER_PRIVATE sibling-only memory",
      sourceType: "test",
    })
    await storeOwnerScopedMemory({
      owner: nobie,
      visibility: "private",
      retentionPolicy: "long_term",
      rawText: "TASK019_NOBIE_PRIVATE parent-only memory",
      sourceType: "test",
    })

    await expect(
      searchOwnerScopedMemory({
        requester: reader,
        owner: writer,
        query: "TASK019_WRITER_PRIVATE",
        filters: { runId: "run:task019:block", requestGroupId: "request:task019:block" },
      }),
    ).rejects.toMatchObject({ reasonCode: "cross_agent_memory_requires_data_exchange" })

    await expect(
      searchOwnerScopedMemory({
        requester: reader,
        owner: nobie,
        query: "TASK019_NOBIE_PRIVATE",
        filters: { runId: "run:task019:block", requestGroupId: "request:task019:block" },
      }),
    ).rejects.toMatchObject({ reasonCode: "cross_agent_memory_requires_data_exchange" })

    const audit = listMemoryAccessTraceForRun("run:task019:block")
    expect(audit.map((row) => row.reason)).toEqual(
      expect.arrayContaining([
        "cross_agent_memory_requires_data_exchange",
        "cross_agent_memory_requires_data_exchange",
      ]),
    )
  })

  it("allows child context only through a parent-created DataExchangePackage", async () => {
    const nobie = owner("nobie", "agent:nobie")
    const child = owner("sub_agent", "agent:researcher")

    await storeOwnerScopedMemory({
      owner: nobie,
      visibility: "private",
      retentionPolicy: "long_term",
      rawText: "TASK019_PACKAGED_CONTEXT parent context for bounded sharing",
      sourceType: "test",
    })
    const direct = await searchOwnerScopedMemory({
      requester: nobie,
      owner: nobie,
      query: "TASK019_PACKAGED_CONTEXT",
      filters: { runId: "run:task019:exchange" },
    })
    expect(direct.memoryResults).toHaveLength(1)

    const exchange = buildMemorySummaryDataExchange({
      sourceOwner: nobie,
      recipientOwner: child,
      sourceNicknameSnapshot: "Nobie",
      recipientNicknameSnapshot: "Researcher",
      purpose: "parent-shared bounded context",
      allowedUse: "temporary_context",
      retentionPolicy: "session_only",
      redactionState: "not_sensitive",
      memoryResults: direct.memoryResults,
      exchangeId: "exchange:task019:context",
      idempotencyKey: "exchange:task019:context",
      now: () => now,
    })

    const viaExchange = await searchOwnerScopedMemory({
      requester: child,
      owner: nobie,
      query: "TASK019_PACKAGED_CONTEXT",
      exchanges: [exchange],
      filters: { runId: "run:task019:exchange" },
      now,
    })
    expect(viaExchange.accessMode).toBe("recipient_via_exchange")
    expect(viaExchange.memoryResults).toHaveLength(0)
    expect(viaExchange.exchangeRefs).toMatchObject([
      {
        dataExchangeId: "exchange:task019:context",
        content: expect.stringContaining("TASK019_PACKAGED_CONTEXT"),
      },
    ])
    const [directResult] = direct.memoryResults
    expect(directResult).toBeDefined()
    expect(JSON.stringify(viaExchange.exchangeRefs)).not.toContain(directResult?.chunkId)
  })

  it("keeps writeback in actor scope by default and separates parent allow, review, and deny policy", async () => {
    const child = owner("sub_agent", "agent:child")
    const parent = owner("nobie", "agent:nobie")
    const policy = memoryPolicy(child)

    const self = prepareAgentMemoryWritebackQueueInput({
      memoryPolicy: policy,
      candidate: {
        scope: "long-term",
        sourceType: "result_summary",
        content: "TASK019_SELF_WRITEBACK child scoped result",
      },
    })
    expect(self.ownerId).toBe("agent:child")
    expect(self.metadata).toMatchObject({
      ownerType: "sub_agent",
      ownerId: "agent:child",
      targetOwnerScopeKey: "sub_agent:agent:child",
    })

    expect(() =>
      preparePolicyControlledMemoryWritebackQueueInput({
        memoryPolicy: policy,
        targetOwner: owner("sub_agent", "agent:sibling"),
        candidate: {
          scope: "long-term",
          sourceType: "result_summary",
          content: "wrong target",
        },
      }),
    ).toThrow(MemoryIsolationError)

    expect(() =>
      preparePolicyControlledMemoryWritebackQueueInput({
        memoryPolicy: policy,
        parentOwner: parent,
        targetOwner: parent,
        parentMemoryWritebackPolicy: "deny",
        candidate: {
          scope: "long-term",
          sourceType: "result_summary",
          content: "TASK019_PARENT_DENIED",
        },
      }),
    ).toThrow(MemoryIsolationError)

    const reviewed = preparePolicyControlledMemoryWritebackQueueInput({
      memoryPolicy: policy,
      actorOwner: child,
      parentOwner: parent,
      targetOwner: parent,
      parentMemoryWritebackPolicy: "review",
      candidate: {
        scope: "long-term",
        sourceType: "result_summary",
        content: "TASK019_PARENT_REVIEW parent-scoped candidate",
      },
    })
    expect(reviewed.ownerId).toBe("agent:nobie")
    expect(reviewed.status).toBe("pending")
    expect(reviewed.metadata).toMatchObject({
      crossOwnerWriteback: true,
      parentMemoryWritebackPolicy: "review",
      requiresReview: true,
      approved: false,
    })

    const id = enqueueMemoryWritebackCandidate(reviewed)
    expect(
      await searchOwnerScopedMemory({
        requester: parent,
        owner: parent,
        query: "TASK019_PARENT_REVIEW",
      }),
    ).toMatchObject({ memoryResults: [] })

    const result = await reviewMemoryWritebackCandidate({
      id,
      action: "approve_long_term",
      reviewerId: "parent-reviewer",
    })
    expect(result.ok).toBe(true)
    const stored = getDb()
      .prepare<[string], { owner_id: string; metadata_json: string | null }>(
        "SELECT owner_id, metadata_json FROM memory_documents WHERE id = ?",
      )
      .get(result.documentId ?? "")
    expect(stored?.owner_id).toBe("agent:nobie")
    expect(JSON.parse(stored?.metadata_json ?? "{}")).toMatchObject({
      targetOwnerScopeKey: "nobie:agent:nobie",
      crossOwnerWriteback: true,
    })

    const allowed = preparePolicyControlledMemoryWritebackQueueInput({
      memoryPolicy: policy,
      actorOwner: child,
      parentOwner: parent,
      targetOwner: parent,
      parentMemoryWritebackPolicy: "allow",
      candidate: {
        scope: "long-term",
        sourceType: "result_summary",
        content: "TASK019_PARENT_ALLOW parent-scoped allowed candidate",
      },
    })
    expect(allowed.metadata).toMatchObject({
      parentMemoryWritebackPolicy: "allow",
      requiresReview: false,
      approved: true,
    })
  })

  it("treats team scope as a read-only projection, not as a memory owner", async () => {
    const team = owner("team", "team:research")
    const child = owner("sub_agent", "agent:child")
    const teamPolicy = resolveMemoryOwnerScopePolicy(team)
    expect(teamPolicy).toMatchObject({
      kind: "team_projection",
      directReadAllowed: false,
      writeAllowed: false,
      reasonCode: "team_projection_read_only",
    })

    expect(() =>
      storeOwnerScopedMemory({
        owner: team,
        visibility: "team_visible",
        retentionPolicy: "short_term",
        rawText: "TASK019_TEAM_MEMORY should not be stored",
        sourceType: "test",
      }),
    ).toThrow(MemoryIsolationError)

    await expect(
      searchOwnerScopedMemory({
        requester: child,
        owner: team,
        query: "TASK019_TEAM_MEMORY",
      }),
    ).rejects.toMatchObject({ reasonCode: "team_projection_read_only" })

    expect(() =>
      preparePolicyControlledMemoryWritebackQueueInput({
        memoryPolicy: memoryPolicy(child),
        targetOwner: team,
        candidate: {
          scope: "long-term",
          sourceType: "team_projection",
          content: "TASK019_TEAM_WRITEBACK",
        },
      }),
    ).toThrow(MemoryIsolationError)
  })

  it("keeps prompt preflight blocking private memory without exchange and wires release gate regression", () => {
    const child = owner("sub_agent", "agent:child")
    const bundle = {
      agentId: child.ownerId,
      agentType: "sub_agent" as const,
      memoryPolicy: memoryPolicy(child),
    }
    const validation = validateAgentPromptBundleContextScope({
      bundle,
      memoryRefs: [
        {
          owner: owner("nobie", "agent:nobie"),
          visibility: "private",
          sourceRef: "memory:parent-private",
        },
      ],
      now: () => now,
    })
    expect(validation.ok).toBe(false)
    expect(validation.issueCodes).toContain("private_memory_without_explicit_exchange")

    const pipeline = buildReleasePipelinePlan()
    expect(pipeline.order).toContain("memory-isolation-release-gate")
    const memoryGate = pipeline.steps.find((step) => step.id === "memory-isolation-release-gate")
    expect(memoryGate?.command).toEqual([
      "pnpm",
      "test",
      "tests/task019-memory-isolation-writeback.test.ts",
    ])
    expect(buildCleanMachineInstallChecklist()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "memory-isolation-release-gate", required: true }),
      ]),
    )
  })
})
