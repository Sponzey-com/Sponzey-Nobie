import { describe, expect, it, vi } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  MemoryPolicy,
  PermissionProfile,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubSessionContract,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  InvalidSubSessionStatusTransitionError,
  type RunSubSessionInput,
  SubSessionRunner,
  type SubSessionRuntimeDependencies,
  buildSubSessionContract,
  canTransitionSubSessionStatus,
  createDryRunSubSessionHandler,
  transitionSubSessionStatus,
} from "../packages/core/src/orchestration/sub-session-runner.ts"
import type { MessageLedgerEventInput } from "../packages/core/src/runs/message-ledger.ts"

const now = Date.UTC(2026, 3, 24, 0, 0, 0)

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Dry-run result returned to parent synthesis.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["reviewable_result"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Validate sub-session dry-run lifecycle.",
  intentType: "runtime_test",
  actionType: "sub_session_dry_run",
  constraints: ["Do not deliver directly to the user."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["task013"],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["skill:dry-run"],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: ["shell_exec"],
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:dry-run",
  riskCeiling: "safe",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: false,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const memoryPolicy: MemoryPolicy = {
  owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  visibility: "private",
  readScopes: [{ ownerType: "sub_agent", ownerId: "agent:researcher" }],
  writeScope: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

const modelProfile = {
  providerId: "openai",
  modelId: "gpt-5.4-mini",
  effort: "low",
  maxOutputTokens: 512,
  timeoutMs: 1000,
  retryCount: 0,
  costBudget: 1,
}

function identity(
  entityType: RuntimeIdentity["entityType"],
  entityId: string,
  idempotencyKey = `idem:${entityId}`,
): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "nobie", ownerId: "agent:nobie" },
    idempotencyKey,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

function promptBundle(bundleId = "prompt-bundle:researcher"): AgentPromptBundle {
  return {
    identity: identity("capability", bundleId, `idem:${bundleId}`),
    bundleId,
    agentId: "agent:researcher",
    agentType: "sub_agent",
    role: "dry-run worker",
    displayNameSnapshot: "Researcher",
    nicknameSnapshot: "Res",
    personalitySnapshot: "Precise",
    teamContext: [],
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    modelProfileSnapshot: modelProfile,
    taskScope,
    safetyRules: ["Do not deliver sub-session results directly to the user."],
    sourceProvenance: [{ sourceId: "profile:agent:researcher", version: "1" }],
    validation: {
      ok: true,
      issueCodes: [],
      blockedFragmentIds: [],
      inactiveFragmentIds: [],
    },
    completionCriteria: [expectedOutput],
    createdAt: now,
  }
}

function command(id: string, retryBudget = 2): CommandRequest {
  return {
    identity: identity("sub_session", `command:${id}`, `idem:${id}`),
    commandRequestId: `command:${id}`,
    parentRunId: "run-parent",
    subSessionId: `sub:${id}`,
    targetAgentId: "agent:researcher",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget,
  }
}

function runInput(id: string, overrides: Partial<RunSubSessionInput> = {}): RunSubSessionInput {
  return {
    command: command(id),
    parentAgent: {
      agentId: "agent:nobie",
      displayName: "Nobie",
      nickname: "노비",
    },
    agent: {
      agentId: "agent:researcher",
      displayName: "Researcher",
      nickname: "Res",
    },
    parentSessionId: "session-parent",
    promptBundle: promptBundle(),
    ...overrides,
  }
}

function makeMemoryDependencies() {
  const sessions = new Map<string, SubSessionContract>()
  const events: Array<{ parentRunId: string; label: string }> = []
  const ledgerEvents: MessageLedgerEventInput[] = []
  const statusHistory = new Map<string, string[]>()
  const cancelledParents = new Set<string>()
  let time = now
  const clone = <T>(value: T): T => structuredClone(value)
  const rememberStatus = (subSession: SubSessionContract) => {
    const existing = statusHistory.get(subSession.subSessionId) ?? []
    existing.push(subSession.status)
    statusHistory.set(subSession.subSessionId, existing)
  }
  const dependencies: SubSessionRuntimeDependencies = {
    now: () => {
      time += 1
      return time
    },
    idProvider: () => {
      time += 1
      return `id-${time}`
    },
    loadSubSessionByIdempotencyKey: (idempotencyKey) =>
      clone(
        [...sessions.values()].find(
          (session) => session.identity.idempotencyKey === idempotencyKey,
        ),
      ),
    persistSubSession: (subSession) => {
      if (
        [...sessions.values()].some(
          (session) => session.identity.idempotencyKey === subSession.identity.idempotencyKey,
        )
      ) {
        return false
      }
      sessions.set(subSession.subSessionId, clone(subSession))
      rememberStatus(subSession)
      return true
    },
    updateSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
      rememberStatus(subSession)
    },
    appendParentEvent: (parentRunId, label) => {
      events.push({ parentRunId, label })
    },
    isParentCancelled: (parentRunId) => cancelledParents.has(parentRunId),
    recordLedgerEvent: (event) => {
      ledgerEvents.push(event)
      return `ledger:${ledgerEvents.length}`
    },
  }
  return { dependencies, sessions, events, ledgerEvents, statusHistory, cancelledParents }
}

describe("task013 sub-session dry-run lifecycle", () => {
  it("runs a mock dry-run through created, queued, running, and completed with named timeline events", async () => {
    const delivery = vi.fn()
    const { dependencies, events, ledgerEvents, statusHistory } = makeMemoryDependencies()
    const runner = new SubSessionRunner({ ...dependencies, deliverResultToUser: delivery })

    const outcome = await runner.runSubSession(
      runInput("dry-run"),
      createDryRunSubSessionHandler({
        progressSummaries: ["dry-run accepted"],
        text: "dry-run result",
      }),
    )

    expect(outcome.status).toBe("completed")
    expect(outcome.subSession.parentAgentNickname).toBe("노비")
    expect(outcome.subSession.agentNickname).toBe("Res")
    expect(outcome.resultReport?.source?.nicknameSnapshot).toBe("Res")
    expect(statusHistory.get("sub:dry-run")).toEqual(["created", "queued", "running", "completed"])
    expect(events.map((event) => event.label)).toEqual(
      expect.arrayContaining([
        "sub_session_created:sub:dry-run",
        "sub_session_handoff:sub:dry-run:노비->Res:command:dry-run",
        "sub_session_queued:sub:dry-run",
        "sub_session_started:sub:dry-run",
        "sub_session_progress:sub:dry-run:dry-run accepted",
        "sub_session_result:sub:dry-run:completed",
      ]),
    )
    expect(
      events.some((event) => event.label.startsWith("sub_session_result_suppressed:sub:dry-run")),
    ).toBe(true)
    expect(ledgerEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "sub_session_result_suppressed",
          deliveryKind: "final",
          status: "suppressed",
        }),
      ]),
    )
    expect(delivery).not.toHaveBeenCalled()
  })

  it("allows only declared status transitions", () => {
    const subSession = buildSubSessionContract(runInput("transition"))

    expect(canTransitionSubSessionStatus("created", "queued")).toBe(true)
    expect(canTransitionSubSessionStatus("completed", "running")).toBe(false)

    transitionSubSessionStatus(subSession, "queued", now + 1)
    transitionSubSessionStatus(subSession, "running", now + 2)
    transitionSubSessionStatus(subSession, "awaiting_approval", now + 3)
    transitionSubSessionStatus(subSession, "running", now + 4)
    transitionSubSessionStatus(subSession, "waiting_for_input", now + 5)
    transitionSubSessionStatus(subSession, "failed", now + 6)

    expect(subSession.status).toBe("failed")
    expect(subSession.startedAt).toBe(now + 2)
    expect(subSession.finishedAt).toBe(now + 6)
    expect(() => transitionSubSessionStatus(subSession, "running", now + 7)).toThrow(
      InvalidSubSessionStatusTransitionError,
    )
  })

  it("contains handler failures as failed sub-session outcomes", async () => {
    const { dependencies, events, statusHistory } = makeMemoryDependencies()
    const runner = new SubSessionRunner(dependencies)

    const outcome = await runner.runSubSession(runInput("failure"), async () => {
      throw new Error("mock handler failed")
    })

    expect(outcome.status).toBe("failed")
    expect(outcome.errorReport?.reasonCode).toBe("sub_session_handler_error")
    expect(statusHistory.get("sub:failure")).toEqual(["created", "queued", "running", "failed"])
    expect(events.map((event) => event.label)).toContain(
      "sub_session_failed:sub:failure:sub_session_handler_error",
    )
  })

  it("cancels before model work starts when the parent run is already cancelled", async () => {
    const { dependencies, cancelledParents, statusHistory } = makeMemoryDependencies()
    cancelledParents.add("run-parent")
    const runner = new SubSessionRunner(dependencies)
    const handler = vi.fn(createDryRunSubSessionHandler())

    const outcome = await runner.runSubSession(runInput("cancel-before-start"), handler)

    expect(outcome.status).toBe("cancelled")
    expect(outcome.errorReport?.reasonCode).toBe("parent_run_cancelled")
    expect(handler).not.toHaveBeenCalled()
    expect(statusHistory.get("sub:cancel-before-start")).toEqual(["created", "queued", "cancelled"])
  })

  it("replays idempotent dry-runs without duplicate handler execution", async () => {
    const { dependencies, events, statusHistory } = makeMemoryDependencies()
    const runner = new SubSessionRunner(dependencies)
    const handler = vi.fn(createDryRunSubSessionHandler({ text: "only once" }))

    const first = await runner.runSubSession(runInput("idem"), handler)
    const second = await runner.runSubSession(runInput("idem"), handler)

    expect(first.replayed).toBe(false)
    expect(second.replayed).toBe(true)
    expect(second.status).toBe("completed")
    expect(handler).toHaveBeenCalledTimes(1)
    expect(statusHistory.get("sub:idem")).toEqual(["created", "queued", "running", "completed"])
    expect(events.map((event) => event.label)).toContain("sub_session_replay:sub:idem:completed")
  })
})
