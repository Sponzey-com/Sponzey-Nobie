import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { DEFAULT_CONFIG } from "../packages/core/src/config/types.ts"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  CapabilityPolicy,
  OwnerScope,
  PermissionProfile,
  RuntimeIdentity,
  SkillMcpAllowlist,
  SubSessionContract,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { getControlTimeline } from "../packages/core/src/control-plane/timeline.ts"
import {
  closeDb,
  getCapabilityDelegation,
  getDb,
  getRunSubSession,
  insertRunSubSession,
  insertSession,
  upsertAgentCapabilityBinding,
} from "../packages/core/src/db/index.js"
import { mcpRegistry } from "../packages/core/src/mcp/registry.ts"
import {
  buildCleanMachineInstallChecklist,
  buildReleasePipelinePlan,
} from "../packages/core/src/release/package.ts"
import { createRootRun, getRootRun } from "../packages/core/src/runs/store.js"
import {
  acquireAgentCapabilityRateLimit,
  applyCapabilityDelegationApprovalDecision,
  buildCapabilityApprovalAggregationEvent,
  buildCapabilityDelegationRequest,
  buildCapabilityResultDataExchange,
  buildDangerousCapabilityFixtureMatrix,
  evaluateAgentToolCapabilityPolicy,
  recordCapabilityDelegationRequest,
  resetAgentCapabilityRateLimitsForTest,
} from "../packages/core/src/security/capability-isolation.ts"
import { ToolDispatcher } from "../packages/core/src/tools/dispatcher.ts"
import { toolDispatcher } from "../packages/core/src/tools/index.js"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(__dirname, "fixtures/fake-mcp-server.mjs")
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  resetAgentCapabilityRateLimitsForTest()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task020-capability-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = undefined
  reloadConfig()
}

