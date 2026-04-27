import { describe, expect, it } from "vitest"
import {
  CONTRACT_SCHEMA_VERSION,
  buildFeedbackRequest,
  validateAgentConfig,
  validateAgentRelationship,
  validateCommandRequest,
  validateFeedbackRequest,
  validateOrchestrationPlan,
  validateResultReport,
  validateSubAgentDataExchangePackage,
  validateTeamConfig,
  validateTeamMembership,
  type CommandRequest,
  type DataExchangePackage,
  type ExpectedOutputContract,
  type MemoryPolicy,
  type OrchestrationPlan,
  type PermissionProfile,
  type ResultReport,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
  type TeamConfig,
  type TeamMembership,
} from "../packages/core/src/index.ts"
import {
  normalizeLegacyAgentConfigRow,
  normalizeLegacyTeamConfigRow,
} from "../packages/core/src/orchestration/config-normalization.ts"

const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function owner(ownerType: RuntimeIdentity["owner"]["ownerType"] = "nobie", ownerId = "agent:nobie"): RuntimeIdentity["owner"] {
  return { ownerType, ownerId }
}

function identity(entityType: RuntimeIdentity["entityType"], entityId: string, scope = owner()): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: scope,
    idempotencyKey: `idem:${entityType}:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: [],
}

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

const memoryPolicy: MemoryPolicy = {
  owner: owner("sub_agent", "agent:researcher"),
  visibility: "private",
  readScopes: [owner("sub_agent", "agent:researcher")],
  writeScope: owner("sub_agent", "agent:researcher"),
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Final answer",
  required: true,
  acceptance: {
    requiredEvidenceKinds: ["source"],
    artifactRequired: false,
    reasonCodes: ["source_backed_answer"],
  },
}

function agentConfig(): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: "agent:researcher",
    displayName: "Researcher",
    nickname: "Researcher",
    normalizedNickname: "researcher",
    status: "enabled",
    role: "research worker",
    personality: "Evidence-first and concise",
    specialtyTags: ["research", "verification"],
    avoidTasks: ["unapproved shell"],
    modelProfile: {
      providerId: "openai",
      modelId: "gpt-5.4",
      temperature: 0.1,
      maxOutputTokens: 4000,
      timeoutMs: 30000,
      retryCount: 2,
    },
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 2, maxCallsPerMinute: 30 },
    },
    delegationPolicy: {
      enabled: true,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
    teamIds: ["team:research"],
    delegation: {
      enabled: true,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
    profileVersion: 2,
    createdAt: now,
    updatedAt: now,
  }
}

function teamMembership(): TeamMembership {
  return {
    membershipId: "membership:research:1",
    teamId: "team:research",
    agentId: "agent:researcher",
    ownerAgentIdSnapshot: "agent:nobie",
    teamRoles: ["research", "evidence"],
    primaryRole: "research",
    required: true,
    sortOrder: 0,
    status: "active",
  }
}

function teamConfig(): TeamConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId: "team:research",
    displayName: "Research Team",
    nickname: "Research",
    normalizedNickname: "research",
    status: "enabled",
    purpose: "Collect evidence and draft verified findings.",
    ownerAgentId: "agent:nobie",
    leadAgentId: "agent:researcher",
    memberCountMin: 1,
    memberCountMax: 2,
    requiredTeamRoles: ["research"],
    requiredCapabilityTags: ["web_search"],
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
    memberships: [teamMembership()],
    memberAgentIds: ["agent:researcher"],
    roleHints: ["research"],
    profileVersion: 2,
    createdAt: now,
    updatedAt: now,
  }
}

function commandRequest(): CommandRequest {
  return {
    identity: identity("sub_session", "sub:research", owner("sub_agent", "agent:researcher")),
    commandRequestId: "command:research",
    parentRunId: "run-parent",
    subSessionId: "sub:research",
    targetAgentId: "agent:researcher",
    targetNicknameSnapshot: "Researcher",
    taskScope: {
      goal: "Collect evidence",
      intentType: "research",
      actionType: "collect_evidence",
      constraints: ["Return typed outputs only."],
      expectedOutputs: [expectedOutput],
      reasonCodes: ["needs_evidence"],
    },
    contextPackageIds: ["exchange:ctx-1"],
    expectedOutputs: [expectedOutput],
    retryBudget: 2,
  }
}

function dataExchange(): DataExchangePackage {
  return {
    identity: identity("data_exchange", "exchange:ctx-1"),
    exchangeId: "exchange:ctx-1",
    sourceOwner: owner("nobie", "agent:nobie"),
    recipientOwner: owner("sub_agent", "agent:researcher"),
    sourceNicknameSnapshot: "Nobie",
    recipientNicknameSnapshot: "Researcher",
    purpose: "Provide synthesized task context.",
    allowedUse: "temporary_context",
    retentionPolicy: "session_only",
    redactionState: "not_sensitive",
    provenanceRefs: ["run:parent", "session:root"],
    payload: { summary: "Use cited evidence." },
    createdAt: now,
  }
}

function resultReport(overrides: Partial<ResultReport> = {}): ResultReport {
  return {
    identity: identity("sub_session", "sub:research", owner("sub_agent", "agent:researcher")),
    resultReportId: "result:research",
    parentRunId: "run-parent",
    subSessionId: "sub:research",
    source: {
      entityType: "sub_agent",
      entityId: "agent:researcher",
      nicknameSnapshot: "Researcher",
    },
    status: "completed",
    outputs: [{ outputId: "answer", status: "satisfied", value: "42" }],
    evidence: [{ evidenceId: "evidence:1", kind: "source", sourceRef: "https://example.test/source" }],
    artifacts: [],
    risksOrGaps: [],
    ...overrides,
  }
}

function orchestrationPlan(): OrchestrationPlan {
  return {
    identity: identity("session", "plan:research"),
    planId: "plan:research",
    parentRunId: "run-parent",
    parentRequestId: "request-parent",
    directNobieTasks: [{
      taskId: "task:direct",
      executionKind: "direct_nobie",
      scope: {
        goal: "Integrate verified evidence",
        intentType: "answer",
        actionType: "synthesize",
        constraints: ["Preserve citations."],
        expectedOutputs: [expectedOutput],
        reasonCodes: ["final_delivery"],
      },
      requiredCapabilities: [],
      resourceLockIds: [],
    }],
    delegatedTasks: [{
      taskId: "task:delegated",
      executionKind: "delegated_sub_agent",
      assignedAgentId: "agent:researcher",
      assignedTeamId: "team:research",
      scope: commandRequest().taskScope,
      requiredCapabilities: ["web_search"],
      resourceLockIds: ["lock:web"],
    }],
    dependencyEdges: [{ fromTaskId: "task:delegated", toTaskId: "task:direct", reasonCode: "needs_result" }],
    resourceLocks: [{ lockId: "lock:web", kind: "mcp_server", target: "browser", mode: "shared", reasonCode: "rate_limit" }],
    parallelGroups: [{
      groupId: "group:research",
      parentRunId: "run-parent",
      subSessionIds: ["sub:research"],
      dependencyEdges: [],
      resourceLocks: [{ lockId: "lock:web", kind: "mcp_server", target: "browser", mode: "shared", reasonCode: "rate_limit" }],
      concurrencyLimit: 1,
      status: "planned",
    }],
    approvalRequirements: [{
      approvalId: "approval:web",
      taskId: "task:delegated",
      agentId: "agent:researcher",
      capability: "web_search",
      risk: "moderate",
      reasonCode: "external_lookup",
    }],
    fallbackStrategy: {
      mode: "single_nobie",
      reasonCode: "no_sub_agent",
    },
    createdAt: now,
  }
}

describe("task003 contract normalization and validators", () => {
  it("validates enriched agent config and promotes legacy agent rows", () => {
    const legacy = normalizeLegacyAgentConfigRow({
      ...agentConfig(),
      normalizedNickname: undefined,
      modelProfile: undefined,
      delegationPolicy: undefined,
    }) as SubAgentConfig

    const validation = validateAgentConfig(legacy)

    expect(validation.ok).toBe(true)
    expect(legacy.normalizedNickname).toBe("researcher")
    expect(legacy.modelProfile.providerId).toBe("provider:unknown")
    expect(legacy.delegationPolicy?.retryBudget).toBe(2)
  })

  it("promotes legacy team rows without losing member or role meaning across serialization boundaries", () => {
    const normalized = normalizeLegacyTeamConfigRow({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      teamId: "team:research",
      displayName: "Research Team",
      nickname: "Research",
      status: "enabled",
      purpose: "Collect evidence and synthesize draft findings.",
      memberAgentIds: ["agent:researcher", "agent:reviewer"],
      roleHints: ["research", "review"],
      profileVersion: 1,
      createdAt: now,
      updatedAt: now,
    }) as TeamConfig

    expect(validateTeamConfig(normalized).ok).toBe(true)
    expect(JSON.parse(JSON.stringify(normalized))).toMatchInlineSnapshot(`
      {
        "conflictPolicy": "lead_decides",
        "createdAt": 1776988800000,
        "displayName": "Research Team",
        "leadAgentId": "agent:researcher",
        "memberAgentIds": [
          "agent:researcher",
          "agent:reviewer",
        ],
        "memberCountMax": 2,
        "memberCountMin": 2,
        "memberships": [
          {
            "agentId": "agent:researcher",
            "membershipId": "team:research:membership:1",
            "primaryRole": "research",
            "required": true,
            "sortOrder": 0,
            "status": "active",
            "teamId": "team:research",
            "teamRoles": [
              "research",
            ],
          },
          {
            "agentId": "agent:reviewer",
            "membershipId": "team:research:membership:2",
            "primaryRole": "review",
            "required": true,
            "sortOrder": 1,
            "status": "active",
            "teamId": "team:research",
            "teamRoles": [
              "review",
            ],
          },
        ],
        "nickname": "Research",
        "normalizedNickname": "research",
        "ownerAgentId": "agent:nobie",
        "profileVersion": 1,
        "purpose": "Collect evidence and synthesize draft findings.",
        "requiredCapabilityTags": [],
        "requiredTeamRoles": [
          "research",
          "review",
        ],
        "resultPolicy": "lead_synthesis",
        "roleHints": [
          "research",
          "review",
        ],
        "schemaVersion": 1,
        "status": "enabled",
        "teamId": "team:research",
        "updatedAt": 1776988800000,
      }
    `)
    expect(validateTeamConfig(JSON.parse(JSON.stringify(normalized))).ok).toBe(true)
  })

  it("rejects new-shape team configs without owner scope", () => {
    const invalid = validateTeamConfig({
      ...teamConfig(),
      ownerAgentId: "",
    })

    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.issues.map((issue) => issue.path)).toContain("$.ownerAgentId")
  })

  it("validates team memberships and rejects invalid parent-child relationships", () => {
    expect(validateTeamMembership(teamMembership()).ok).toBe(true)

    const invalidRelationship = validateAgentRelationship({
      edgeId: "edge:1",
      parentAgentId: "agent:researcher",
      childAgentId: "agent:researcher",
      relationshipType: "parent_child",
      status: "active",
      sortOrder: 0,
    })

    expect(invalidRelationship.ok).toBe(false)
    if (!invalidRelationship.ok) expect(invalidRelationship.issues.map((issue) => issue.path)).toContain("$.childAgentId")
  })

  it("validates orchestration plan tasks, dependencies, parallel groups, locks, and approvals", () => {
    const validation = validateOrchestrationPlan(orchestrationPlan())

    expect(validation.ok).toBe(true)
    if (validation.ok) {
      expect(validation.value.directNobieTasks[0]?.executionKind).toBe("direct_nobie")
      expect(validation.value.delegatedTasks[0]?.executionKind).toBe("delegated_sub_agent")
      expect(validation.value.approvalRequirements[0]?.capability).toBe("web_search")
    }
  })

  it("validates command and data exchange contracts and rejects invalid runtime entity types", () => {
    expect(validateCommandRequest(commandRequest()).ok).toBe(true)
    expect(validateSubAgentDataExchangePackage(dataExchange()).ok).toBe(true)

    const invalid = validateCommandRequest({
      ...commandRequest(),
      identity: {
        ...commandRequest().identity,
        entityType: "agent",
      },
    })

    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.issues.map((issue) => issue.path)).toContain("$.identity.entityType")
  })

  it("rejects result reports when required outputs are missing", () => {
    const invalid = validateResultReport(resultReport({ outputs: [] }), { expectedOutputs: [expectedOutput] })

    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.issues.map((issue) => issue.path)).toContain("$.outputs")
  })

  it("rejects feedback requests without source result ids and retry budget, and validates generated feedback", () => {
    const feedback = buildFeedbackRequest({
      resultReport: resultReport({
        outputs: [
          { outputId: "answer", status: "satisfied", value: "42" },
          { outputId: "draft", status: "partial", value: "needs one more citation" },
        ],
      }),
      expectedOutputs: [expectedOutput],
      missingItems: ["missing_evidence:answer:source"],
      requiredChanges: ["Attach one source citation."],
      additionalContextRefs: ["exchange:ctx-1"],
      retryBudgetRemaining: 1,
      reasonCode: "sub_agent_result_review:required_evidence_missing:answer:source:none",
      now: () => now,
      idProvider: () => "feedback:1",
    })

    expect(validateFeedbackRequest(feedback).ok).toBe(true)
    expect(feedback.carryForwardOutputs).toEqual([
      { outputId: "answer", status: "satisfied", value: "42" },
      { outputId: "draft", status: "partial", value: "needs one more citation" },
    ])
    expect(feedback.sourceResultReportIds).toEqual(["result:research"])

    const invalid = validateFeedbackRequest({
      ...feedback,
      sourceResultReportIds: [],
      retryBudgetRemaining: undefined,
    } as unknown)

    expect(invalid.ok).toBe(false)
    if (!invalid.ok) {
      expect(invalid.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
        "$.sourceResultReportIds",
        "$.retryBudgetRemaining",
      ]))
    }
  })
})
