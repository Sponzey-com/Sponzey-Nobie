import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getCapabilityDelegation } from "../packages/core/src/db/index.ts"
import {
  buildCapabilityApprovalAggregationEvent,
  buildCapabilityDelegationRequest,
  buildCapabilityResultDataExchange,
  createCapabilityPolicySnapshot,
  evaluateAgentToolCapabilityPolicy,
  parseMcpRegisteredToolName,
  persistCapabilityResultDataExchange,
  recordCapabilityDelegationRequest,
  resetAgentCapabilityRateLimitsForTest,
  acquireAgentCapabilityRateLimit,
  type CapabilityPolicy,
  type McpServerStatus,
  type OwnerScope,
  type PermissionProfile,
  type SkillMcpAllowlist,
  type ToolContext,
} from "../packages/core/src/index.ts"
import { buildMcpToolCallPayload } from "../packages/core/src/mcp/client.ts"
import { filterMcpStatusesForAgentAllowlist } from "../packages/core/src/mcp/registry.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task009-capability-isolation-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
  resetAgentCapabilityRateLimitsForTest()
}

afterEach(() => {
  closeDb()
  resetAgentCapabilityRateLimitsForTest()
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

function permissionProfile(overrides: Partial<PermissionProfile> = {}): PermissionProfile {
  return {
    profileId: "profile:researcher",
    riskCeiling: "external",
    approvalRequiredFrom: "sensitive",
    allowExternalNetwork: true,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
    allowedPaths: [],
    ...overrides,
  }
}

function allowlist(overrides: Partial<SkillMcpAllowlist> = {}): SkillMcpAllowlist {
  return {
    enabledSkillIds: ["research"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search", "mcp__browser__search", "search"],
    disabledToolNames: ["shell_exec"],
    secretScopeId: "secret:agent:researcher",
    ...overrides,
  }
}

function capabilityPolicy(overrides: Partial<CapabilityPolicy> = {}): CapabilityPolicy {
  return {
    permissionProfile: permissionProfile(),
    skillMcpAllowlist: allowlist(),
    rateLimit: {
      maxConcurrentCalls: 1,
      maxCallsPerMinute: 2,
    },
    ...overrides,
  }
}

function toolContext(policy: CapabilityPolicy = capabilityPolicy(), overrides: Partial<ToolContext> = {}): ToolContext {
  const base: ToolContext = {
    sessionId: "session:task009",
    runId: "run:task009",
    requestGroupId: "group:task009",
    workDir: "/tmp",
    userMessage: "task009 capability isolation",
    source: "webui",
    allowWebAccess: true,
    onProgress: () => {},
    signal: new AbortController().signal,
    agentId: "agent:researcher",
    agentType: "sub_agent",
    capabilityPolicy: policy,
    auditId: "audit:task009",
    ...(policy.skillMcpAllowlist.secretScopeId ? { secretScopeId: policy.skillMcpAllowlist.secretScopeId } : {}),
  }
  return { ...base, ...overrides }
}

function legacyToolContext(): ToolContext {
  return {
    sessionId: "session:task009",
    runId: "run:task009",
    requestGroupId: "group:task009",
    workDir: "/tmp",
    userMessage: "task009 legacy context",
    source: "webui",
    allowWebAccess: true,
    onProgress: () => {},
    signal: new AbortController().signal,
  }
}

describe("task009 capability isolation", () => {
  it("resolves permission profile policy without semantic comparison", () => {
    const allowed = evaluateAgentToolCapabilityPolicy({
      toolName: "web_search",
      riskLevel: "safe",
      ctx: toolContext(),
    })
    expect(allowed.allowed).toBe(true)
    expect(allowed.capabilityRisk).toBe("external")
    expect(allowed.approvalRequired).toBe(false)
    expect(allowed.reasonCode).toBe("capability_allowed")

    const denied = evaluateAgentToolCapabilityPolicy({
      toolName: "file_write",
      riskLevel: "safe",
      ctx: toolContext(capabilityPolicy({
        permissionProfile: permissionProfile({ riskCeiling: "moderate", allowFilesystemWrite: false }),
        skillMcpAllowlist: allowlist({ enabledToolNames: ["file_write"] }),
      })),
    })
    expect(denied.allowed).toBe(false)
    expect(denied.reasonCode).toBe("risk_exceeds_profile")
  })

  it("blocks cross-agent MCP use and requires agent-scoped context", () => {
    expect(parseMcpRegisteredToolName("mcp__browser__search")).toEqual({
      registeredName: "mcp__browser__search",
      serverId: "browser",
      toolName: "search",
    })

    const allowed = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__browser__search",
      riskLevel: "moderate",
      ctx: toolContext(),
    })
    expect(allowed.allowed).toBe(true)
    expect(allowed.secretScopeId).toBe("secret:agent:researcher")
    expect(allowed.rateLimitKey).toContain("agent:agent:researcher")

    const otherAgentPolicy = capabilityPolicy({
      skillMcpAllowlist: allowlist({
        enabledMcpServerIds: ["database"],
        enabledToolNames: ["mcp__database__query"],
        secretScopeId: "secret:agent:analyst",
      }),
    })
    const blocked = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__browser__search",
      riskLevel: "moderate",
      ctx: toolContext(otherAgentPolicy, {
        agentId: "agent:analyst",
        secretScopeId: "secret:agent:analyst",
      }),
    })
    expect(blocked.allowed).toBe(false)
    expect(blocked.reasonCode).toBe("mcp_server_not_allowed")

    const missingContext = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__browser__search",
      riskLevel: "moderate",
      ctx: legacyToolContext(),
    })
    expect(missingContext.allowed).toBe(false)
    expect(missingContext.reasonCode).toBe("agent_context_required")
  })

  it("filters MCP registry views by agent allowlist", () => {
    const statuses: McpServerStatus[] = [
      {
        name: "browser",
        transport: "stdio",
        enabled: true,
        required: false,
        ready: true,
        toolCount: 2,
        registeredToolCount: 2,
        tools: [
          { name: "search", registeredName: "mcp__browser__search", description: "search" },
          { name: "open", registeredName: "mcp__browser__open", description: "open" },
        ],
      },
      {
        name: "database",
        transport: "stdio",
        enabled: true,
        required: false,
        ready: true,
        toolCount: 1,
        registeredToolCount: 1,
        tools: [{ name: "query", registeredName: "mcp__database__query", description: "query" }],
      },
    ]

    const scoped = filterMcpStatusesForAgentAllowlist(statuses, allowlist())
    expect(scoped).toHaveLength(1)
    expect(scoped[0]?.name).toBe("browser")
    expect(scoped[0]?.tools.map((tool) => tool.registeredName)).toEqual(["mcp__browser__search"])
  })

  it("accepts legacy allowlists that omit disabledToolNames", () => {
    const legacyAllowlist = {
      enabledSkillIds: ["research"],
      enabledMcpServerIds: ["browser"],
      enabledToolNames: ["web_search", "mcp__browser__search", "search"],
      secretScopeId: "secret:agent:researcher",
    } as unknown as SkillMcpAllowlist

    const decision = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__browser__search",
      riskLevel: "moderate",
      ctx: toolContext(capabilityPolicy({ skillMcpAllowlist: legacyAllowlist })),
    })

    expect(decision.allowed).toBe(true)
    expect(decision.reasonCode).toBe("capability_allowed")
  })

  it("passes mandatory agent metadata into MCP tool call payloads", () => {
    const policy = capabilityPolicy()
    const payload = buildMcpToolCallPayload("search", { q: "nobie" }, {
      agentId: "agent:researcher",
      sessionId: "session:task009",
      permissionProfile: policy.permissionProfile,
      skillMcpAllowlist: policy.skillMcpAllowlist,
      secretScopeId: "secret:agent:researcher",
      auditId: "audit:task009",
      runId: "run:task009",
      requestGroupId: "group:task009",
      capabilityDelegationId: "delegation:task009",
    })

    expect(payload._meta?.nobie).toMatchObject({
      agent_id: "agent:researcher",
      session_id: "session:task009",
      secret_scope: "secret:agent:researcher",
      audit_id: "audit:task009",
      run_id: "run:task009",
      request_group_id: "group:task009",
      capability_delegation_id: "delegation:task009",
    })
    expect(payload._meta?.nobie.permission_profile.profile_id).toBe("profile:researcher")
  })

  it("applies agent-specific rate limits", () => {
    const decision = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__browser__search",
      riskLevel: "moderate",
      ctx: toolContext(),
    })
    const lease = acquireAgentCapabilityRateLimit({ decision, now })
    expect(() => acquireAgentCapabilityRateLimit({ decision, now })).toThrow(/rate limit exceeded/u)
    lease.release()
    const next = acquireAgentCapabilityRateLimit({ decision, now })
    next.release()
  })

  it("records capability delegation and shares results only through data exchange packages", () => {
    const requester = owner("nobie", "agent:nobie")
    const provider = owner("sub_agent", "agent:researcher")
    const delegation = buildCapabilityDelegationRequest({
      requester,
      provider,
      capability: "mcp__browser__search",
      risk: "external",
      inputPackageIds: ["exchange:input"],
      delegationId: "delegation:task009",
      auditCorrelationId: "audit:task009",
      parentRunId: "run:task009",
      parentRequestId: "request:task009",
    })

    expect(recordCapabilityDelegationRequest(delegation, { now })).toBe(true)
    expect(getCapabilityDelegation("delegation:task009")?.capability).toBe("mcp__browser__search")

    const result = buildCapabilityResultDataExchange({
      delegation,
      payload: {
        summary: "browser search completed",
        toolHandle: "raw-handle-should-not-cross",
        nested: {
          secret: "secret-value",
          safe: "visible",
        },
      },
      exchangeId: "exchange:capability-result",
      idempotencyKey: "exchange:capability-result",
      now: () => now,
      expiresAt: now + 60_000,
    })

    expect(JSON.stringify(result.payload)).not.toContain("raw-handle-should-not-cross")
    expect(JSON.stringify(result.payload)).not.toContain("secret-value")
    expect(result.allowedUse).toBe("verification_only")
    expect(result.sourceOwner).toEqual(provider)
    expect(result.recipientOwner).toEqual(requester)
    expect(persistCapabilityResultDataExchange(result, { now })).toBe(true)
  })

  it("keeps template policy snapshots independent and builds approval aggregation events", () => {
    const policy = capabilityPolicy()
    const snapshot = createCapabilityPolicySnapshot({ policy, snapshotId: "snapshot:task009", now })
    policy.skillMcpAllowlist.enabledMcpServerIds.push("database")
    policy.permissionProfile.allowedPaths.push("/tmp/changed")

    expect(snapshot.skillMcpAllowlist.enabledMcpServerIds).toEqual(["browser"])
    expect(snapshot.permissionProfile.allowedPaths).toEqual([])
    expect(snapshot.checksum).toMatch(/^[a-f0-9]{64}$/u)

    const decision = evaluateAgentToolCapabilityPolicy({
      toolName: "mcp__browser__search",
      riskLevel: "moderate",
      ctx: toolContext(capabilityPolicy({
        permissionProfile: permissionProfile({ approvalRequiredFrom: "moderate" }),
      })),
    })
    expect(decision.approvalRequired).toBe(true)
    const event = buildCapabilityApprovalAggregationEvent({
      decision,
      runId: "run:task009",
      requestGroupId: "group:task009",
      sessionId: "session:task009",
      auditId: "audit:task009",
      now,
    })
    expect(event).toMatchObject({
      kind: "capability_approval_required",
      agentId: "agent:researcher",
      toolName: "mcp__browser__search",
      capabilityRisk: "moderate",
      auditId: "audit:task009",
    })
  })
})
