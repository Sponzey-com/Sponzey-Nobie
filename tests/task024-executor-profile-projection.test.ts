import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  EnterpriseMetadataValue,
  EnterpriseRelation,
  EnterpriseTopology,
  NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import type {
  MemoryPolicy,
  PermissionProfile,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubAgentConfig,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  EXECUTOR_PROFILE_METADATA_KEY,
  type ExecutorProfile,
  buildExecutorProfileFromNode,
  buildOrchestrationRegistrySnapshot,
} from "../packages/core/src/orchestration/registry.ts"
import {
  buildAgentPromptBundle,
  buildExecutorProfilePromptProjection,
} from "../packages/core/src/orchestration/prompt-bundle.ts"
import {
  compileExecutorGraphToEnterpriseTopology,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import { createEnterpriseTopologyRegistry } from "../packages/core/src/topology/registry.ts"

const now = Date.UTC(2026, 4, 6, 9, 0, 0)
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task024-executor-profile-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

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

beforeEach(() => {
  useTempState()
})

function owner(ownerId = "agent:current"): RuntimeIdentity["owner"] {
  return { ownerType: ownerId === "agent:nobie" ? "nobie" : "sub_agent", ownerId }
}

function memoryPolicy(ownerId = "agent:current"): MemoryPolicy {
  const scopedOwner = owner(ownerId)
  return {
    owner: scopedOwner,
    visibility: "coordinator_visible",
    readScopes: [scopedOwner],
    writeScope: scopedOwner,
    retentionPolicy: "short_term",
    writebackReviewRequired: true,
  }
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: [],
}

const permissionProfile: PermissionProfile = {
  profileId: "permission:current",
  riskCeiling: "moderate",
  approvalRequiredFrom: "sensitive",
  allowExternalNetwork: false,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

function subAgent(): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: "agent:current",
    displayName: "Current Agent",
    status: "enabled",
    role: "coordinator",
    personality: "Delegates through structured executor profiles.",
    specialtyTags: ["coordination"],
    avoidTasks: [],
    memoryPolicy: memoryPolicy(),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1_000_000 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: [],
    delegation: {
      enabled: true,
      maxParallelSessions: 1_000_000,
    },
  }
}

const taskScope: StructuredTaskScope = {
  goal: "Route work through available executors.",
  intentType: "orchestration",
  actionType: "delegate",
  constraints: ["Use structured executor profiles."],
  reasonCodes: ["executor_profile_projection"],
  expectedOutputs: [{
    outputId: "answer",
    kind: "text",
    description: "Delegation result.",
    required: true,
    acceptance: {
      requiredEvidenceKinds: ["execution_trace"],
      artifactRequired: false,
      reasonCodes: ["delegation_completed"],
    },
  }],
}

function profile(
  executorId: string,
  displayName: string,
  roleName: string,
  definition: string,
  expectedOutputs: string[] = ["처리 결과"],
): ExecutorProfile {
  return {
    schemaVersion: 1,
    executorId,
    displayName,
    roleName,
    definition,
    does: [`${displayName}가 담당할 일을 구조화합니다.`],
    delegationScope: [roleName],
    expectedOutputs,
    handoffStyle: "structured_handoff",
    declineCriteria: ["권한 밖 업무"],
    riskBoundary: ["민감 정보는 사용자 확인 후 처리"],
  }
}

function node(input: {
  id: string
  displayName: string
  description: string
  executorProfile?: ExecutorProfile
}): NodeContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "node",
    id: input.id,
    name: input.displayName,
    displayName: input.displayName,
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    description: input.description,
    tags: [],
    children: [],
    template: {
      templateId: `template:${input.id}`,
      source: "user_preset",
      fixedRoleCatalog: false,
      metadata: input.executorProfile
        ? { [EXECUTOR_PROFILE_METADATA_KEY]: input.executorProfile as unknown as EnterpriseMetadataValue }
        : {},
    },
    allowedToolIds: [],
    allowedSystemIds: [],
  }
}

function relation(id: string, from: string, to: string): EnterpriseRelation {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "relation",
    id,
    name: id,
    status: "active",
    createdAt: now,
    updatedAt: now,
    relationType: "delegates_to",
    from: { entityType: "node", id: from },
    to: { entityType: "node", id: to },
  }
}

function topology(nodes: NodeContract[], relations: EnterpriseRelation[] = []): EnterpriseTopology {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "topology",
    id: "topology:task024-executor-profile",
    name: "task024 executor profile topology",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes,
    relations,
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
  }
}

function emptyRegistryConfig() {
  return {
    orchestration: {
      maxDelegationTurns: 1_000_000,
      mode: "orchestration" as const,
      featureFlagEnabled: true,
      subAgents: [],
      teams: [],
    },
  }
}

