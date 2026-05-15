import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type { EnterpriseTopology, NodeContract } from "../packages/core/src/contracts/enterprise-topology.ts"
import type {
  MemoryPolicy,
  NobieConfig,
  PermissionProfile,
  SkillMcpAllowlist,
  StructuredTaskScope,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import { loadPromptSourceRegistry } from "../packages/core/src/memory/nobie-md.ts"
import {
  buildAgentExecutionContextFromGraphSnapshot,
  buildExecutorProfilePromptProjectionFromGraphSnapshot,
} from "../packages/core/src/orchestration/execution-context-builder.ts"
import { buildAgentExecutionDecisionPrompt } from "../packages/core/src/orchestration/execution-harness.ts"
import { buildExecutionGraphSnapshot, WORKSPACE_DRAFT_TOPOLOGY_ID } from "../packages/core/src/orchestration/execution-graph-snapshot.ts"
import { buildAgentPromptBundle } from "../packages/core/src/orchestration/prompt-bundle.ts"
import { createEnterpriseTopologyRegistry } from "../packages/core/src/topology/registry.js"

const now = Date.UTC(2026, 4, 7, 0, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-prompt-direct-executors-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function node(input: {
  id: string
  name: string
  roleName: string
  definition: string
  tags?: string[]
  children?: string[]
}): NodeContract {
  return {
    schemaVersion: 1,
    entityType: "node",
    id: input.id,
    name: input.name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    tags: input.tags ?? [],
    children: input.children ?? [],
    allowedToolIds: [],
    allowedSystemIds: [],
    metadata: {
      executorProfile: {
        schemaVersion: 1,
        executorId: input.id,
        displayName: input.name,
        roleName: input.roleName,
        definition: input.definition,
        does: [input.definition],
        delegationScope: [input.roleName],
        expectedOutputs: ["처리 결과"],
        handoffStyle: "structured_handoff",
        declineCriteria: [],
        riskBoundary: [],
      },
    },
  }
}

function topologyFixture(): EnterpriseTopology {
  return {
    schemaVersion: 1,
    entityType: "topology",
    id: WORKSPACE_DRAFT_TOPOLOGY_ID,
    name: "Workspace draft",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [
      node({
        id: "node:lead",
        name: "마당쇠",
        roleName: "개발 리드",
        definition: "개발 업무를 나누고 하위 실행자에게 넘깁니다.",
        children: ["node:backend"],
      }),
      node({
        id: "node:backend",
        name: "삼식이",
        roleName: "백엔드 담당",
        definition: "백엔드 이슈를 처리합니다.",
      }),
      node({
        id: "node:finance",
        name: "행랑아범",
        roleName: "재무 검토 담당",
        definition: "시장, 재무, 투자 위험을 검토합니다.",
      }),
    ],
    teams: [],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [],
    tools: [],
    processes: [],
    relations: [{
      schemaVersion: 1,
      entityType: "relation",
      id: "relation:lead-backend",
      name: "lead delegates to backend",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      relationType: "delegates_to",
      from: { entityType: "node", id: "node:lead" },
      to: { entityType: "node", id: "node:backend" },
    }],
  }
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:nobie",
  riskCeiling: "moderate",
  approvalRequiredFrom: "sensitive",
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

function memoryPolicy(): MemoryPolicy {
  return {
    owner: { ownerType: "nobie", ownerId: "agent:nobie" },
    visibility: "private",
    readScopes: [{ ownerType: "nobie", ownerId: "agent:nobie" }],
    writeScope: { ownerType: "nobie", ownerId: "agent:nobie" },
    retentionPolicy: "long_term",
    writebackReviewRequired: true,
  }
}

function nobieAgent(): NobieConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "nobie",
    agentId: "agent:nobie",
    displayName: "Nobie",
    status: "enabled",
    role: "coordinator",
    personality: "Coordinate work.",
    specialtyTags: ["coordination"],
    avoidTasks: [],
    memoryPolicy: memoryPolicy(),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 2 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    coordinator: {
      defaultMode: "orchestration",
      fallbackMode: "single_nobie",
      maxDelegatedSubSessions: 2,
    },
  }
}

const taskScope: StructuredTaskScope = {
  goal: "사용자 요청을 적합한 실행자에게 맡긴다.",
  intentType: "execution_decision",
  actionType: "route",
  constraints: [],
  expectedOutputs: [{
    outputId: "answer",
    kind: "text",
    description: "실행 판단 결과",
    required: true,
    acceptance: {
      requiredEvidenceKinds: [],
      artifactRequired: false,
      reasonCodes: ["decision_recorded"],
    },
  }],
  reasonCodes: ["execution_decision_required"],
}

function workspaceGraph() {
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  registry.appendTopologyVersion({ topology: topologyFixture(), createdBy: "test" })
  return buildExecutionGraphSnapshot({
    mode: "workspace",
    now: () => now,
    topologyRegistry: registry,
  })
}

function contextJsonFromPrompt(prompt: string): Record<string, unknown> {
  const line = prompt.split("\n").findLast((item) => item.trim().startsWith("{"))
  expect(line).toBeTruthy()
  return JSON.parse(line as string) as Record<string, unknown>
}

describe("task004 prompt direct executor projection", () => {
  it("builds AgentExecutionContext from current direct children only", () => {
    const graph = workspaceGraph()
    const context = buildAgentExecutionContextFromGraphSnapshot({
      graph,
      request: {
        kind: "user_message",
        latest_user_message: "코스피와 하이닉스 투자 검토",
      },
      requester: { requester_id: "channel:telegram", requester_type: "channel" },
    })

    expect(context.accessible_executors.map((executor) => executor.executor_id)).toEqual([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:finance`,
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:lead`,
    ])
    expect(context.diagnostic_executors?.map((executor) => executor.executor_id)).toEqual([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:backend`,
    ])
    expect(context.execution_graph).toMatchObject({
      graph_source: "workspace_draft",
      current_executor_id: "agent:nobie",
      available_executor_ids: [
        `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:finance`,
        `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:lead`,
      ],
      diagnostic_executor_ids: [`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:backend`],
    })
  })

  it("puts direct executors in the execution decision prompt and keeps indirect executors diagnostic", () => {
    const graph = workspaceGraph()
    const context = buildAgentExecutionContextFromGraphSnapshot({
      graph,
      request: { kind: "user_message", latest_user_message: "요청" },
    })
    const prompt = buildAgentExecutionDecisionPrompt(context)
    const payload = contextJsonFromPrompt(prompt)
    const promptContext = payload.context as {
      accessible_executors: Array<{ executor_id: string; display_name: string }>
      diagnostic_executors: Array<{ executor_id: string; display_name: string }>
    }

    expect(prompt).toContain("accessible_executors contains only direct children")
    expect(prompt).toContain("Choose only an executor visible from the current executor")
    expect(promptContext.accessible_executors.map((executor) => executor.display_name)).toEqual([
      "행랑아범",
      "마당쇠",
    ])
    expect(promptContext.accessible_executors.map((executor) => executor.display_name)).not.toContain("삼식이")
    expect(promptContext.diagnostic_executors.map((executor) => executor.display_name)).toEqual(["삼식이"])
  })

  it("renders prompt bundle direct executor section separately from diagnostic executors", () => {
    const graph = workspaceGraph()
    const projection = buildExecutorProfilePromptProjectionFromGraphSnapshot(graph)
    const result = buildAgentPromptBundle({
      agent: nobieAgent(),
      taskScope,
      executorProfileProjection: projection,
      promptSources: loadPromptSourceRegistry(process.cwd()),
      now: () => now,
    })

    expect(projection.selectableExecutors.map((executor) => executor.displayName)).toEqual([
      "행랑아범",
      "마당쇠",
    ])
    expect(projection.diagnosticExecutors?.map((executor) => executor.displayName)).toEqual(["삼식이"])
    expect(result.renderedPrompt).toContain("Available direct executors for current agent")
    expect(result.renderedPrompt).toContain("name: 행랑아범")
    expect(result.renderedPrompt).toContain("Diagnostic executors - not selectable here")
    expect(result.renderedPrompt).toContain("name: 삼식이")
    expect(result.bundle.sourceProvenance.map((source) => source.sourceId)).not.toContain("prompt:bootstrap:en")
  })

  it("loads runtime prompt sources with direct-child policy and keeps bootstrap out of runtime assembly", () => {
    const sources = loadPromptSourceRegistry(process.cwd())
    const runtimeSourceIds = sources
      .filter((source) => source.locale === "en" && source.usageScope === "runtime")
      .map((source) => source.sourceId)
    const nobieExecution = sources.find((source) => source.sourceId === "nobie_execution" && source.locale === "en")
    const toolPolicy = sources.find((source) => source.sourceId === "tool_policy" && source.locale === "en")
    const topologyPolicy = sources.find((source) => source.sourceId === "topology_executor_policy" && source.locale === "en")

    expect(nobieExecution?.content).toContain("direct children")
    expect(nobieExecution?.content).toContain("diagnostic_executors")
    expect(nobieExecution?.content).toContain("Broad coordination, management, review, or summary ability is weak evidence")
    expect(nobieExecution?.content).toContain("concrete profile-fit evidence")
    expect(toolPolicy?.content).toContain("explicit provider target")
    expect(topologyPolicy?.content).toContain("first hop must be a direct child")
    expect(runtimeSourceIds).toContain("nobie_execution")
    expect(runtimeSourceIds).toContain("tool_policy")
    expect(runtimeSourceIds).toContain("recovery_policy")
    expect(runtimeSourceIds).toContain("topology_executor_policy")
    expect(runtimeSourceIds).not.toContain("bootstrap")
  })
})
