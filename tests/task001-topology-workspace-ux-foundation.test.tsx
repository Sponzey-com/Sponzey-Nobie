import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  TOPOLOGY_RELATION_TEMPLATE_CATALOG,
  recommendTopologySmartConnectRelation,
} from "../packages/core/src/topology/relation-templates.ts"
import { TOPOLOGY_TEMPLATE_CATALOG } from "../packages/core/src/topology/templates.ts"
import { TopologyWorkspaceFirstStartPanel } from "../packages/webui/src/components/topology/TopologyWorkspaceFirstStart.tsx"
import {
  TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE,
  TOPOLOGY_WORKSPACE_INTERNAL_TERMS,
  TOPOLOGY_WORKSPACE_LAYER_COPY,
  containsInternalTopologyTerm,
} from "../packages/webui/src/lib/topology-workspace-copy.ts"
import {
  TOPOLOGY_WORKSPACE_STARTER_TEMPLATES,
  buildTopologyWorkspaceStarterDraft,
} from "../packages/webui/src/lib/topology-workspace-templates.ts"

describe("task001 topology workspace UX foundation", () => {
  it("keeps beginner layer labels simple and hides internal topology terms from beginner copy", () => {
    expect(TOPOLOGY_WORKSPACE_LAYER_COPY.map((item) => item.labelKo)).toEqual([
      "만들기",
      "실행",
      "기록",
      "개선",
      "리소스",
    ])
    expect(TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE.layers.map((item) => item.labelKo)).toEqual([
      "만들기",
      "실행",
      "기록",
      "개선",
    ])
    expect(TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE.layers.map((item) => item.labelEn)).not.toContain("Resources")
    expect(TOPOLOGY_WORKSPACE_LAYER_COPY.map((item) => item.layer)).toEqual([
      "build",
      "run",
      "trace",
      "improve",
      "resources",
    ])

    const beginnerSurface = JSON.stringify(TOPOLOGY_WORKSPACE_BEGINNER_COPY_SURFACE)
    expect(containsInternalTopologyTerm(beginnerSurface)).toBe(false)
    for (const hiddenTerm of TOPOLOGY_WORKSPACE_INTERNAL_TERMS) {
      expect(beginnerSurface).not.toContain(hiddenTerm)
    }
  })

  it("renders a template-first starter gallery with an actionable empty canvas affordance", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyWorkspaceFirstStartPanel, {
        templates: TOPOLOGY_WORKSPACE_STARTER_TEMPLATES,
      }),
    )

    expect(TOPOLOGY_WORKSPACE_STARTER_TEMPLATES).toHaveLength(6)
    expect(TOPOLOGY_WORKSPACE_STARTER_TEMPLATES.filter((item) => item.id !== "blank-graph")).toHaveLength(5)
    expect(html).toContain('data-testid="topology-workspace-first-start"')
    expect(html).toContain('data-testid="topology-workspace-add-first-step"')
    expect(html).toContain("첫 실행자 추가")
    expect(html).toContain("고객 요청 처리 흐름")
    expect(html).toContain("승인 요청 흐름")
    expect(html).toContain("조사 후 검토 흐름")
    expect(html).toContain("도구를 사용하는 업무")
    expect(html).toContain("에스컬레이션 흐름")
    expect(html).toContain("빈 그래프")
    expect(html).not.toContain("Declared")
    expect(html).not.toContain("AgentConfig")
    expect(html).not.toContain("SubSession")
  })

  it("creates a starter topology without free-form typing", () => {
    const draft = buildTopologyWorkspaceStarterDraft("customer-request-flow", {
      topologyId: "topology:test-starter",
      now: Date.UTC(2026, 3, 30, 12, 0, 0),
    })
    const blank = buildTopologyWorkspaceStarterDraft("blank-graph", {
      topologyId: "topology:test-blank",
      now: Date.UTC(2026, 3, 30, 12, 0, 0),
    })

    expect(draft.id).toBe("topology:test-starter")
    expect(draft.nodes.map((node) => node.name)).toEqual(["요청 접수", "요청 검토", "답변 정리"])
    expect(draft.relations.map((relation) => relation.relationType)).toEqual(["delegates_to", "delegates_to"])
    expect(draft.nodes.every((node) => node.template?.fixedRoleCatalog === false)).toBe(true)
    expect(draft.nodes.every((node) => node.template?.metadata?.successCriteria !== undefined)).toBe(true)
    expect(blank.nodes).toHaveLength(0)
    expect(blank.relations).toHaveLength(0)
  })

  it("exposes beginner starter templates through the core topology template catalog", () => {
    expect(TOPOLOGY_TEMPLATE_CATALOG.workspaceStarterTemplates.map((item) => item.id)).toEqual([
      "customer-request-flow",
      "approval-request-flow",
      "research-review-flow",
      "tool-assisted-flow",
      "escalation-flow",
      "blank-graph",
    ])
    expect(TOPOLOGY_TEMPLATE_CATALOG.workspaceStarterTemplates.every((item) => item.noTypingRequired)).toBe(true)
    expect(TOPOLOGY_TEMPLATE_CATALOG.nodePresets.map((item) => item.labelKo)).toEqual([
      "업무 단계",
      "검토 단계",
      "도구 사용 단계",
    ])
  })

  it("recommends Smart Connect relations for common beginner node combinations", () => {
    const taskToTask = recommendTopologySmartConnectRelation({
      source: { entityType: "node", nodeType: "function" },
      target: { entityType: "node", nodeType: "function" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })
    const taskToApproval = recommendTopologySmartConnectRelation({
      source: { entityType: "node", nodeType: "function" },
      target: { entityType: "node", nodeType: "approval_node" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })
    const taskToTool = recommendTopologySmartConnectRelation({
      source: { entityType: "node", nodeType: "automation_node" },
      target: { entityType: "enterprise_tool" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })
    const groupToTask = recommendTopologySmartConnectRelation({
      source: { entityType: "team" },
      target: { entityType: "node", nodeType: "function" },
      catalog: TOPOLOGY_RELATION_TEMPLATE_CATALOG,
    })

    expect(taskToTask).toEqual(expect.objectContaining({
      relationType: "delegates_to",
      direction: "source_to_target",
      labelKo: "다음 업무로 연결",
    }))
    expect(taskToApproval).toEqual(expect.objectContaining({
      relationType: "delegates_to",
      direction: "source_to_target",
      labelKo: "승인 단계로 연결",
    }))
    expect(taskToTool).toEqual(expect.objectContaining({
      relationType: "uses_tool",
      direction: "source_to_target",
      labelKo: "도구 사용으로 연결",
    }))
    expect(groupToTask).toEqual(expect.objectContaining({
      relationType: "belongs_to",
      direction: "target_to_source",
      labelKo: "그룹에 넣기",
    }))
  })
})
