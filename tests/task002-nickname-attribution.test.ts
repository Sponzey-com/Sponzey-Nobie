import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getRunSubSession,
  insertRunSubSession,
  NicknameNamespaceError,
  upsertAgentConfig,
  upsertTeamConfig,
} from "../packages/core/src/db/index.ts"
import {
  CONTRACT_SCHEMA_VERSION,
  createTextResultReport,
  normalizeNickname,
  normalizeNicknameSnapshot,
  validateNamedDeliveryEvent,
  validateNamedHandoffEvent,
  validateAgentConfig,
  validateUserVisibleAgentMessage,
  type CommandRequest,
  type ExpectedOutputContract,
  type MemoryPolicy,
  type NicknameSnapshot,
  type PermissionProfile,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type StructuredTaskScope,
  type SubAgentConfig,
  type SubSessionContract,
  type TeamConfig,
} from "../packages/core/src/index.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 23, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task002-nickname-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

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

const permissionProfile: PermissionProfile = {
  profileId: "profile:safe",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: true,
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

function owner(ownerId = "agent:nobie"): RuntimeIdentity["owner"] {
  return { ownerType: "nobie", ownerId }
}

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: owner(),
    idempotencyKey: `idempotency:${entityType}:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

function memoryPolicy(agentId: string): MemoryPolicy {
  return {
    owner: { ownerType: "sub_agent", ownerId: agentId },
    visibility: "private",
    readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
    writeScope: { ownerType: "sub_agent", ownerId: agentId },
    retentionPolicy: "long_term",
    writebackReviewRequired: true,
  }
}

function subAgent(input: {
  agentId: string
  nickname: string
  displayName?: string
  status?: SubAgentConfig["status"]
}): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: input.agentId,
    displayName: input.displayName ?? input.nickname,
    nickname: input.nickname,
    status: input.status ?? "enabled",
    role: "worker",
    personality: "Precise",
    specialtyTags: ["general"],
    avoidTasks: [],
    memoryPolicy: memoryPolicy(input.agentId),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: [],
    delegation: {
      enabled: true,
      maxParallelSessions: 1,
      retryBudget: 1,
    },
  }
}

function team(input: {
  teamId: string
  nickname: string
  memberAgentIds?: string[]
}): TeamConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId: input.teamId,
    displayName: input.nickname,
    nickname: input.nickname,
    status: "enabled",
    purpose: "Planning group",
    memberAgentIds: input.memberAgentIds ?? [],
    roleHints: [],
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Answer returned to Nobie review.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["reviewable_result"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Collect result",
  intentType: "runtime_test",
  actionType: "sub_session_runtime",
  constraints: ["Do not deliver directly to the user."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["runtime_test"],
}

function command(targetNicknameSnapshot = "Researcher"): CommandRequest {
  return {
    identity: identity("sub_session", "command:1"),
    commandRequestId: "command:1",
    parentRunId: "run-parent",
    subSessionId: "sub-session:1",
    targetAgentId: "agent:researcher",
    targetNicknameSnapshot,
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget: 1,
  }
}

function subSession(agentNickname = "Researcher"): SubSessionContract {
  return {
    identity: identity("sub_session", "sub-session:1"),
    subSessionId: "sub-session:1",
    parentSessionId: "session-parent",
    parentRunId: "run-parent",
    agentId: "agent:researcher",
    agentDisplayName: "Researcher display",
    agentNickname,
    commandRequestId: "command:1",
    status: "queued",
    retryBudgetRemaining: 1,
    promptBundleId: "bundle:1",
  }
}

function nicknameSnapshot(entityId: string, nickname: string): NicknameSnapshot {
  return {
    entityType: entityId.startsWith("team:") ? "team" : "sub_agent",
    entityId,
    nicknameSnapshot: nickname,
  }
}

describe("task002 nickname and user-facing attribution", () => {
  it("normalizes nicknames with trim, whitespace collapse, and case folding", () => {
    expect(normalizeNickname("  Research   Agent  ")).toBe("research agent")
    expect(normalizeNickname("  노비   리서치  ")).toBe("노비 리서치")
    expect(normalizeNicknameSnapshot("  Research   Agent  ")).toBe("Research Agent")
    const invalidAgent = validateAgentConfig({
      ...subAgent({ agentId: "agent:missing-nickname", nickname: "Researcher" }),
      nickname: "",
    })
    expect(invalidAgent.ok).toBe(false)
    if (!invalidAgent.ok) expect(invalidAgent.issues.map((issue) => issue.path)).toContain("$.nickname")
  })

  it("blocks duplicate agent nicknames in the normalized namespace", () => {
    upsertAgentConfig(subAgent({ agentId: "agent:researcher", nickname: "Research Agent" }), { now })

    let error: unknown
    try {
      upsertAgentConfig(subAgent({ agentId: "agent:writer", nickname: " research   agent " }), { now })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(NicknameNamespaceError)
    expect((error as NicknameNamespaceError).details).toMatchObject({
      reasonCode: "nickname_conflict",
      attemptedEntityType: "agent",
      attemptedEntityId: "agent:writer",
      existingEntityType: "agent",
      existingEntityId: "agent:researcher",
      normalizedNickname: "research agent",
    })
  })

  it("blocks team nicknames that collide with agent nicknames", () => {
    upsertAgentConfig(subAgent({ agentId: "agent:evidence", nickname: "Evidence Team" }), { now })

    expect(() => {
      upsertTeamConfig(team({ teamId: "team:evidence", nickname: " evidence   team " }), { now })
    }).toThrow(NicknameNamespaceError)
  })

  it("validates user-visible message, handoff, and delivery attribution snapshots", () => {
    const speaker = nicknameSnapshot("agent:researcher", "Researcher")
    const recipient = { entityType: "nobie" as const, entityId: "agent:nobie", nicknameSnapshot: "노비" }

    expect(validateUserVisibleAgentMessage({
      identity: identity("sub_session", "message:1"),
      messageId: "message:1",
      parentRunId: "run-parent",
      speaker,
      text: "조사 결과를 요약했습니다.",
      createdAt: now,
    }).ok).toBe(true)

    const invalidMessage = validateUserVisibleAgentMessage({
      identity: identity("sub_session", "message:2"),
      messageId: "message:2",
      parentRunId: "run-parent",
      speaker: { ...speaker, nicknameSnapshot: "", displayName: "Researcher" },
      text: "invalid",
      createdAt: now,
    })
    expect(invalidMessage.ok).toBe(false)
    if (!invalidMessage.ok) {
      expect(invalidMessage.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        "$.speaker.nicknameSnapshot",
        "$.speaker.displayName",
      ]))
    }

    expect(validateNamedHandoffEvent({
      identity: identity("data_exchange", "handoff:1"),
      handoffId: "handoff:1",
      parentRunId: "run-parent",
      sender: recipient,
      recipient: speaker,
      purpose: "context handoff",
      createdAt: now,
    }).ok).toBe(true)

    const invalidDelivery = validateNamedDeliveryEvent({
      identity: identity("data_exchange", "delivery:1"),
      deliveryId: "delivery:1",
      parentRunId: "run-parent",
      deliveryKind: "data_exchange",
      sender: { ...speaker, nicknameSnapshot: "" },
      recipient,
      summary: "context delivered",
      exchangeId: "exchange:1",
      createdAt: now,
    })
    expect(invalidDelivery.ok).toBe(false)
    if (!invalidDelivery.ok) {
      expect(invalidDelivery.issues.map((issue) => issue.path)).toContain("$.sender.nicknameSnapshot")
    }

    const invalidRecipient = validateNamedDeliveryEvent({
      identity: identity("data_exchange", "delivery:2"),
      deliveryId: "delivery:2",
      parentRunId: "run-parent",
      deliveryKind: "data_exchange",
      sender: speaker,
      recipient: { ...recipient, nicknameSnapshot: "" },
      summary: "context delivered",
      exchangeId: "exchange:2",
      createdAt: now,
    })
    expect(invalidRecipient.ok).toBe(false)
    if (!invalidRecipient.ok) {
      expect(invalidRecipient.issues.map((issue) => issue.path)).toContain("$.recipient.nicknameSnapshot")
    }
  })

  it("keeps result source nickname snapshots for parent final answer synthesis", () => {
    const result = createTextResultReport({
      command: command("  Researcher  "),
      idProvider: () => "result:1",
      text: "evidence summary",
    })

    expect(result.source).toEqual({
      entityType: "sub_agent",
      entityId: "agent:researcher",
      nicknameSnapshot: "Researcher",
    })
    const source = result.source
    if (!source) throw new Error("result source nickname snapshot missing")
    expect(validateNamedDeliveryEvent({
      identity: identity("data_exchange", "delivery:result"),
      deliveryId: "delivery:result",
      parentRunId: result.parentRunId,
      deliveryKind: "result_report",
      sender: source,
      recipient: { entityType: "nobie", entityId: "agent:nobie", nicknameSnapshot: "노비" },
      summary: "sub-agent result returned",
      resultReportId: result.resultReportId,
      createdAt: now,
    }).ok).toBe(true)
  })

  it("keeps historical sub-session nickname snapshots after an agent nickname changes", () => {
    upsertAgentConfig(subAgent({ agentId: "agent:researcher", nickname: "Researcher" }), { now })
    expect(insertRunSubSession(subSession("Researcher"), { now })).toBe(true)

    upsertAgentConfig(subAgent({ agentId: "agent:researcher", nickname: "Analyst" }), { now: now + 1 })
    const row = getRunSubSession("sub-session:1")
    const stored = JSON.parse(row?.contract_json ?? "{}") as Partial<SubSessionContract>

    expect(row?.agent_nickname).toBe("Researcher")
    expect(stored.agentNickname).toBe("Researcher")
  })
})
