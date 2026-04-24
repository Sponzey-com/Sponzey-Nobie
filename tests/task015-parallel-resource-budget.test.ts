import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  MemoryPolicy,
  OrchestrationPlan,
  PermissionProfile,
  ResourceLockContract,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubSessionContract,
  SubSessionStatus,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  listLatencyMetrics,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"
import {
  type RunSubSessionInput,
  type SubSessionRunOutcome,
  SubSessionRunner,
  type SubSessionRuntimeDependencies,
  type SubSessionWorkItem,
  createTextResultReport,
  planOrchestrationExecutionWaves,
  runParallelSubSessionGroup,
} from "../packages/core/src/orchestration/sub-session-runner.ts"

const now = Date.UTC(2026, 3, 24, 0, 0, 0)

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Answer returned to parent review.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["reviewable_result"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Validate parallel resource and budget control.",
  intentType: "runtime_test",
  actionType: "parallel_subsession_runtime",
  constraints: ["Do not deliver directly to the user."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["task015"],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: ["shell_exec"],
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:task015",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: true,
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
    owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
    idempotencyKey,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

function promptBundle(): AgentPromptBundle {
  return {
    identity: identity("sub_session", "prompt-bundle:task015", "idem:prompt-bundle:task015"),
    bundleId: "prompt-bundle:task015",
    agentId: "agent:researcher",
    agentType: "sub_agent",
    role: "parallel worker",
    displayNameSnapshot: "Researcher",
    nicknameSnapshot: "Res",
    personalitySnapshot: "Precise",
    teamContext: [],
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 2 },
    },
    modelProfileSnapshot: modelProfile,
    taskScope,
    safetyRules: ["Sub-session result is parent synthesis only."],
    sourceProvenance: [{ sourceId: "profile:agent:researcher", version: "1" }],
    createdAt: now,
  }
}

function command(id: string, retryBudget = 2): CommandRequest {
  return {
    identity: identity("sub_session", id, `idem:${id}`),
    commandRequestId: `command:${id}`,
    parentRunId: "run-parent",
    subSessionId: `sub:${id}`,
    targetAgentId: "agent:researcher",
    targetNicknameSnapshot: "Res",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget,
  }
}

function runInput(id: string, overrides: Partial<RunSubSessionInput> = {}): RunSubSessionInput {
  return {
    command: command(id),
    agent: {
      agentId: "agent:researcher",
      displayName: "Researcher",
      nickname: "Res",
    },
    parentAgent: {
      agentId: "agent:nobie",
      displayName: "Nobie",
      nickname: "노비",
    },
    parentSessionId: "session-parent",
    promptBundle: promptBundle(),
    ...overrides,
  }
}

function outcome(taskId: string, status: SubSessionStatus = "completed"): SubSessionRunOutcome {
  return {
    subSession: {
      identity: identity("sub_session", `sub:${taskId}`, `idem:${taskId}`),
      subSessionId: `sub:${taskId}`,
      parentSessionId: "session-parent",
      parentRunId: "run-parent",
      agentId: "agent:researcher",
      agentDisplayName: "Researcher",
      agentNickname: "Res",
      commandRequestId: `command:${taskId}`,
      status,
      retryBudgetRemaining: 1,
      promptBundleId: "prompt-bundle:task015",
    },
    status,
    replayed: false,
  }
}

function workItem(taskId: string, overrides: Partial<SubSessionWorkItem> = {}): SubSessionWorkItem {
  return {
    taskId,
    subSessionId: `sub:${taskId}`,
    run: () => outcome(taskId),
    ...overrides,
  }
}

function exclusiveFileLock(lockId: string, target = "/repo/shared.ts"): ResourceLockContract {
  return {
    lockId,
    kind: "file",
    target,
    mode: "exclusive",
    reasonCode: "write_conflict",
  }
}

