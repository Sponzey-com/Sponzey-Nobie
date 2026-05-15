import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { EnterpriseTopology } from "../packages/webui/src/contracts/enterprise-topology.ts"
import { buildExecutorGraphCanvasModel } from "../packages/webui/src/lib/executor-graph-viewmodel.ts"

const now = Date.UTC(2026, 4, 10, 12, 0, 0)

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf-8")
}

function topologyFixture(): EnterpriseTopology {
  return {
    schemaVersion: 1,
    entityType: "topology",
    id: "workspace:draft",
    name: "기본 실행자 흐름",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        schemaVersion: 1,
        entityType: "node",
        id: "node:finance",
        name: "행랑아범",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        nodeType: "function",
        description: "시장 가격과 재무 정보를 확인한다.",
        tags: [],
        children: [],
        template: {
          templateId: "topology-template:node:finance",
          source: "user_custom",
          fixedRoleCatalog: false,
        },
        allowedToolIds: [],
        allowedSystemIds: [],
        failurePolicy: {
          failureReportRequired: true,
          allowPartialSuccess: true,
          fallbackNodeIds: [],
        },
        recoveryPolicy: {
          retryAllowed: false,
          redelegationAllowed: true,
          fallbackAllowed: false,
          partialSuccessAllowed: true,
        },
      },
    ],
    teams: [],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [
      {
        schemaVersion: 1,
        entityType: "enterprise_system",
        id: "system:market-data",
        name: "시장 데이터",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        systemType: "data_store",
        dataDomainIds: [],
        criticality: "medium",
      },
    ],
    tools: [
      {
        schemaVersion: 1,
        entityType: "enterprise_tool",
        id: "tool:quote",
        name: "시세 조회",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        toolType: "read_only",
        systemId: "system:market-data",
      },
    ],
    processes: [],
    relations: [
      {
        schemaVersion: 1,
        entityType: "relation",
        id: "relation:finance-tool",
        name: "행랑아범 uses 시세 조회",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        relationType: "uses_tool",
        from: { entityType: "node", id: "node:finance" },
        to: { entityType: "enterprise_tool", id: "tool:quote" },
      },
      {
        schemaVersion: 1,
        entityType: "relation",
        id: "relation:finance-system",
        name: "행랑아범 uses 시장 데이터",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        relationType: "uses_system",
        from: { entityType: "node", id: "node:finance" },
        to: { entityType: "enterprise_system", id: "system:market-data" },
      },
    ],
  }
}

describe("webui contract to view model boundary", () => {
  it("keeps EnterpriseTopology conversion in lib instead of the executor canvas component", () => {
    const componentSource = source("../packages/webui/src/components/topology/ExecutorGraphCanvas.tsx")
    const viewModelSource = source("../packages/webui/src/lib/executor-graph-viewmodel.ts")

    expect(componentSource).not.toContain("contracts/enterprise-topology")
    expect(componentSource).not.toContain("buildExecutorGraphFromEnterpriseTopology")
    expect(componentSource).not.toContain("resourceChipForRelation")
    expect(viewModelSource).toContain("buildExecutorGraphFromEnterpriseTopology")
    expect(viewModelSource).toContain("resourceChipForRelation")
  })

  it("maps API topology resources to executor card view model chips in the lib layer", () => {
    const model = buildExecutorGraphCanvasModel({ topology: topologyFixture() })

    expect(model?.unsectionedCards).toHaveLength(1)
    expect(model?.unsectionedCards[0]?.executor.name).toBe("행랑아범")
    expect(model?.unsectionedCards[0]?.resources).toEqual([
      { id: "tool:quote", label: "시세 조회", kind: "tool" },
      { id: "system:market-data", label: "시장 데이터", kind: "system" },
    ])
  })

  it("keeps runtime route code interpretation inside runtime-inspector view models", () => {
    const componentSource = source("../packages/webui/src/components/runs/RunRuntimeInspectorPanel.tsx")
    const viewModelSource = source("../packages/webui/src/lib/runtime-inspector.ts")

    expect(componentSource).toContain("buildRuntimeInspectorViewModels")
    expect(componentSource).not.toContain("runtimeDecisionSourceLabel")
    expect(componentSource).not.toContain("runtimeExecutionRouteLabel")
    expect(componentSource).not.toContain("runtimeFallbackReasonLabel")
    expect(componentSource).not.toContain("providerFallbackBlockedReasonCode")
    expect(componentSource).not.toContain("requestIdentity.requestGroupId")
    expect(viewModelSource).toContain("providerFallbackBlockedReasonCode")
    expect(viewModelSource).toContain("requestIdentity.requestGroupId")
  })
})
