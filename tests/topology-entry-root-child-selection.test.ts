import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
} from "../packages/core/src/index.ts"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionDecision,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import type { OrchestrationModeSnapshot } from "../packages/core/src/orchestration/mode.ts"
import { compileTopologyOrThrow } from "../packages/core/src/topology/compiler.ts"
import {
  resolveTopologyRootRunRouting,
  runTopologyRootRun,
  type TopologyRootRunRoutingDecision,
} from "../packages/core/src/topology-runtime/harness.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"

const now = Date.UTC(2026, 4, 7, 0, 0, 0)
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task007-entry-root-child-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) process.env.NOBIE_STATE_DIR = undefined
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) process.env.NOBIE_CONFIG = undefined
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function topologyWithIndependentRootChild() {
  const topology = buildExampleEnterpriseTopology(now)
  topology.id = "topology:task007-entry"
  topology.name = "Task007 Entry Selection Topology"
  const baseNode = topology.nodes.find((node) => node.id === "node:triage")
  if (!baseNode) throw new Error("example topology fixture is missing node:triage")
  topology.nodes.push({
    ...structuredClone(baseNode),
    id: "node:finance",
    name: "행랑아범",
    displayName: "행랑아범",
    description: "상위 연결선이 없는 재무 검토 실행자",
    tags: ["finance", "root-child"],
    children: [],
    allowedToolIds: [],
    allowedSystemIds: [],
  })
  topology.teams[0]?.nodeIds.push("node:finance")
  return topology
}

function modeSnapshot(topologyId: string): OrchestrationModeSnapshot {
  return {
    mode: "orchestration",
    status: "ready",
    featureFlagEnabled: true,
    requestedMode: "orchestration",
    activeSubAgentCount: 3,
    totalSubAgentCount: 3,
    disabledSubAgentCount: 0,
    activeSubAgents: [
      {
        agentId: `${topologyId}:node:intake`,
        displayName: "Customer Request Intake",
        source: "topology",
        topologyId,
        executorId: "node:intake",
      },
      {
        agentId: `${topologyId}:node:triage`,
        displayName: "Customer Request Triage",
        source: "topology",
        topologyId,
        executorId: "node:triage",
      },
      {
        agentId: `${topologyId}:node:finance`,
        displayName: "행랑아범",
        source: "topology",
        topologyId,
        executorId: "node:finance",
      },
    ],
    reasonCode: "orchestration_ready",
    reason: "saved topology nodes are available",
    generatedAt: now,
  }
}

function decision(input: {
  selectedExecutorId: string
  selectedConnectionPath: string[]
}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "topology_entry_selection",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: input.selectedExecutorId,
    selected_connection_path: input.selectedConnectionPath,
    task_profile: {
      title: "토폴로지 entry 선택",
      summary: "선택된 실행자가 노비 직속 하위인지 또는 연결 경로로 접근 가능한지 검증한다.",
      goals: ["노비 직속 하위는 바로 entry로 실행한다."],
      task_units: [{
        id: "unit:entry",
        title: "entry 검증",
        goal: "선택된 실행자를 올바른 토폴로지 entry로 변환한다.",
        preferred_executor_id: input.selectedExecutorId,
      }],
      success_criteria: ["임의 default entry 강제를 하지 않는다."],
    },
    required_outputs: [{
      id: "answer",
      label: "처리 결과",
    }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트용 토폴로지 entry 검증",
    },
    confidence: 0.95,
    fallback_if_unavailable: "direct_current_agent",
    reason: "선택된 실행자를 토폴로지 연결 경로로 검증합니다.",
  }
}

function routeWithDecision(executionDecision: AgentExecutionDecision): {
  routing: TopologyRootRunRoutingDecision
  registry: ReturnType<typeof createEnterpriseTopologyRegistry>
} {
  useTempState()
  const topology = topologyWithIndependentRootChild()
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  registry.appendTopologyVersion({
    topology,
    createdBy: "task007-entry-root-child",
  })
  const routing = resolveTopologyRootRunRouting({
    message: "선택된 실행자에게 바로 맡겨줘",
    runId: "run:task007-entry",
    sessionId: "session:task007-entry",
    source: "webui",
    targetId: topology.id,
    taskProfile: "operations",
    isRootRequest: true,
    registry,
    orchestrationModeSnapshot: modeSnapshot(topology.id),
    executionDecision,
  })
  return { routing, registry }
}

