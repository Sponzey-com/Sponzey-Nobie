import { describe, expect, it } from "vitest"
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
  createTextResultReport,
  SubSessionRunner,
  type SubSessionRuntimeDependencies,
} from "../packages/core/src/orchestration/sub-session-runner.ts"

const now = Date.UTC(2026, 4, 8, 0, 0, 0)

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Child result for parent aggregation.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["child_result"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Prove model profile timeout does not fail the sub-session.",
  intentType: "runtime_test",
  actionType: "slow_child_result",
  constraints: ["Return only to parent aggregation."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["phase027_no_model_timeout"],
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:phase027",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: false,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: [],
}

const memoryPolicy: MemoryPolicy = {
  owner: { ownerType: "sub_agent", ownerId: "agent:slow" },
  visibility: "private",
  readScopes: [{ ownerType: "sub_agent", ownerId: "agent:slow" }],
  writeScope: { ownerType: "sub_agent", ownerId: "agent:slow" },
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

function identity(entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:slow" },
    idempotencyKey: `idem:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run:parent",
      parentRequestId: "request:parent",
    },
  }
}

function promptBundle(): AgentPromptBundle {
  return {
    identity: identity("prompt-bundle:phase027"),
    bundleId: "prompt-bundle:phase027",
    agentId: "agent:slow",
    agentType: "sub_agent",
    role: "slow child worker",
    displayNameSnapshot: "Slow Worker",
    nicknameSnapshot: "느림이",
    personalitySnapshot: "Careful.",
    teamContext: [],
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    modelProfileSnapshot: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      timeoutMs: 1,
      retryCount: 1,
      costBudget: 1,
    },
    taskScope,
    safetyRules: ["Child results are parent aggregation input only."],
    sourceProvenance: [{ sourceId: "profile:agent:slow", version: "1" }],
    renderedPrompt: "Return a child result after slow work.",
    completionCriteria: [expectedOutput],
    createdAt: now,
  }
}

function command(): CommandRequest {
  return {
    identity: identity("sub:slow"),
    commandRequestId: "command:slow",
    parentRunId: "run:parent",
    subSessionId: "sub:slow",
    targetAgentId: "agent:slow",
    targetNicknameSnapshot: "느림이",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
  }
}

function dependencies(): SubSessionRuntimeDependencies {
  const sessions = new Map<string, SubSessionContract>()
  let tick = now
  const clone = <T>(value: T): T => structuredClone(value)
  return {
    now: () => {
      tick += 1
      return tick
    },
    idProvider: () => `id:${++tick}`,
    loadSubSessionByIdempotencyKey: (idempotencyKey) =>
      clone([...sessions.values()].find((item) => item.identity.idempotencyKey === idempotencyKey)),
    persistSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
      return true
    },
    updateSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
    },
    appendParentEvent: () => undefined,
    isParentCancelled: () => false,
    isParentFinalized: () => false,
    recordLedgerEvent: () => "ledger:phase027",
  }
}

describe("phase027 sub-session model timeout removal", () => {
  it("keeps a slow handler completed even when legacy profile timeoutMs is tiny", async () => {
    const runner = new SubSessionRunner(dependencies())
    const outcome = await runner.runSubSession(
      {
        command: command(),
        agent: {
          agentId: "agent:slow",
          displayName: "Slow Worker",
          nickname: "느림이",
        },
        parentSessionId: "session:parent",
        promptBundle: promptBundle(),
        timeoutMs: 1,
      },
      async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return createTextResultReport({ command: input.command, text: "slow child result" })
      },
    )

    expect(outcome.status).toBe("completed")
    expect(outcome.errorReport?.reasonCode).toBeUndefined()
    expect(outcome.modelExecution?.attemptCount).toBe(1)
  })
})
