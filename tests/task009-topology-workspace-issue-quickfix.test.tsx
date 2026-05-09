import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import {
  buildExampleEnterpriseTopology,
  validateTopology,
  type EnterpriseTopology,
} from "../packages/core/src/index.ts"
import type {
  EnterpriseTopologyFailureReportRecord,
  EnterpriseTopologyRunRecord,
} from "../packages/webui/src/lib/enterprise-topology-operations.ts"
import {
  TopologyValidationAssistant,
  buildTopologyQuickFixOperations,
  buildTopologyQuickFixPlans,
  buildTopologyWorkspaceIssues,
  topologyWorkspaceIssueTargetId,
} from "../packages/webui/src/components/topology/TopologyValidationAssistant.tsx"
import type { EnterpriseTopologyValidationIssue } from "../packages/webui/src/contracts/enterprise-topology.ts"

const now = Date.UTC(2026, 3, 30, 21, 0, 0)

function topologyFixture(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function topologyWithMissingToolPermission(): EnterpriseTopology {
  const topology = topologyFixture()
  topology.nodes[0]!.allowedToolIds = []
  return topology
}

function issue(input: Partial<EnterpriseTopologyValidationIssue>): EnterpriseTopologyValidationIssue {
  return {
    path: input.path ?? "$.nodes[0].allowedToolIds[0]",
    code: input.code ?? input.reasonCode ?? "tool_permission_missing",
    reasonCode: input.reasonCode ?? input.code ?? "tool_permission_missing",
    severity: input.severity ?? "blocked",
    message: input.message ?? "Node uses or accesses a tool that is not included in allowedToolIds.",
    entityId: input.entityId ?? "node:intake",
    entityType: input.entityType ?? "node",
    refId: input.refId ?? "tool:crm-search",
    refType: input.refType ?? "enterprise_tool",
    relationId: input.relationId ?? "relation:intake-crm-search",
    ...input,
  }
}

function runRecord(): EnterpriseTopologyRunRecord {
  return {
    topologyRunId: "topology-run:task009",
    topologyId: "topology:customer-success",
    status: "failed",
    entryNodeId: "node:intake",
    startedAt: now,
    finishedAt: now + 1000,
    createdAt: now,
    updatedAt: now + 1000,
  }
}

function failureRecord(): EnterpriseTopologyFailureReportRecord {
  return {
    failureReportId: "failure-report:task009",
    topologyRunId: "topology-run:task009",
    nodeRunId: "node-run:task009",
    workOrderId: "work-order:task009",
    nodeId: "node:intake",
    failurePhase: "exhaustion",
    createdAt: now + 1000,
    report: {
      schemaVersion: 1,
      failureReportId: "failure-report:task009",
      topologyRunId: "topology-run:task009",
      nodeRunId: "node-run:task009",
      workOrderId: "work-order:task009",
      nodeId: "node:intake",
      exhaustionSummary: {
        selfExecutionAttempted: true,
        childDelegationAttempted: true,
        toolExecutionAttempted: true,
        retryAttempted: true,
        fallbackAttempted: false,
        partialSuccessChecked: true,
        parentRecoveryPossibleChecked: true,
        successCriteriaStillNotMet: true,
        complete: true,
      },
      attempts: [],
      untriedOptions: ["fallback"],
      recommendedAction: "Add a fallback review path.",
      createdAt: now + 1000,
    },
  }
}

describe("task009 topology workspace issue drawer and quick fixes", () => {
  it("maps validation issue selection to the canvas target", () => {
    const workspaceIssues = buildTopologyWorkspaceIssues({
      validationIssues: [issue({ relationId: "relation:intake-crm-search" })],
      topology: topologyFixture(),
    })
    const html = renderToStaticMarkup(
      createElement(TopologyValidationAssistant, {
        issues: [issue({ relationId: "relation:intake-crm-search" })],
        topology: topologyFixture(),
      }),
    )

    expect(topologyWorkspaceIssueTargetId(workspaceIssues[0]!)).toBe("relation:intake-crm-search")
    expect(html).toContain('data-testid="topology-workspace-issue-drawer"')
    expect(html).toContain('data-target-id="relation:intake-crm-search"')
  })

  it("shows runtime failures in the same issue drawer with a runtime source label", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyValidationAssistant, {
        issues: [],
        topology: topologyFixture(),
        runtimeOverlay: {
          run: runRecord(),
          traceEvents: [],
          toolCalls: [],
          failureReports: [failureRecord()],
        },
      }),
    )

    expect(html).toContain('data-testid="topology-workspace-issue-source-runtime"')
    expect(html).toContain('data-testid="topology-workspace-issue-runtime"')
    expect(html).toContain("실행 실패를 복구해야 합니다.")
    expect(html).toContain("fallback path 추가")
  })

  it("does not expose tool permission quick fixes in the default validation assistant", () => {
    const html = renderToStaticMarkup(
      createElement(TopologyValidationAssistant, {
        issues: [issue({ reasonCode: "tool_permission_missing" })],
        topology: topologyWithMissingToolPermission(),
      }),
    )

    expect(html).toContain('data-testid="topology-validation-issue-tool_permission_missing"')
    expect(html).not.toContain('data-testid="topology-quickfix-preview-tool_permission_missing"')
    expect(html).not.toContain('data-testid="topology-validation-quickfix-tool_permission_missing"')
  })

  it("builds representative quick fixes as GUI operations", () => {
    const topology = topologyFixture()
    const toolPermission = buildTopologyQuickFixPlans(issue({ reasonCode: "tool_permission_missing" }), topology)[0]
    const approvalStep = buildTopologyQuickFixPlans(issue({ reasonCode: "approval_authority_missing" }), topology)[0]
    const connectNodes = buildTopologyQuickFixPlans(issue({
      reasonCode: "connect_selected_nodes",
      sourceEntityId: "node:intake",
      targetEntityId: "node:triage",
      relationId: undefined,
    }), topology)[0]
    const fallback = buildTopologyQuickFixPlans(issue({
      reasonCode: "runtime_failure_report",
      relationId: undefined,
    }), topology)[0]
    const outputPreset = buildTopologyQuickFixPlans(issue({
      reasonCode: "missing_success_criteria",
      relationId: undefined,
    }), topology)[0]

    expect(toolPermission).toBeUndefined()
    expect(approvalStep).toEqual(expect.objectContaining({
      quickFixId: "add_approval_step",
      operations: [expect.objectContaining({ op: "createRelation", relationType: "approves" })],
    }))
    expect(connectNodes).toEqual(expect.objectContaining({
      quickFixId: "connect_selected_nodes",
      operations: [expect.objectContaining({ op: "createRelation", relationType: "delegates_to" })],
    }))
    expect(fallback?.operations.map((operation) => operation.op)).toEqual(["createNode", "createRelation", "updateNode"])
    expect(outputPreset).toEqual(expect.objectContaining({
      quickFixId: "set_output_preset",
      operations: [expect.objectContaining({ op: "updateNode" })],
    }))
  })

  it("does not build GUI operations for legacy tool permission quick fixes", () => {
    const topology = topologyWithMissingToolPermission()
    const validationBefore = validateTopology(topology)
    const missingPermissionIssue = validationBefore.issues.find((candidate) =>
      candidate.reasonCode === "tool_permission_missing"
    )
    expect(missingPermissionIssue).toBeTruthy()

    const operations = buildTopologyQuickFixOperations(missingPermissionIssue as EnterpriseTopologyValidationIssue, topology)

    expect(operations).toEqual([])
    expect(validationBefore.issues.filter((item) => item.reasonCode === "tool_permission_missing")).toHaveLength(1)
  })
})
