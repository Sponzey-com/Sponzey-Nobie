import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  compileExecutorGraphToEnterpriseTopology,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import {
  applyExecutorConnectionRecommendation,
  createExecutorConnectionDraft,
  executorConnectionRelationToEnterpriseRelationType,
  executorConnectionToSafeEnterpriseRelationType,
  recommendExecutorConnectionRelations,
} from "../packages/core/src/topology/executor-relation-inference.ts"
import { validateEnterpriseTopology } from "../packages/core/src/contracts/enterprise-topology.ts"
import { ExecutorConnectionMenu } from "../packages/webui/src/components/topology/ExecutorConnectionMenu.tsx"
import { RelationModeToolbar } from "../packages/webui/src/components/topology/RelationModeToolbar.tsx"

const now = Date.UTC(2026, 4, 2, 11, 0, 0)

describe("task007 connection inference and simple edit menu", () => {
  it("creates a default executor connection as handoff / 넘김", () => {
    const source = executor("node:intake", "고객 접수 담당자", "고객 요청을 정리한다.")
    const target = executor("node:ops", "운영 담당자", "정리된 요청을 처리한다.")
    const connection = createExecutorConnectionDraft({ source, target })

    expect(connection).toEqual(expect.objectContaining({
      id: "connection:node:intake:node:ops",
      fromExecutorId: "node:intake",
      toExecutorId: "node:ops",
      inferredRelation: "handoff",
      label: "넘김",
      userConfirmed: false,
    }))
  })

  it("does not recommend approval or report from approver, lead, and reviewer descriptions", () => {
    const source = executor("node:ops", "운영 담당자", "처리 결과를 정리한다.")
    const approver = executor("node:approval", "승인자", "승인 여부를 확인하고 승인 결과를 남긴다.", "approval")
    const lead = executor("node:lead", "운영 리드", "처리 결과 보고를 받고 다음 조치를 정한다.", "human_check")
    const reviewer = executor("node:reviewer", "검토자", "처리 결과를 검토하고 의견을 남긴다.", "human_check")

    expect(recommendExecutorConnectionRelations({ source, target: approver })[0]).toEqual(expect.objectContaining({
      relation: "handoff",
      label: "넘김",
      keywordHits: [],
    }))
    expect(recommendExecutorConnectionRelations({ source, target: lead })[0]).toEqual(expect.objectContaining({
      relation: "handoff",
      label: "넘김",
      keywordHits: [],
    }))
    expect(recommendExecutorConnectionRelations({ source, target: reviewer })[0]).toEqual(expect.objectContaining({
      relation: "handoff",
      label: "넘김",
      keywordHits: [],
    }))
  })

  it("keeps failure or exception wording as default handoff until the user or server suggestion chooses otherwise", () => {
    const source = executor("node:primary", "기본 처리", "실패나 예외 상황이 생기면 정리한다.")
    const target = executor("node:escalation", "예외 처리 담당자", "장애와 오류를 확인하고 다음 조치를 보고한다.", "human_check")
    const recommendations = recommendExecutorConnectionRelations({ source, target })

    expect(recommendations[0]).toEqual(expect.objectContaining({
      relation: "handoff",
      label: "넘김",
      keywordHits: [],
    }))
  })

  it("confirms an explicit user-selected relation through the simple connection menu chip model", () => {
    const source = executor("node:intake", "고객 접수 담당자", "고객 요청을 정리한다.")
    const target = executor("node:approval", "승인자", "승인 여부를 확인한다.", "approval")
    const connection = createExecutorConnectionDraft({ source, target })
    const recommendation = {
      relation: "approval_request" as const,
      confidence: 1,
    }
    const confirmed = applyExecutorConnectionRecommendation(connection, recommendation)
    const html = renderToStaticMarkup(
      createElement(ExecutorConnectionMenu, {
        source,
        target,
        connection: confirmed,
      }),
    )

    expect(confirmed).toEqual(expect.objectContaining({
      inferredRelation: "approval_request",
      label: "승인 요청",
      userConfirmed: true,
    }))
    expect(html).toContain('data-testid="executor-connection-menu"')
    expect(html).toContain('data-testid="executor-connection-recommendation-chip"')
    expect(html).toContain('data-active-relation="approval_request"')
    expect(html).toContain('data-relation="handoff"')
    expect(html).toContain("승인 요청")
    expect(html).not.toContain("delegates_to")
    expect(html).not.toContain("approves")
  })

  it("maps simple executor connections to safe EnterpriseTopology relations", () => {
    const source = executor("node:ops", "운영 담당자", "처리 결과를 정리한다.")
    const approval = executor("node:approval", "승인자", "승인 여부를 확인한다.", "approval")
    const lead = executor("node:lead", "운영 리드", "보고를 받고 다음 조치를 정한다.", "human_check")
    const escalation = executor("node:escalation", "예외 처리 담당자", "실패나 예외 상황을 처리한다.", "human_check")
    const approvalConnection = connection("connection:approval", source, approval, "approval_request")
    const reportConnection = connection("connection:report", source, lead, "report")
    const exceptionConnection = connection("connection:exception", source, escalation, "exception")
    const result = compileExecutorGraphToEnterpriseTopology(graph([
      source,
      approval,
      lead,
      escalation,
    ], [
      approvalConnection,
      reportConnection,
      exceptionConnection,
    ]), { now })

    expect(executorConnectionRelationToEnterpriseRelationType("approval_request")).toBe("approves")
    expect(executorConnectionToSafeEnterpriseRelationType({ connection: approvalConnection, source, target: approval })).toBe("delegates_to")
    expect(executorConnectionToSafeEnterpriseRelationType({ connection: reportConnection, source, target: lead })).toBe("informs")
    expect(executorConnectionToSafeEnterpriseRelationType({ connection: exceptionConnection, source, target: escalation })).toBe("escalates_to")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.topology.relations.map((relation) => relation.relationType)).toEqual([
      "delegates_to",
      "informs",
      "escalates_to",
    ])
    expect(validateEnterpriseTopology(result.topology).ok).toBe(true)
  })

  it("keeps internal relation type visible in advanced mode", () => {
    const html = renderToStaticMarkup(
      createElement(RelationModeToolbar, {
        selectedRelationMode: "delegates_to",
        selectedRelationType: "delegates_to",
      }),
    )

    expect(html).toContain('data-testid="enterprise-relation-mode-toolbar"')
    expect(html).toContain('data-active-relation-type="delegates_to"')
    expect(html).toContain("Smart Connect")
  })
})

