import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerSubSessionRoutes } from "../packages/core/src/api/routes/subsessions.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
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
import { getControlTimeline } from "../packages/core/src/control-plane/timeline.ts"
import {
  closeDb,
  getRunSubSession,
  listRunSubSessionsForParentRun,
  updateRunSubSession,
} from "../packages/core/src/db/index.js"
import {
  listLatencyMetrics,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"
import type { RunSubSessionInput } from "../packages/core/src/orchestration/sub-session-runner.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: {
    method: string
    url: string
    payload?: unknown
    headers?: Record<string, string>
    remoteAddress?: string
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>
}

const now = Date.UTC(2026, 3, 24, 0, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Control API dry-run result.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["reviewable_result"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Validate sub-session control API.",
  intentType: "runtime_test",
  actionType: "subsession_control",
  constraints: ["Do not deliver directly to the user."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["task014"],
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:task014",
  riskCeiling: "safe",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: false,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["skill:control"],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: ["shell_exec"],
}

const memoryPolicy: MemoryPolicy = {
  owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  visibility: "private",
  readScopes: [{ ownerType: "sub_agent", ownerId: "agent:researcher" }],
  writeScope: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

function useTempState(): void {
  closeDb()
  resetLatencyMetrics()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task014-subsession-control-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function restoreState(): void {
  closeDb()
  resetLatencyMetrics()
  process.env.NOBIE_STATE_DIR = previousStateDir
  process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "nobie", ownerId: "agent:nobie" },
    idempotencyKey: `idem:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run:task014",
      parentRequestId: "request:task014",
    },
  }
}

function promptBundle(bundleId = "prompt-bundle:task014"): AgentPromptBundle {
  return {
    identity: identity("capability", bundleId),
    bundleId,
    agentId: "agent:researcher",
    agentType: "sub_agent",
    role: "control worker",
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
    taskScope,
    safetyRules: ["Sub-session result is parent synthesis only."],
    sourceProvenance: [{ sourceId: "profile:agent:researcher", version: "1" }],
    validation: {
      ok: true,
      issueCodes: [],
      blockedFragmentIds: [],
      inactiveFragmentIds: [],
    },
    completionCriteria: [expectedOutput],
    promptChecksum: "sha256:task014",
    profileVersionSnapshot: 1,
    createdAt: now,
  }
}

function command(id: string, parentRunId = "run:task014"): CommandRequest {
  return {
    identity: {
      ...identity("sub_session", `command:${id}`),
      idempotencyKey: `idem:${id}`,
      parent: {
        parentRunId,
        parentRequestId: "request:task014",
      },
    },
    commandRequestId: `command:${id}`,
    parentRunId,
    subSessionId: `sub:${id}`,
    targetAgentId: "agent:researcher",
    targetNicknameSnapshot: "Res",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget: 2,
  }
}

function runInput(id: string, parentRunId = "run:task014"): RunSubSessionInput {
  return {
    command: command(id, parentRunId),
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
    parentSessionId: "session:task014",
    promptBundle: promptBundle(),
  }
}

function parseSubSession(id: string): SubSessionContract {
  const row = getRunSubSession(id)
  if (!row) throw new Error(`missing sub-session ${id}`)
  return JSON.parse(row.contract_json) as SubSessionContract
}

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false })
  registerSubSessionRoutes(app)
  await app.ready()
  try {
    await run(app)
  } finally {
    await app.close()
  }
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreState()
})

describe("task014 sub-session control API", () => {
  it("returns queued spawn ack immediately and records ack latency", async () => {
    await withApp(async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput("spawn"), auditCorrelationId: "audit:spawn" },
      })
      const body = response.json()

      expect(response.statusCode).toBe(202)
      expect(body.ack).toEqual(
        expect.objectContaining({
          ok: true,
          status: "queued",
          reasonCode: "spawn_queued",
          subSessionId: "sub:spawn",
          parentRunId: "run:task014",
          replayed: false,
        }),
      )
      expect(body.ack.ackCompletedAt).toBeGreaterThanOrEqual(body.ack.ackStartedAt)
      expect(parseSubSession("sub:spawn").status).toBe("queued")
      expect(listLatencyMetrics()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "sub_session_spawn_ack_ms",
            runId: "run:task014",
          }),
        ]),
      )
    })
  })

  it("returns info and bounded sanitized logs", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput("logs") },
      })
      await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:logs/steer",
        payload: {
          parentRunId: "run:task014",
          instruction: "Use token=sk-task014-secret-123456 and writer private raw memory",
        },
      })

      const info = await app.inject({
        method: "GET",
        url: "/api/subsessions/sub:logs/info?parentRunId=run%3Atask014",
      })
      expect(info.statusCode).toBe(200)
      expect(info.json().info).toEqual(
        expect.objectContaining({
          subSessionId: "sub:logs",
          parentAgentNickname: "노비",
          agentNickname: "Res",
          promptBundle: expect.objectContaining({ promptChecksum: "sha256:task014" }),
        }),
      )

      const logs = await app.inject({
        method: "GET",
        url: "/api/subsessions/sub:logs/logs?parentRunId=run%3Atask014&limit=10",
      })
      expect(logs.statusCode).toBe(200)
      const serialized = JSON.stringify(logs.json())
      expect(serialized).toContain("subsession.steer.accepted")
      expect(serialized).not.toContain("sk-task014-secret")
      expect(serialized).not.toContain("writer private raw memory")
    })
  })

  it("accepts send and steer only for active sub-sessions and blocks cross-run control", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput("control") },
      })

      const send = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:control/send",
        payload: { parentRunId: "run:task014", message: "continue" },
      })
      expect(send.statusCode).toBe(202)
      expect(send.json()).toEqual(expect.objectContaining({ accepted: true, action: "send" }))

      const forbidden = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:control/steer",
        payload: { parentRunId: "run:other", instruction: "wrong run" },
      })
      expect(forbidden.statusCode).toBe(403)
      expect(forbidden.json().reasonCode).toBe("sub_session_parent_run_mismatch")

      const completed = parseSubSession("sub:control")
      completed.status = "completed"
      completed.finishedAt = now + 1
      updateRunSubSession(completed)

      const blocked = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:control/steer",
        payload: { parentRunId: "run:task014", instruction: "too late" },
      })
      expect(blocked.statusCode).toBe(409)
      expect(blocked.json().reasonCode).toBe("sub_session_not_active")
    })
  })

  it("requires result report context for feedback and redelegate control actions", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput("feedback") },
      })

      const feedback = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:feedback/feedback",
        payload: { parentRunId: "run:task014", message: "needs more evidence" },
      })
      const redelegate = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:feedback/redelegate",
        payload: { parentRunId: "run:task014", targetAgentId: "agent:other" },
      })

      expect(feedback.statusCode).toBe(409)
      expect(feedback.json().reasonCode).toBe("sub_session_feedback_state_invalid")
      expect(redelegate.statusCode).toBe(409)
      expect(redelegate.json().reasonCode).toBe("sub_session_feedback_state_invalid")
      expect(listRunSubSessionsForParentRun("run:task014")).toHaveLength(1)
    })
  })

  it("cancels one active sub-session and kill-all targets only active children of the parent run", async () => {
    await withApp(async (app) => {
      for (const id of ["cancel", "kill-a", "kill-b"]) {
        await app.inject({
          method: "POST",
          url: "/api/subsessions/spawn",
          payload: { input: runInput(id) },
        })
      }
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput("other-run", "run:other") },
      })
      const completed = parseSubSession("sub:kill-b")
      completed.status = "completed"
      completed.finishedAt = now + 1
      updateRunSubSession(completed)

      const cancel = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:cancel/cancel",
        payload: { parentRunId: "run:task014" },
      })
      expect(cancel.statusCode).toBe(202)
      expect(parseSubSession("sub:cancel").status).toBe("cancelled")

      const killAll = await app.inject({
        method: "POST",
        url: "/api/runs/run:task014/subsessions/kill-all",
        payload: { auditCorrelationId: "audit:kill-all" },
      })
      expect(killAll.statusCode).toBe(202)
      expect(killAll.json().affectedSubSessionIds).toEqual(["sub:kill-a"])
      expect(parseSubSession("sub:kill-a").status).toBe("cancelled")
      expect(parseSubSession("sub:kill-b").status).toBe("completed")
      expect(parseSubSession("sub:other-run").status).toBe("queued")
    })
  })

  it("returns blocked_by_approval or rejected spawn acknowledgements without starting work", async () => {
    await withApp(async (app) => {
      const approval = await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput("approval"), approvalRequired: true },
      })
      expect(approval.statusCode).toBe(202)
      expect(approval.json().ack).toEqual(
        expect.objectContaining({
          ok: false,
          status: "blocked_by_approval",
          reasonCode: "blocked_by_approval",
        }),
      )
      expect(getRunSubSession("sub:approval")).toBeUndefined()

      const rejected = await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: { agent: {} } },
      })
      expect(rejected.statusCode).toBe(400)
      expect(rejected.json().ack).toEqual(
        expect.objectContaining({
          ok: false,
          status: "rejected",
        }),
      )
    })
  })

  it("records control actions in the interim monitoring projection", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput("audit"), auditCorrelationId: "audit:control" },
      })
      await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:audit/send",
        payload: {
          parentRunId: "run:task014",
          auditCorrelationId: "audit:control",
          message: "operator note",
        },
      })

      const timeline = getControlTimeline({
        runId: "run:task014",
        component: "subsession.control",
        limit: 20,
      })
      expect(timeline.events.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["subsession.spawn.queued", "subsession.send.accepted"]),
      )
      expect(timeline.events.some((event) => event.correlationId === "audit:control")).toBe(true)
    })
  })
})