function makeMemoryDependencies(input: { isParentFinalized?: () => boolean } = {}) {
  const sessions = new Map<string, SubSessionContract>()
  const events: Array<{ parentRunId: string; label: string }> = []
  let time = now
  const clone = <T>(value: T): T => structuredClone(value)
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
      return true
    },
    updateSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
    },
    appendParentEvent: (parentRunId, label) => {
      events.push({ parentRunId, label })
    },
    isParentCancelled: () => false,
    isParentFinalized: () => input.isParentFinalized?.() ?? false,
  }
  return { dependencies, sessions, events }
}

beforeEach(() => {
  resetLatencyMetrics()
})

afterEach(() => {
  resetLatencyMetrics()
})

describe("task015 parallel resource lock and budget control", () => {
  it("turns orchestration dependency graph into waves while sharing agent, tool, and MCP concurrency", () => {
    const plan: Pick<OrchestrationPlan, "dependencyEdges" | "parallelGroups"> = {
      dependencyEdges: [
        { fromTaskId: "collect", toTaskId: "summarize", reasonCode: "needs_evidence" },
      ],
      parallelGroups: [
        {
          groupId: "group:task015",
          parentRunId: "run-parent",
          subSessionIds: ["sub:collect", "sub:search-more", "sub:draft", "sub:summarize"],
          dependencyEdges: [],
          resourceLocks: [],
          concurrencyLimit: 4,
          status: "planned",
        },
      ],
    }

    const waves = planOrchestrationExecutionWaves(
      plan,
      [
        workItem("collect", {
          agentId: "agent:researcher",
          toolNames: ["web_search"],
          mcpServerIds: ["browser"],
        }),
        workItem("search-more", {
          agentId: "agent:researcher",
          toolNames: ["web_search"],
          mcpServerIds: ["browser"],
        }),
        workItem("draft", { agentId: "agent:writer", toolNames: ["editor"] }),
        workItem("summarize", { agentId: "agent:writer" }),
      ],
      {
        agentConcurrencyLimits: { "agent:researcher": 1, "agent:writer": 2 },
        toolConcurrencyLimits: { web_search: 1 },
        mcpServerConcurrencyLimits: { browser: 1 },
      },
    )

    expect(waves.map((wave) => wave.items.map((item) => item.taskId))).toEqual([
      ["collect", "draft"],
      ["search-more", "summarize"],
    ])
    expect(waves[1]?.waitReasonCodesByTask?.["search-more"]).toEqual(
      expect.arrayContaining([
        "agent_concurrency_limit",
        "tool_concurrency_limit",
        "mcp_concurrency_limit",
      ]),
    )
  })

  it("records resource lock wait, timeout, acquire, and release without crashing the parent", async () => {
    let time = now
    const events: string[] = []
    let blockedTaskRan = false

    const result = await runParallelSubSessionGroup(
      { groupId: "group:locks", dependencyEdges: [], concurrencyLimit: 2 },
      [
        workItem("left", {
          resourceLocks: [exclusiveFileLock("lock:left")],
          run: async () => {
            time += 600
            return outcome("left")
          },
        }),
        workItem("right", {
          resourceLocks: [exclusiveFileLock("lock:right")],
          run: async () => {
            blockedTaskRan = true
            return outcome("right")
          },
        }),
      ],
      {
        now: () => time,
        runId: "run-parent",
        sessionId: "session-parent",
        resourceLockWaitTimeoutMs: 300,
        appendParentEvent: async (_runId, label) => {
          events.push(label)
        },
      },
    )

    expect(result.status).toBe("blocked")
    expect(blockedTaskRan).toBe(false)
    expect(result.skipped).toEqual([
      expect.objectContaining({ taskId: "right", reasonCode: "resource_lock_timeout" }),
    ])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sub_session_lock_acquired:group:locks:left"),
        expect.stringContaining("sub_session_lock_released:group:locks:left"),
        expect.stringContaining("sub_session_lock_wait:group:locks:right:600ms"),
        expect.stringContaining("sub_session_lock_timeout:group:locks:right:600ms"),
      ]),
    )
    expect(listLatencyMetrics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "resource_lock_wait_ms",
          status: "timeout",
          detail: expect.objectContaining({ taskId: "right", resourceLockWaitMs: 600 }),
        }),
      ]),
    )
  })

  it("shrinks a group when cost and time budget would be exceeded", async () => {
    const result = await runParallelSubSessionGroup(
      { groupId: "group:budget", dependencyEdges: [], concurrencyLimit: 3 },
      [
        workItem("a", { estimatedCost: 1, estimatedDurationMs: 50 }),
        workItem("b", { estimatedCost: 2, estimatedDurationMs: 100 }),
        workItem("c", { estimatedCost: 1, estimatedDurationMs: 120 }),
      ],
      {
        budget: {
          maxEstimatedCost: 2,
          maxEstimatedDurationMs: 150,
        },
      },
    )

    expect(result.status).toBe("blocked")
    expect(result.outcomes.map((item) => item.subSession.subSessionId)).toEqual(["sub:a"])
    expect(result.budget).toEqual(
      expect.objectContaining({
        status: "shrunk",
        selectedTaskIds: ["a"],
        reasonCodes: expect.arrayContaining(["cost_budget_exceeded", "time_budget_exceeded"]),
      }),
    )
    expect(result.skipped).toEqual([
      expect.objectContaining({ taskId: "b", reasonCode: "cost_budget_exceeded" }),
      expect.objectContaining({ taskId: "c", reasonCode: "time_budget_exceeded" }),
    ])
  })

  it("decrements retry budget and records timeout reason on sub-session timeout", async () => {
    const { dependencies, sessions } = makeMemoryDependencies()
    const runner = new SubSessionRunner(dependencies)

    const result = await runner.runSubSession(
      runInput("timeout", { timeoutMs: 1 }),
      async (input) => {
        await new Promise(() => undefined)
        return createTextResultReport({ command: input.command, text: "too late" })
      },
    )

    expect(result.status).toBe("failed")
    expect(result.errorReport?.reasonCode).toBe("sub_session_timeout")
    expect(sessions.get("sub:timeout")?.retryBudgetRemaining).toBe(1)
  })

  it("cascade-stops active direct children and forwards abort to signal-aware work", async () => {
    const { dependencies, events } = makeMemoryDependencies()
    const runner = new SubSessionRunner(dependencies)
    let startedCount = 0
    let abortCount = 0
    let resolveStarted: (() => void) | undefined
    const allStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })

    const run = (id: string) =>
      runner.runSubSession(runInput(id), async (_input, controls) => {
        startedCount += 1
        if (startedCount === 2) resolveStarted?.()
        await new Promise((_resolve, reject) => {
          controls.signal.addEventListener(
            "abort",
            () => {
              abortCount += 1
              const error = new Error("aborted")
              error.name = "AbortError"
              reject(error)
            },
            { once: true },
          )
        })
        return createTextResultReport({ command: command(id), text: "unreachable" })
      })

    const running = [run("child-a"), run("child-b")]
    await allStarted
    const stopped = await runner.cascadeStopParentRun("run-parent")
    const outcomes = await Promise.all(running)

    expect(stopped.affectedSubSessionIds.sort()).toEqual(["sub:child-a", "sub:child-b"])
    expect(outcomes.map((item) => item.status)).toEqual(["cancelled", "cancelled"])
    expect(abortCount).toBe(2)
    expect(events.map((event) => event.label)).toEqual(
      expect.arrayContaining(["sub_session_cascade_stop:run-parent:2:sub:child-a,sub:child-b"]),
    )
  })

  it("suppresses late child result integration after parent finalizer is committed", async () => {
    let parentFinalized = false
    const { dependencies, events } = makeMemoryDependencies({
      isParentFinalized: () => parentFinalized,
    })
    const runner = new SubSessionRunner(dependencies)

    const result = await runner.runSubSession(runInput("late"), async (input) => {
      parentFinalized = true
      return createTextResultReport({ command: input.command, text: "late result" })
    })

    expect(result.status).toBe("completed")
    expect(result.integrationSuppressed).toBe(true)
    expect(result.suppressionReasonCode).toBe("parent_finalized")
    expect(result.resultReport).toBeUndefined()
    expect(events.map((event) => event.label)).toEqual(
      expect.arrayContaining(["sub_session_late_result_suppressed:sub:late:parent_finalized"]),
    )
  })
})
