import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { describe, expect, it } from "vitest"
import { WORK_ORDER_TEMPLATE_CATALOG } from "../packages/core/src/topology-runtime/work-order-templates.ts"
import type { EnterpriseTopologyRunRecord } from "../packages/webui/src/lib/enterprise-topology-operations.ts"
import {
  createEmptyEnterpriseTopologyForPalette,
} from "../packages/webui/src/components/topology/EnterpriseTopologyPalette.tsx"
import {
  TopologyRunStrip,
  buildTopologyRunRequestPayload,
  resolveTopologyRunTargetState,
} from "../packages/webui/src/components/topology/TopologyRunStrip.tsx"
import {
  buildTopologyWorkspaceStarterDraft,
} from "../packages/webui/src/lib/topology-workspace-templates.ts"

const now = Date.UTC(2026, 3, 30, 20, 0, 0)
const template = WORK_ORDER_TEMPLATE_CATALOG.templates[0]!

function submitButtonTag(html: string): string {
  return html.match(/<button[^>]*data-testid="topology-run-submit"[^>]*>/)?.[0] ?? ""
}

function runRecord(overrides: Partial<EnterpriseTopologyRunRecord> = {}): EnterpriseTopologyRunRecord {
  return {
    topologyRunId: "topology-run:latest",
    topologyId: "topology:task008",
    status: "completed",
    entryNodeId: "node:tool-assisted-work",
    startedAt: now,
    finishedAt: now + 1000,
    createdAt: now,
    updatedAt: now + 1000,
    metadata: {
      templateId: template.templateId,
      contextPresetId: template.contextPresets[0]!.id,
    },
    ...overrides,
  }
}

describe("task008 topology workspace run strip", () => {
  it("renders the simple run panel without WorkOrder Template or Context controls", () => {
    const topology = buildTopologyWorkspaceStarterDraft("tool-assisted-flow", { now })
    const targetState = resolveTopologyRunTargetState({ topology })
    const html = renderToStaticMarkup(
      createElement(TopologyRunStrip, {
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: template.templateId,
        selectedContextPresetId: template.contextPresets[0]!.id,
        simulationMode: "success",
        advancedInstruction: "",
        runTargetNodeId: targetState.targetNodeId,
        targetState,
      }),
    )

    expect(html).toContain('data-testid="topology-run-simple-panel"')
    expect(html).not.toContain('data-testid="topology-run-strip-controls"')
    expect(html).not.toContain('data-layout="one-line"')
    expect(html).not.toContain("Manual Run")
    expect(html).not.toContain("Target")
    expect(html).not.toContain("WorkOrder Template")
    expect(html).not.toContain("Context")
    expect(html).toContain("실행")
    expect(html).not.toContain('data-testid="topology-run-advanced-input"')
    expect(html).not.toContain("<details open")
  })

  it("enables Run when the selected canvas node is resolved as the target", () => {
    const topology = buildTopologyWorkspaceStarterDraft("approval-request-flow", { now })
    const targetState = resolveTopologyRunTargetState({
      topology,
      selectedNodeId: "node:approval-step",
    })
    const html = renderToStaticMarkup(
      createElement(TopologyRunStrip, {
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: template.templateId,
        selectedContextPresetId: template.contextPresets[0]!.id,
        simulationMode: "success",
        advancedInstruction: "",
        runTargetNodeId: targetState.targetNodeId,
        targetState,
      }),
    )

    expect(targetState).toEqual(expect.objectContaining({
      source: "selection",
      targetNodeId: "node:approval-step",
      issue: null,
    }))
    expect(submitButtonTag(html)).not.toContain('disabled=""')
  })

  it("auto-selects the only entry node", () => {
    const topology = buildTopologyWorkspaceStarterDraft("tool-assisted-flow", { now })
    const targetState = resolveTopologyRunTargetState({ topology })

    expect(targetState).toEqual(expect.objectContaining({
      source: "auto_entry",
      targetNodeId: "node:tool-assisted-work",
      entryNodeIds: ["node:tool-assisted-work"],
      issue: null,
    }))
  })

  it("shows a start-node quick fix when no entry node exists", () => {
    const topology = createEmptyEnterpriseTopologyForPalette({
      topologyId: "topology:empty",
      now,
    })
    const targetState = resolveTopologyRunTargetState({ topology })
    const html = renderToStaticMarkup(
      createElement(TopologyRunStrip, {
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: template.templateId,
        selectedContextPresetId: template.contextPresets[0]!.id,
        simulationMode: "success",
        advancedInstruction: "",
        targetState,
      }),
    )

    expect(targetState.issue).toBe("no_entry_node")
    expect(html).toContain('data-testid="topology-run-entry-quick-fix"')
    expect(html).toContain("시작 실행자 지정")
    expect(submitButtonTag(html)).toContain('disabled=""')
  })

  it("preserves WorkOrder template and context choices in the run payload", () => {
    const payload = buildTopologyRunRequestPayload({
      entryNodeId: "node:intake",
      templateId: "work-order-template:customer-request-triage",
      contextPresetId: "context:customer-urgent",
      simulationMode: "failure",
      advancedInstruction: "  추가 지시  ",
    })

    expect(payload).toEqual({
      entryNodeId: "node:intake",
      templateId: "work-order-template:customer-request-triage",
      contextPresetId: "context:customer-urgent",
      simulationMode: "failure",
      input: { launchedFrom: "enterprise_topology_builder" },
      advancedInstruction: "추가 지시",
    })
  })

  it("shows trace handoff CTA and recent run mini history after a run", () => {
    const latestRun = runRecord()
    const html = renderToStaticMarkup(
      createElement(TopologyRunStrip, {
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: template.templateId,
        selectedContextPresetId: template.contextPresets[0]!.id,
        simulationMode: "success",
        advancedInstruction: "",
        runTargetNodeId: latestRun.entryNodeId,
        recentRuns: [latestRun],
        selectedRunId: latestRun.topologyRunId,
        traceOverlay: {
          run: latestRun,
          traceEvents: [],
          toolCalls: [],
          failureReports: [],
        },
      }),
    )

    expect(html).toContain('data-testid="topology-run-trace-cta"')
    expect(html).toContain("기록 보기")
    expect(html).toContain('data-testid="topology-run-history"')
    expect(html).toContain('data-testid="topology-run-history-item"')
    expect(html).toContain("node:tool-assisted-work")
  })
})