describe("task024 executor profile projection", () => {
  it("saves executorProfile through executor graph compilation and exposes it in registry", () => {
    const graph: ExecutorGraphWorkspace = {
      schemaVersion: 1,
      graphId: "executor-graph:task024",
      topologyId: "topology:task024-executor-profile",
      name: "Executor Profile Graph",
      mode: "simple",
      executors: [{
        id: "node:planner",
        name: "기획자",
        description: "요청을 작은 작업으로 나누고 결과 기준을 세웁니다.",
        inferredRuntimeMode: "auto",
        inferredCapabilities: ["작업 분할"],
        inferredTools: [],
        inferredOutputs: ["작업 계획"],
        inferredSuccessCriteria: ["작업 단위가 명확함"],
        executorProfile: profile(
          "node:planner",
          "기획자",
          "작업 분할 담당",
          "요청을 분석해 목표, 제약, 실행 순서를 구조화합니다.",
          ["작업 계획"],
        ),
        confidence: 0.91,
        userConfirmed: true,
      }],
      sections: [],
      connections: [],
      selectedId: "node:planner",
      inference: {
        source: "executor_graph_compile",
        confidence: 0.91,
        executorCount: 1,
        connectionCount: 0,
        issueCount: 0,
        generatedAt: now,
      },
      compiledPreview: null,
      latestRun: null,
      issues: [],
      sourceOfTruth: {
        editableProjection: "executor_graph",
        runtimeSourceOfTruth: "executor_topology_v2",
        nodeContractBoundary: "compatibility_projection",
        workOrderBoundary: "runtime_adapter",
        agentConfigRole: "compatibility_import",
        projectionOnly: true,
      },
    }

    const compiled = compileExecutorGraphToEnterpriseTopology(graph, { now })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    const storedNode = compiled.topology.nodes.find((entry) => entry.id === "node:planner")
    expect(storedNode?.template?.metadata?.[EXECUTOR_PROFILE_METADATA_KEY]).toMatchObject({
      roleName: "작업 분할 담당",
      expectedOutputs: ["작업 계획"],
    })
    expect(storedNode?.metadata?.executorGraph).toMatchObject({
      [EXECUTOR_PROFILE_METADATA_KEY]: expect.objectContaining({
        roleName: "작업 분할 담당",
      }),
    })

    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology: compiled.topology,
      createdBy: "task024-test",
    })
    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: emptyRegistryConfig,
      now: () => now,
    })
    const agent = snapshot.agents.find(
      (entry) => entry.agentId === "topology:task024-executor-profile:node:planner",
    )

    expect(agent?.source).toBe("topology")
    expect(agent?.role).toBe("작업 분할 담당")
    expect(agent?.executorProfile).toMatchObject({
      executorId: "topology:task024-executor-profile:node:planner",
      displayName: "기획자",
      roleName: "작업 분할 담당",
      delegationScope: ["작업 분할 담당"],
      expectedOutputs: ["작업 계획"],
    })
  })

  it("creates a minimal profile for legacy nodes without profile metadata", () => {
    const legacyNode = node({
      id: "node:legacy",
      displayName: "Legacy Executor",
      description: "Stored before executorProfile existed.",
    })

    expect(buildExecutorProfileFromNode(legacyNode)).toMatchObject({
      executorId: "node:legacy",
      displayName: "Legacy Executor",
      roleName: "function",
      definition: "Stored before executorProfile existed.",
      expectedOutputs: ["처리 결과"],
    })
  })

  it("projects only direct next executors and drops deleted nodes without name-based routing", () => {
    const planner = profile("agent:planner", "Planner", "계획 담당", "Break work into clear tasks.")
    const reviewer = profile("agent:검토자", "검토자", "품질 검토 담당", "결과를 검토합니다.")
    const researcher = profile("agent:調査係", "調査係", "조사 담당", "근거를 찾습니다.")
    const deleted = profile("agent:deleted", "삭제된 실행자", "삭제됨", "제거된 노드입니다.")

    const projection = buildExecutorProfilePromptProjection({
      currentExecutorId: "agent:current",
      executorProfiles: [planner, reviewer, researcher, deleted],
      connections: [
        { fromExecutorId: "agent:current", toExecutorId: "agent:검토자" },
        { fromExecutorId: "agent:current", toExecutorId: "agent:調査係" },
        { fromExecutorId: "agent:검토자", toExecutorId: "agent:planner" },
      ],
    })
    const result = buildAgentPromptBundle({
      agent: subAgent(),
      taskScope,
      promptSources: [],
      executorProfileProjection: projection,
      now: () => now,
    })

    expect(projection.selectableExecutors.map((entry) => entry.executorId)).toEqual([
      "agent:調査係",
      "agent:검토자",
    ])
    expect(
      projection.selectableExecutors.find((entry) => entry.executorId === "agent:검토자")
        ?.connectedNextExecutorIds,
    ).toEqual(["agent:planner"])
    expect(result.renderedPrompt).toContain("Available direct executors for current agent")
    expect(result.renderedPrompt).toContain("Runtime code must not route by scanning this text")
    expect(result.renderedPrompt).toContain("agent:검토자")
    expect(result.renderedPrompt).toContain("agent:調査係")
    expect(result.renderedPrompt).toContain("[Diagnostic executors - not selectable here]")
    expect(result.renderedPrompt).toContain("agent:deleted")

    const afterDelete = buildExecutorProfilePromptProjection({
      currentExecutorId: "agent:current",
      executorProfiles: [planner, researcher],
      connections: [
        { fromExecutorId: "agent:current", toExecutorId: "agent:調査係" },
      ],
    })
    const afterDeleteBundle = buildAgentPromptBundle({
      agent: subAgent(),
      taskScope,
      promptSources: [],
      executorProfileProjection: afterDelete,
      now: () => now,
    })

    expect(afterDeleteBundle.renderedPrompt).not.toContain("검토자")
    expect(afterDeleteBundle.renderedPrompt).toContain("調査係")
  })
})