function executor(
  id: string,
  name: string,
  description: string,
  inferredRuntimeMode: ExecutorDraft["inferredRuntimeMode"] = "auto",
): ExecutorDraft {
  return {
    id,
    name,
    description,
    inferredRuntimeMode,
    inferredCapabilities: [name, description],
    inferredTools: [],
    inferredOutputs: ["처리 결과"],
    inferredSuccessCriteria: ["처리 결과가 기록됨"],
    confidence: 0.78,
    advancedMapping: {
      nodeType: inferredRuntimeMode === "approval"
        ? "approval_node"
        : inferredRuntimeMode === "human_check"
          ? "review_node"
          : "function",
      executorKind: inferredRuntimeMode === "auto" ? "nobie" : "manual_approval",
      allowedToolIds: [],
      allowedSystemIds: [],
    },
  }
}

function connection(
  id: string,
  source: ExecutorDraft,
  target: ExecutorDraft,
  inferredRelation: ExecutorConnectionDraft["inferredRelation"],
): ExecutorConnectionDraft {
  return {
    id,
    fromExecutorId: source.id,
    toExecutorId: target.id,
    inferredRelation,
    label: inferredRelation === "approval_request"
      ? "승인 요청"
      : inferredRelation === "report"
        ? "보고"
        : inferredRelation === "exception"
          ? "예외 처리"
          : "넘김",
    confidence: 0.82,
    userConfirmed: true,
  }
}

function graph(executors: ExecutorDraft[], connections: ExecutorConnectionDraft[]): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:task007",
    topologyId: "topology:task007",
    name: "Task007 graph",
    mode: "simple",
    executors,
    sections: [],
    connections,
    selectedId: null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.8,
      executorCount: executors.length,
      connectionCount: connections.length,
      issueCount: 0,
      generatedAt: now,
    },
    compiledPreview: null,
    latestRun: null,
    issues: [],
    sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  }
}