function routeWithoutDecision(): TopologyRootRunRoutingDecision {
  useTempState()
  const topology = topologyWithIndependentRootChild()
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  registry.appendTopologyVersion({
    topology,
    createdBy: "task007-entry-root-child",
  })
  return resolveTopologyRootRunRouting({
    message: "선택된 실행자 없이 토폴로지로 처리해줘",
    runId: "run:task007-no-decision",
    sessionId: "session:task007-no-decision",
    source: "webui",
    targetId: topology.id,
    taskProfile: "operations",
    isRootRequest: true,
    registry,
    orchestrationModeSnapshot: modeSnapshot(topology.id),
  })
}

describe("task007 topology root-child entry selection", () => {
  it("records root child and incoming edge indexes in compiled snapshots", () => {
    const topology = topologyWithIndependentRootChild()
    const snapshot = compileTopologyOrThrow(topology, {
      sourceTopologyVersion: "task007-entry",
      compiledAt: now,
    })

    expect(snapshot.parentChildTree.rootNodeIds).toEqual(["node:intake", "node:finance"])
    expect(snapshot.parentChildTree.rootChildNodeIds).toEqual(["node:intake", "node:finance"])
    expect(snapshot.runtimeExecutionContext.rootChildNodeIds).toEqual([
      "node:intake",
      "node:finance",
    ])
    expect(snapshot.parentChildTree.incomingEdgeCountByNodeId).toMatchObject({
      "node:intake": 0,
      "node:triage": 1,
      "node:finance": 0,
    })
  })

  it("uses a selected root direct child as the runtime entry and repairs an empty path", async () => {
    const { routing, registry } = routeWithDecision(decision({
      selectedExecutorId: "node:finance",
      selectedConnectionPath: [],
    }))

    expect(routing).toEqual(expect.objectContaining({
      mode: "route",
      reasonCode: "explicit_topology_target",
      entryNodeId: "node:finance",
      selectedExecutorId: "node:finance",
      selectedConnectionPath: ["node:finance"],
    }))

    const result = await runTopologyRootRun({
      decision: routing as Extract<TopologyRootRunRoutingDecision, { mode: "route" }>,
      runId: "run:task007-entry",
      sessionId: "session:task007-entry",
      source: "webui",
      message: "선택된 실행자에게 바로 맡겨줘",
      registry,
      now: () => now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entryNodeId).toBe("node:finance")
    expect(result.runtimeResult.envelope.workOrder.input).toEqual(expect.objectContaining({
      selectedExecutorId: "node:finance",
      selectedConnectionPath: ["node:finance"],
      entrySelection: "execution_decision",
    }))
  })

  it("does not route to a compiled default entry when no executor was selected", () => {
    const routing = routeWithoutDecision()

    expect(routing).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "selected_executor_missing",
      issues: expect.arrayContaining(["selected_executor_missing"]),
    }))
  })

  it("rejects a descendant selection without a valid path", () => {
    const { routing } = routeWithDecision(decision({
      selectedExecutorId: "node:triage",
      selectedConnectionPath: [],
    }))

    expect(routing).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "selected_executor_not_direct_child",
      issues: expect.arrayContaining(["selected_executor_not_direct_child:node:triage"]),
    }))
  })

  it("accepts a descendant selection when the path starts at a root direct child", () => {
    const { routing } = routeWithDecision(decision({
      selectedExecutorId: "node:triage",
      selectedConnectionPath: ["node:intake", "node:triage"],
    }))

    expect(routing).toEqual(expect.objectContaining({
      mode: "route",
      reasonCode: "explicit_topology_target",
      entryNodeId: "node:intake",
      selectedExecutorId: "node:triage",
      selectedConnectionPath: ["node:intake", "node:triage"],
    }))
  })

  it("rejects a path that does not follow actual compiled edges", () => {
    const { routing } = routeWithDecision(decision({
      selectedExecutorId: "node:triage",
      selectedConnectionPath: ["node:finance", "node:triage"],
    }))

    expect(routing).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "selected_executor_path_invalid",
      issues: expect.arrayContaining(["missing_topology_edge:node:finance->node:triage"]),
    }))
  })
})
