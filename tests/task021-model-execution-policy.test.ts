import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  AgentConfig,
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  MemoryPolicy,
  ModelProfile,
  PermissionProfile,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubSessionContract,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  SubSessionRunner,
  type SubSessionRuntimeDependencies,
  buildAgentModelSummary,
  buildAgentPromptBundle,
  buildCleanMachineInstallChecklist,
  buildModelAvailabilityDoctorSnapshot,
  buildReleasePipelinePlan,
  createTextResultReport,
  resolveModelExecutionPolicy,
  runParallelSubSessionGroup,
} from "../packages/core/src/index.ts"
import {
  listLatencyMetrics,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"

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
  goal: "Validate model execution policy.",
  intentType: "runtime_test",
  actionType: "model_execution_policy",
  constraints: ["Do not deliver directly to the user."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["task021"],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: ["shell_exec"],
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:task021",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: true,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const memoryPolicy: MemoryPolicy = {
  owner: { ownerType: "sub_agent", ownerId: "agent:model" },
  visibility: "private",
  readScopes: [{ ownerType: "sub_agent", ownerId: "agent:model" }],
  writeScope: { ownerType: "sub_agent", ownerId: "agent:model" },
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

function modelProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    providerId: "openai",
    modelId: "gpt-5.4",
    effort: "medium",
    maxOutputTokens: 1000,
    timeoutMs: 20,
    retryCount: 1,
    costBudget: 1,
    fallbackModelId: "gpt-5.4-mini",
    ...overrides,
  }
}

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:model" },
    idempotencyKey: `idem:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: "agent:model",
    displayName: "Model Agent",
    nickname: "Modeler",
    status: "enabled",
    role: "model policy worker",
    personality: "Precise",
    specialtyTags: ["model-policy"],
    avoidTasks: [],
    modelProfile: modelProfile(),
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    teamIds: [],
    delegation: { enabled: false, maxParallelSessions: 1, retryBudget: 1 },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function promptBundle(profile = modelProfile()): AgentPromptBundle {
  return {
    identity: identity("sub_session", "prompt-bundle:task021"),
    bundleId: "prompt-bundle:task021",
    agentId: "agent:model",
    agentType: "sub_agent",
    role: "model worker",
    displayNameSnapshot: "Model Agent",
    nicknameSnapshot: "Modeler",
    personalitySnapshot: "Precise",
    teamContext: [],
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    modelProfileSnapshot: profile,
    taskScope,
    safetyRules: ["Parent synthesis only."],
    sourceProvenance: [{ sourceId: "profile:agent:model", version: "1" }],
    renderedPrompt: "Summarize the model policy result.",
    completionCriteria: [expectedOutput],
    createdAt: now,
  }
}

function command(id: string, retryBudget = 2): CommandRequest {
  return {
    identity: identity("sub_session", id),
    commandRequestId: `command:${id}`,
    parentRunId: "run-parent",
    subSessionId: `sub:${id}`,
    targetAgentId: "agent:model",
    targetNicknameSnapshot: "Modeler",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget,
  }
}

function makeMemoryDependencies() {
  const sessions = new Map<string, SubSessionContract>()
  const events: string[] = []
  const ledger: Array<{ summary: string; detail?: Record<string, unknown> }> = []
  let time = now
  const clone = <T>(value: T): T => structuredClone(value)
  const dependencies: SubSessionRuntimeDependencies = {
    now: () => {
      time += 10
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
      sessions.set(subSession.subSessionId, clone(subSession))
      return true
    },
    updateSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
    },
    appendParentEvent: (_parentRunId, label) => {
      events.push(label)
    },
    isParentCancelled: () => false,
    isParentFinalized: () => false,
    recordLedgerEvent: (input) => {
      ledger.push({ summary: input.summary, detail: input.detail })
      return `ledger:${ledger.length}`
    },
  }
  return { dependencies, sessions, events, ledger }
}

beforeEach(() => {
  resetLatencyMetrics()
})

afterEach(() => {
  resetLatencyMetrics()
})

describe("task021 model execution policy and cost performance audit", () => {
  it("resolves an agent model profile and blocks models outside the provider matrix", () => {
    const allowed = resolveModelExecutionPolicy({
      agentId: "agent:model",
      promptBundle: promptBundle(),
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
    })
    expect(allowed).toMatchObject({
      status: "allowed",
      reasonCode: "model_execution_allowed",
      snapshot: expect.objectContaining({
        providerId: "openai",
        modelId: "gpt-5.4",
        effort: "medium",
      }),
    })

    const blocked = resolveModelExecutionPolicy({
      agentId: "agent:model",
      promptBundle: promptBundle(
        modelProfile({ modelId: "unsupported-model", fallbackModelId: undefined }),
      ),
    })
    expect(blocked).toMatchObject({
      status: "blocked",
      reasonCode: "model_not_supported",
    })
  })

  it("uses doctor availability in degraded model summaries and policy fallback", () => {
    const doctor = buildModelAvailabilityDoctorSnapshot({
      providerId: "openai",
      modelId: "gpt-5.4",
      status: "unavailable",
      reasonCodes: ["provider_chat_blocked"],
      checkedAt: now,
    })
    const summary = buildAgentModelSummary(agentConfig(), { doctor })
    expect(summary.availability).toBe("unavailable")
    expect(summary.diagnosticReasonCodes).toEqual(
      expect.arrayContaining(["model_doctor_unavailable", "provider_chat_blocked"]),
    )

    const fallback = resolveModelExecutionPolicy({
      agentId: "agent:model",
      promptBundle: promptBundle(),
      doctor,
    })
    expect(fallback).toMatchObject({
      status: "allowed",
      reasonCode: "model_fallback_applied",
      snapshot: expect.objectContaining({
        modelId: "gpt-5.4-mini",
        fallbackApplied: true,
        fallbackFromModelId: "gpt-5.4",
        fallbackReasonCode: "model_doctor_unavailable",
      }),
    })
  })

  it("blocks estimated model cost with the shared cost budget reason code", () => {
    const blocked = resolveModelExecutionPolicy({
      agentId: "agent:model",
      promptBundle: promptBundle(modelProfile({ costBudget: 0.0001 })),
      estimatedInputTokens: 20_000,
      estimatedOutputTokens: 10_000,
    })
    expect(blocked.status).toBe("blocked")
    expect(blocked.reasonCode).toBe("cost_budget_exceeded")

    const budgetedGroup = runParallelSubSessionGroup(
      { groupId: "group:model-budget", dependencyEdges: [], concurrencyLimit: 2 },
      [
        {
          taskId: "a",
          subSessionId: "sub:a",
          estimatedCost: 2,
          run: async () => ({
            subSession: {} as SubSessionContract,
            status: "completed",
            replayed: false,
          }),
        },
      ],
      { budget: { maxEstimatedCost: 1 } },
    )
    return expect(budgetedGroup).resolves.toMatchObject({
      budget: expect.objectContaining({
        reasonCodes: ["cost_budget_exceeded"],
      }),
    })
  })

  it("links prompt bundle and model profile snapshot", () => {
    const result = buildAgentPromptBundle({
      agent: agentConfig(),
      taskScope,
      now: () => now,
    })
    expect(result.bundle.modelProfileSnapshot).toEqual(modelProfile())
    expect(result.bundle.fragments?.find((fragment) => fragment.kind === "model_profile")).toEqual(
      expect.objectContaining({
        status: "active",
        content: expect.stringContaining("modelId: gpt-5.4"),
      }),
    )
  })

  it("applies timeout fallback in the sub-session runner and records model audit", async () => {
    const { dependencies, sessions, events, ledger } = makeMemoryDependencies()
    const runner = new SubSessionRunner(dependencies)
    const attempts: string[] = []

    const outcome = await runner.runSubSession(
      {
        command: command("timeout-fallback"),
        agent: { agentId: "agent:model", displayName: "Model Agent", nickname: "Modeler" },
        parentSessionId: "session-parent",
        promptBundle: promptBundle(modelProfile({ timeoutMs: 1, retryCount: 1 })),
      },
      async (input, controls) => {
        attempts.push(controls.modelExecution.modelId)
        if (controls.modelExecution.modelId === "gpt-5.4") {
          await new Promise(() => undefined)
        }
        return createTextResultReport({ command: input.command, text: "fallback result" })
      },
    )

    expect(outcome.status).toBe("completed")
    expect(attempts).toEqual(["gpt-5.4", "gpt-5.4-mini"])
    expect(outcome.modelExecution).toEqual(
      expect.objectContaining({
        modelId: "gpt-5.4-mini",
        fallbackApplied: true,
        fallbackReasonCode: "sub_session_timeout",
        attemptCount: 2,
      }),
    )
    expect(outcome.modelExecution?.tokenUsage.totalTokens).toBeGreaterThan(0)
    expect(sessions.get("sub:timeout-fallback")?.modelExecutionSnapshot).toEqual(
      expect.objectContaining({ modelId: "gpt-5.4-mini" }),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sub_session_model_resolved:sub:timeout-fallback"),
        expect.stringContaining("sub_session_model_fallback:sub:timeout-fallback:gpt-5.4-mini"),
      ]),
    )
    expect(ledger.some((entry) => JSON.stringify(entry.detail).includes("modelExecution"))).toBe(
      true,
    )
    expect(listLatencyMetrics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "model_execution_latency_ms",
          detail: expect.objectContaining({
            modelId: "gpt-5.4-mini",
            fallbackApplied: true,
          }),
        }),
      ]),
    )
  })

  it("uses per-agent retry count without escalating beyond the model policy", async () => {
    const { dependencies, events } = makeMemoryDependencies()
    const runner = new SubSessionRunner(dependencies)
    let attempts = 0

    const outcome = await runner.runSubSession(
      {
        command: command("retry"),
        agent: { agentId: "agent:model", displayName: "Model Agent", nickname: "Modeler" },
        parentSessionId: "session-parent",
        promptBundle: promptBundle(
          modelProfile({ retryCount: 1, fallbackModelId: undefined, timeoutMs: 1000 }),
        ),
      },
      (input) => {
        attempts += 1
        if (attempts === 1) throw new Error("transient")
        return createTextResultReport({ command: input.command, text: "retried result" })
      },
    )

    expect(outcome.status).toBe("completed")
    expect(attempts).toBe(2)
    expect(outcome.modelExecution?.attemptCount).toBe(2)
    expect(events).toEqual(
      expect.arrayContaining(["sub_session_model_retry:sub:retry:1:sub_session_handler_error"]),
    )
  })

  it("wires model execution policy regression into the release gate", () => {
    const pipeline = buildReleasePipelinePlan()
    expect(pipeline.steps.find((step) => step.id === "model-execution-release-gate")).toEqual(
      expect.objectContaining({
        required: true,
        command: ["pnpm", "test", "tests/task021-model-execution-policy.test.ts"],
      }),
    )
    expect(buildCleanMachineInstallChecklist()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "model-execution-release-gate", required: true }),
      ]),
    )
  })
})