async function restoreState(): Promise<void> {
  await mcpRegistry.closeAll()
  closeDb()
  resetAgentCapabilityRateLimitsForTest()
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

function permissionProfile(overrides: Partial<PermissionProfile> = {}): PermissionProfile {
  return {
    profileId: "profile:task020",
    riskCeiling: "dangerous",
    approvalRequiredFrom: "sensitive",
    allowExternalNetwork: true,
    allowFilesystemWrite: true,
    allowShellExecution: false,
    allowScreenControl: false,
    allowedPaths: [],
    ...overrides,
  }
}

function allowlist(overrides: Partial<SkillMcpAllowlist> = {}): SkillMcpAllowlist {
  return {
    enabledSkillIds: ["skill:task020"],
    enabledMcpServerIds: ["fake"],
    enabledToolNames: ["task020_echo", "mcp__fake__echo", "echo"],
    disabledToolNames: ["shell_exec"],
    secretScopeId: "secret:agent:a",
    ...overrides,
  }
}

function policy(overrides: Partial<CapabilityPolicy> = {}): CapabilityPolicy {
  return {
    permissionProfile: permissionProfile(),
    skillMcpAllowlist: allowlist(),
    rateLimit: { maxConcurrentCalls: 1, maxCallsPerMinute: 2 },
    ...overrides,
  }
}

function toolContext(
  agentId: string,
  capabilityPolicy: CapabilityPolicy,
  overrides: Partial<ToolContext> = {},
): ToolContext & {
  agentId: string
  capabilityPolicy: CapabilityPolicy
  auditId: string
} {
  return {
    sessionId: `session:${agentId}`,
    runId: `run:${agentId}`,
    requestGroupId: `group:${agentId}`,
    workDir: process.cwd(),
    userMessage: "task020 capability isolation",
    source: "webui",
    allowWebAccess: true,
    onProgress: () => {},
    signal: new AbortController().signal,
    agentId,
    agentType: "sub_agent",
    capabilityPolicy,
    auditId: `audit:${agentId}`,
    ...(capabilityPolicy.skillMcpAllowlist.secretScopeId
      ? { secretScopeId: capabilityPolicy.skillMcpAllowlist.secretScopeId }
      : {}),
    ...overrides,
  }
}

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: owner("nobie", "agent:nobie"),
    idempotencyKey: `idem:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run:task020",
      parentSessionId: "session:task020",
      parentSubSessionId: "sub:task020",
    },
  }
}

function subSession(): SubSessionContract {
  return {
    identity: identity("sub_session", "sub:task020"),
    subSessionId: "sub:task020",
    parentSessionId: "session:task020",
    parentRunId: "run:task020",
    parentAgentId: "agent:nobie",
    parentAgentDisplayName: "Nobie",
    parentAgentNickname: "노비",
    agentId: "agent:a",
    agentDisplayName: "Agent A",
    agentNickname: "A",
    commandRequestId: "command:task020",
    status: "awaiting_approval",
    retryBudgetRemaining: 1,
    promptBundleId: "prompt:task020",
    startedAt: now,
  }
}

function registerBinding(input: {
  bindingId: string
  agentId: string
  capabilityKind?: "skill" | "mcp_server"
  catalogId?: string
  secretScopeId?: string
  enabledToolNames?: string[]
}): void {
  upsertAgentCapabilityBinding(
    {
      bindingId: input.bindingId,
      agentId: input.agentId,
      capabilityKind: input.capabilityKind ?? "skill",
      catalogId: input.catalogId ?? "skill:task020",
      status: "enabled",
      ...(input.secretScopeId ? { secretScopeId: input.secretScopeId } : {}),
      enabledToolNames: input.enabledToolNames ?? ["task020_echo"],
    },
    { now },
  )
}

beforeEach(() => {
  useTempState()
})

afterEach(async () => {
  await restoreState()
})

describe("task020 skill, MCP, tool permission isolation and approval", () => {
  it("dispatches only with the owning agent capability binding and records denied audit", async () => {
    registerBinding({ bindingId: "binding:agent:a:echo", agentId: "agent:a" })
    const dispatcher = new ToolDispatcher()
    let calls = 0
    dispatcher.register({
      name: "task020_echo",
      description: "task020 echo",
      parameters: { type: "object", properties: {} },
      riskLevel: "safe",
      requiresApproval: false,
      async execute() {
        calls += 1
        return { success: true, output: "ok" }
      },
    })

    const allowed = await dispatcher.dispatchAgentScoped({
      toolName: "task020_echo",
      params: {},
      capabilityBindingId: "binding:agent:a:echo",
      resultSharing: "data_exchange",
      ctx: toolContext("agent:a", policy()),
    })
    expect(allowed).toMatchObject({ success: true, output: "ok" })
    expect(calls).toBe(1)

    const denied = await dispatcher.dispatchAgentScoped({
      toolName: "task020_echo",
      params: {},
      capabilityBindingId: "binding:agent:a:echo",
      resultSharing: "data_exchange",
      ctx: toolContext(
        "agent:b",
        policy({ skillMcpAllowlist: allowlist({ secretScopeId: "secret:agent:b" }) }),
      ),
    })
    expect(denied).toMatchObject({
      success: false,
      error: "capability_binding_owner_mismatch",
    })
    expect(calls).toBe(1)
    expect(
      getDb()
        .prepare<[], { n: number }>(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE tool_name = 'task020_echo' AND error_code = 'capability_binding_owner_mismatch'",
        )
        .get()?.n,
    ).toBe(1)
  })

  it("uses separate MCP client sessions and secret scopes per agent binding", async () => {
    registerBinding({
      bindingId: "binding:agent:a:fake",
      agentId: "agent:a",
      capabilityKind: "mcp_server",
      catalogId: "fake",
      secretScopeId: "secret:agent:a",
      enabledToolNames: ["mcp__fake__echo", "echo"],
    })
    registerBinding({
      bindingId: "binding:agent:b:fake",
      agentId: "agent:b",
      capabilityKind: "mcp_server",
      catalogId: "fake",
      secretScopeId: "secret:agent:b",
      enabledToolNames: ["mcp__fake__echo", "echo"],
    })
    await mcpRegistry.loadFromConfig({
      ...DEFAULT_CONFIG,
      mcp: {
        servers: {
          fake: {
            command: process.execPath,
            args: [fixture],
            startupTimeoutSec: 3,
            toolTimeoutSec: 3,
          },
        },
      },
    })

    const agentA = await toolDispatcher.dispatchAgentScoped({
      toolName: "mcp__fake__echo",
      params: { text: "agent-a" },
      capabilityBindingId: "binding:agent:a:fake",
      resultSharing: "data_exchange",
      ctx: toolContext("agent:a", policy()),
    })
    const agentB = await toolDispatcher.dispatchAgentScoped({
      toolName: "mcp__fake__echo",
      params: { text: "agent-b" },
      capabilityBindingId: "binding:agent:b:fake",
      resultSharing: "data_exchange",
      ctx: toolContext(
        "agent:b",
        policy({
          skillMcpAllowlist: allowlist({ secretScopeId: "secret:agent:b" }),
        }),
      ),
    })
    expect(agentA).toMatchObject({ success: true, output: "agent-a" })
    expect(agentB).toMatchObject({ success: true, output: "agent-b" })

    const sessions = mcpRegistry.getAgentSessionSnapshot()
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "agent:a",
          bindingId: "binding:agent:a:fake",
          secretScopeId: "secret:agent:a",
        }),
        expect.objectContaining({
          agentId: "agent:b",
          bindingId: "binding:agent:b:fake",
          secretScopeId: "secret:agent:b",
        }),
      ]),
    )
    expect(new Set(sessions.map((session) => session.sessionKey)).size).toBe(2)
  })

  it("blocks parent secret fallback by default and requires explicit allowlist plus audit", () => {
    registerBinding({
      bindingId: "binding:agent:a:fake",
      agentId: "agent:a",
      capabilityKind: "mcp_server",
      catalogId: "fake",
      enabledToolNames: ["mcp__fake__echo", "echo"],
    })
    const noSecretAllowlist: SkillMcpAllowlist = {
      enabledSkillIds: ["skill:task020"],
      enabledMcpServerIds: ["fake"],
      enabledToolNames: ["task020_echo", "mcp__fake__echo", "echo"],
      disabledToolNames: ["shell_exec"],
    }
    const noSecretPolicy = policy({ skillMcpAllowlist: noSecretAllowlist })
    const denied = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__fake__echo",
      riskLevel: "moderate",
      ctx: toolContext("agent:a", noSecretPolicy, {
        capabilityBindingId: "binding:agent:a:fake",
        parentSecretScopeId: "secret:parent",
      }),
    })
    expect(denied).toMatchObject({
      allowed: false,
      reasonCode: "parent_secret_fallback_forbidden",
    })

    const allowed = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__fake__echo",
      riskLevel: "moderate",
      ctx: toolContext("agent:a", noSecretPolicy, {
        capabilityBindingId: "binding:agent:a:fake",
        parentSecretScopeId: "secret:parent",
        allowParentSecretFallback: true,
        fallbackSecretScopeAllowlist: ["binding:agent:a:fake"],
        auditId: "audit:parent-fallback",
      }),
    })
    expect(allowed).toMatchObject({
      allowed: true,
      secretScopeId: "secret:parent",
      parentSecretFallback: true,
    })
  })

  it("rate limits by agent binding, and marks dangerous capability approval fixtures clearly", () => {
    registerBinding({
      bindingId: "binding:agent:a:one",
      agentId: "agent:a",
      catalogId: "skill:task020:one",
      enabledToolNames: ["task020_echo", "file_write"],
    })
    registerBinding({
      bindingId: "binding:agent:a:two",
      agentId: "agent:a",
      catalogId: "skill:task020:two",
    })
    const ctx = toolContext("agent:a", policy())
    const one = evaluateAgentToolCapabilityPolicy({
      toolName: "task020_echo",
      riskLevel: "safe",
      ctx: { ...ctx, capabilityBindingId: "binding:agent:a:one" },
    })
    const two = evaluateAgentToolCapabilityPolicy({
      toolName: "task020_echo",
      riskLevel: "safe",
      ctx: { ...ctx, capabilityBindingId: "binding:agent:a:two" },
    })

    const lease = acquireAgentCapabilityRateLimit({ decision: one, now })
    expect(() => acquireAgentCapabilityRateLimit({ decision: one, now })).toThrow(
      /rate limit exceeded/u,
    )
    const otherBinding = acquireAgentCapabilityRateLimit({ decision: two, now })
    otherBinding.release()
    lease.release()

    const matrix = buildDangerousCapabilityFixtureMatrix()
    expect(matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          riskLevel: "low",
          approvalActor: "parent_agent",
          expectedStatus: "approved",
        }),
        expect.objectContaining({
          riskLevel: "high",
          approvalActor: "user",
          denialReason: "risk_ceiling_exceeded",
          expectedStatus: "denied",
        }),
        expect.objectContaining({
          riskLevel: "critical",
          approvalActor: "admin",
          denialReason: "timeout",
          expectedStatus: "expired",
        }),
        expect.objectContaining({
          riskLevel: "critical",
          approvalActor: "admin",
          denialReason: "revoked",
          expectedStatus: "denied",
        }),
      ]),
    )

    const approvalDecision = evaluateAgentToolCapabilityPolicy({
      toolName: "file_write",
      riskLevel: "dangerous",
      ctx: {
        ...ctx,
        capabilityBindingId: "binding:agent:a:one",
        capabilityPolicy: policy({
          permissionProfile: permissionProfile({ approvalRequiredFrom: "moderate" }),
          skillMcpAllowlist: allowlist({ enabledToolNames: ["file_write"] }),
        }),
      },
    })
    expect(approvalDecision).toMatchObject({
      allowed: true,
      approvalRequired: true,
      reasonCode: "capability_approval_required",
    })
    expect(
      buildCapabilityApprovalAggregationEvent({ decision: approvalDecision, now }),
    ).toMatchObject({
      kind: "capability_approval_required",
      agentId: "agent:a",
      toolName: "file_write",
    })
  })

  it("updates capability delegation lifecycle, audit, parent run, and sub-session on approval denial", () => {
    insertSession({
      id: "session:task020",
      source: "webui",
      source_id: "task020",
      created_at: now,
      updated_at: now,
      summary: "task020",
    })
    createRootRun({
      id: "run:task020",
      sessionId: "session:task020",
      requestGroupId: "group:task020",
      prompt: "task020 approval propagation",
      source: "webui",
    })
    insertRunSubSession(subSession(), { now })
    const delegation = buildCapabilityDelegationRequest({
      requester: owner("nobie", "agent:nobie"),
      provider: owner("sub_agent", "agent:a"),
      capability: "mcp__fake__echo",
      risk: "sensitive",
      inputPackageIds: ["exchange:input"],
      delegationId: "delegation:task020",
      approvalId: "approval:task020",
      parentRunId: "run:task020",
      parentSessionId: "session:task020",
      parentSubSessionId: "sub:task020",
      auditCorrelationId: "audit:task020",
    })
    expect(recordCapabilityDelegationRequest(delegation, { now })).toBe(true)
    const denied = applyCapabilityDelegationApprovalDecision({
      delegationId: "delegation:task020",
      decision: "deny",
      denialReason: "permission_denied",
      parentRunId: "run:task020",
      subSessionId: "sub:task020",
      auditId: "audit:task020",
      now,
    })
    expect(denied).toMatchObject({
      ok: true,
      previousStatus: "requested",
      status: "denied",
      reasonCode: "permission_denied",
    })
    expect(getCapabilityDelegation("delegation:task020")?.status).toBe("denied")
    expect(getRootRun("run:task020")?.status).toBe("cancelled")
    expect(getRunSubSession("sub:task020")?.status).toBe("cancelled")
    expect(getControlTimeline({ component: "capability.delegation" }).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "capability.delegation.requested" }),
        expect.objectContaining({ eventType: "capability.delegation.denied" }),
      ]),
    )

    const resultPackage = buildCapabilityResultDataExchange({
      delegation: { ...delegation, status: "completed" },
      payload: {
        summary: "tool result",
        toolHandle: "raw-handle",
        nested: { token: "secret-token", visible: "ok" },
      },
      exchangeId: "exchange:task020:result",
      idempotencyKey: "exchange:task020:result",
      now: () => now,
    })
    expect(resultPackage.allowedUse).toBe("verification_only")
    expect(resultPackage.payload.resultSharing).toBe("data_exchange_only")
    expect(JSON.stringify(resultPackage.payload)).not.toContain("raw-handle")
    expect(JSON.stringify(resultPackage.payload)).not.toContain("secret-token")
  })

  it("wires the capability isolation release gate into packaging checks", () => {
    const pipeline = buildReleasePipelinePlan()
    expect(pipeline.order).toContain("capability-isolation-release-gate")
    expect(pipeline.steps.find((step) => step.id === "capability-isolation-release-gate")).toEqual(
      expect.objectContaining({
        required: true,
        command: [
          "pnpm",
          "test",
          "tests/task020-capability-approval-isolation.test.ts",
          "tests/mcp-client.test.ts",
        ],
      }),
    )
    expect(buildCleanMachineInstallChecklist()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "capability-isolation-release-gate", required: true }),
      ]),
    )
  })
})
