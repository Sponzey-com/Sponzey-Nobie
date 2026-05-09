import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import { createCapabilities } from "../packages/core/src/control-plane/index.ts"
import {
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_ALLOWED_TYPING_INPUTS,
  ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_HAPPY_PATH,
  ENTERPRISE_TOPOLOGY_WORKSPACE_NO_TYPING_HAPPY_PATH,
  ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS,
  buildEnterpriseTopologyReleaseReadinessSummary,
  buildEnterpriseTopologyWorkspaceUsabilityGate,
} from "../packages/core/src/release/enterprise-topology-release-gate.ts"
import { TOPOLOGY_TEMPLATE_CATALOG } from "../packages/core/src/topology/templates.ts"
import { resolveTopologyRootRunRouting } from "../packages/core/src/topology-runtime/harness.ts"
import { WORK_ORDER_TEMPLATE_CATALOG } from "../packages/core/src/topology-runtime/work-order-templates.ts"
import { FeatureGate } from "../packages/webui/src/components/FeatureGate.tsx"
import {
  buildEnterpriseTopologyCanvasModel,
} from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
import {
  createEnterpriseTopologyPaletteEntity,
} from "../packages/webui/src/components/topology/EnterpriseTopologyPalette.tsx"
import {
  FALLBACK_RELATION_TEMPLATE_CATALOG,
  buildEnterpriseTopologyRelationDraft,
} from "../packages/webui/src/components/topology/RelationModeToolbar.tsx"
import {
  TopologyRunStrip,
  buildTopologyRunRequestPayload,
  resolveTopologyRunTargetState,
} from "../packages/webui/src/components/topology/TopologyRunStrip.tsx"
import {
  TopologyRunTraceOverlay,
  type TopologyRunTraceOverlayInput,
} from "../packages/webui/src/components/topology/TopologyRunTraceOverlay.tsx"
import {
  TopologyValidationAssistant,
  buildTopologyQuickFixPlans,
} from "../packages/webui/src/components/topology/TopologyValidationAssistant.tsx"
import {
  TopologyWorkspaceFirstStartPanel,
} from "../packages/webui/src/components/topology/TopologyWorkspaceFirstStart.tsx"
import type { FeatureCapability } from "../packages/webui/src/contracts/capabilities.ts"
import type { EnterpriseTopologyValidationIssue } from "../packages/webui/src/contracts/enterprise-topology.ts"
import {
  getUiNavigation,
  getUiRouteInventory,
  resolveLegacyAdvancedRoute,
} from "../packages/webui/src/lib/ui-mode.js"
import {
  TOPOLOGY_WORKSPACE_STARTER_TEMPLATES,
  buildTopologyWorkspaceStarterDraft,
} from "../packages/webui/src/lib/topology-workspace-templates.ts"
import { resolveTopologyWorkspaceInitialLayer } from "../packages/webui/src/pages/TopologyWorkspacePage.tsx"
import { useCapabilitiesStore } from "../packages/webui/src/stores/capabilities"

const now = Date.UTC(2026, 3, 30, 22, 0, 0)
const previousEnterpriseBuilderFlag = process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"]

function disabledBuilderCapability(): FeatureCapability {
  return {
    key: "enterprise_topology_builder_ui",
    label: "Topology Workspace",
    area: "gateway",
    status: "disabled",
    implemented: true,
    enabled: false,
    reason: "task012 feature flag off fallback",
  }
}

function fallbackIssue(entityId: string): EnterpriseTopologyValidationIssue {
  return {
    severity: "warning",
    path: "$.nodes[0].failurePolicy",
    code: "topology.warning",
    message: "fallback path missing",
    reasonCode: "fallback_path_missing",
    entityType: "node",
    entityId,
  }
}

function traceOverlay(topologyId: string): TopologyRunTraceOverlayInput {
  return {
    run: {
      topologyRunId: "topology-run:task012",
      topologyId,
      status: "completed",
      entryNodeId: "node:customer-request-intake",
      startedAt: now,
      finishedAt: now + 1000,
      createdAt: now,
      updatedAt: now + 1000,
    },
    traceEvents: [{
      traceEventId: "trace:task012:path",
      topologyRunId: "topology-run:task012",
      nodeRunId: "node-run:intake",
      workOrderId: "work-order:intake",
      phase: "child_delegation",
      component: "runtime",
      reasonCode: "delegation_path_recorded",
      delegationPath: ["node:customer-request-intake", "node:customer-request-review"],
      event: {
        schemaVersion: 1,
        traceEventId: "trace:task012:path",
        topologyRunId: "topology-run:task012",
        nodeRunId: "node-run:intake",
        workOrderId: "work-order:intake",
        phase: "child_delegation",
        component: "runtime",
        reasonCode: "delegation_path_recorded",
        delegationPath: ["node:customer-request-intake", "node:customer-request-review"],
        at: now,
      },
      at: now,
      sequence: 1,
    }],
    toolCalls: [],
    failureReports: [],
  }
}

afterEach(() => {
  useCapabilitiesStore.getState().setItems([])
  if (previousEnterpriseBuilderFlag === undefined) {
    delete process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"]
  } else {
    process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"] = previousEnterpriseBuilderFlag
  }
})

describe("task012 Topology Workspace release gate", () => {
  it("adds route, layer, and Executor-first workspace checks to Enterprise Topology release readiness", () => {
    const summary = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-04-30T00:00:00.000Z"),
    })
    const gate = buildEnterpriseTopologyWorkspaceUsabilityGate({
      now: new Date("2026-04-30T00:00:00.000Z"),
    })

    expect(summary.gateStatus).toBe("passed")
    expect(summary.workspaceUsability).toEqual(gate)
    expect(summary.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      "topology_workspace_route_compatibility",
      "topology_workspace_layer_gate",
      "topology_workspace_executor_first_usability",
      "topology_workspace_usability_gate",
    ]))
    expect(gate.requiredLayers).toEqual(ENTERPRISE_TOPOLOGY_WORKSPACE_RELEASE_LAYERS)
    expect(gate.noTypingHappyPath).toEqual(ENTERPRISE_TOPOLOGY_WORKSPACE_NO_TYPING_HAPPY_PATH)
    expect(gate.executorFirstHappyPath).toEqual(ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_HAPPY_PATH)
    expect(gate.allowedTypingInputs).toEqual(ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_ALLOWED_TYPING_INPUTS)
    expect(gate.routeCompatibility).toEqual(expect.objectContaining({
      canonicalRoute: "/advanced/topology",
      enterpriseBuilderAlias: "/advanced/enterprise-topology",
      enterpriseBuilderReplacement: "/advanced/topology?mode=build",
      runtimeResourcesRoute: null,
      legacyRuntimeMenuRemoved: true,
    }))
    expect(summary.regressionCommands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "topology_workspace_usability_gate",
        command: expect.arrayContaining([
          "tests/task013-executor-first-usability.test.tsx",
          "tests/task013-executor-first-release-gate.test.ts",
          "tests/task012-topology-workspace-release-gate.test.ts",
          "tests/task012-advanced-escape-hatch.test.tsx",
          "tests/task001-topology-workspace-ux-foundation.test.tsx",
          "tests/task002-topology-workspace-routing.test.tsx",
          "tests/task008-topology-workspace-run-strip.test.tsx",
          "tests/task011-topology-workspace-trace-improve.test.tsx",
        ]),
      }),
    ]))
  })

  it("fails readiness when a visible layer, route alias, removed resources route, or Executor-first step regresses", () => {
    const broken = buildEnterpriseTopologyReleaseReadinessSummary({
      now: new Date("2026-04-30T00:00:00.000Z"),
      workspaceUsability: buildEnterpriseTopologyWorkspaceUsabilityGate({
        now: new Date("2026-04-30T00:00:00.000Z"),
        requiredLayers: ["build", "run", "trace"],
        routeCompatibility: {
          enterpriseBuilderReplacement: "/advanced/enterprise-topology",
          runtimeResourcesRoute: "/advanced/topology?mode=resources" as never,
          legacyRuntimeMenuRemoved: false,
        },
        executorFirstHappyPath: ENTERPRISE_TOPOLOGY_EXECUTOR_FIRST_HAPPY_PATH.filter((step) =>
          step.id !== "connect_executors"
        ),
        allowedTypingInputs: ["executor_name", "executor_work"],
      }),
    })

    expect(broken.gateStatus).toBe("failed")
    expect(broken.blockingFailures.join("\n")).toContain("workspace_usability:missing_workspace_layer:improve")
    expect(broken.blockingFailures.join("\n")).toContain("workspace_usability:enterprise_topology_alias_not_preserved")
    expect(broken.blockingFailures.join("\n")).toContain("workspace_usability:runtime_resources_route_still_exposed")
    expect(broken.blockingFailures.join("\n")).toContain("workspace_usability:missing_executor_first_step:connect_executors")
    expect(broken.blockingFailures.join("\n")).toContain("workspace_usability:missing_allowed_typing_input:run_input")
    expect(broken.blockingFailures.join("\n")).toContain("topology_workspace_executor_first_usability")
  })

  it("exercises the simple compatibility path from template through Trace", () => {
    const starterHtml = renderToStaticMarkup(
      createElement(TopologyWorkspaceFirstStartPanel, {
        templates: TOPOLOGY_WORKSPACE_STARTER_TEMPLATES,
      }),
    )
    const starter = buildTopologyWorkspaceStarterDraft("customer-request-flow", {
      topologyId: "topology:task012",
      now,
    })
    const added = createEnterpriseTopologyPaletteEntity(starter, {
      kind: "task",
      now,
    }, TOPOLOGY_TEMPLATE_CATALOG)
    const canvas = buildEnterpriseTopologyCanvasModel(added.topology)
    const responseNode = canvas.nodes.find((node) => node.data.label === "답변 정리")
    const newNode = canvas.nodes.find((node) => node.data.entityId === added.entityRef.id)
    const relationDraft = buildEnterpriseTopologyRelationDraft({
      topology: added.topology,
      sourceNodeId: responseNode?.id ?? "",
      targetNodeId: newNode?.id ?? "",
      relationMode: "smart_connect",
      catalog: FALLBACK_RELATION_TEMPLATE_CATALOG,
      now,
    })
    if (!relationDraft.ok) throw new Error("expected Smart Connect relation draft")

    const targetState = resolveTopologyRunTargetState({
      topology: relationDraft.topology,
      selectedNodeId: starter.nodes[0]!.id,
    })
    const workOrderTemplate = WORK_ORDER_TEMPLATE_CATALOG.templates[0]!
    const contextPreset = workOrderTemplate.contextPresets[0]!
    const runPayload = buildTopologyRunRequestPayload({
      entryNodeId: targetState.targetNodeId ?? "node:customer-request-intake",
      templateId: workOrderTemplate.templateId,
      contextPresetId: contextPreset.id,
      simulationMode: "success",
      advancedInstruction: "",
    })
    const issue = fallbackIssue(starter.nodes[0]!.id)
    const quickFixPlans = buildTopologyQuickFixPlans(issue, relationDraft.topology)
    const runStripHtml = renderToStaticMarkup(
      createElement(TopologyRunStrip, {
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: workOrderTemplate.templateId,
        selectedContextPresetId: contextPreset.id,
        simulationMode: "success",
        advancedInstruction: "",
        runTargetNodeId: targetState.targetNodeId,
        targetState,
      }),
    )
    const quickFixHtml = renderToStaticMarkup(
      createElement(TopologyValidationAssistant, {
        issues: [issue],
        topology: relationDraft.topology,
      }),
    )
    const traceHtml = renderToStaticMarkup(
      createElement(TopologyRunTraceOverlay, {
        overlay: traceOverlay(relationDraft.topology.id),
      }),
    )
    const combinedHtml = [starterHtml, runStripHtml, quickFixHtml, traceHtml].join("\n")

    expect(starterHtml).toContain("고객 요청 처리 흐름")
    expect(added.entityRef.entityType).toBe("node")
    expect(relationDraft.relation.scope).toEqual(expect.objectContaining({
      smartConnect: true,
      relationMode: "next",
    }))
    expect(quickFixPlans[0]).toEqual(expect.objectContaining({
      quickFixId: "add_fallback_path",
    }))
    expect(runPayload).toEqual({
      entryNodeId: "node:customer-request-intake",
      templateId: workOrderTemplate.templateId,
      contextPresetId: contextPreset.id,
      simulationMode: "success",
      input: { launchedFrom: "enterprise_topology_builder" },
    })
    expect(runStripHtml).toContain('data-testid="topology-run-simple-panel"')
    expect(runStripHtml).not.toContain('data-layout="one-line"')
    expect(runStripHtml).not.toContain("WorkOrder Template")
    expect(runStripHtml).not.toContain("Context")
    expect(quickFixHtml).toContain('data-testid="topology-validation-quickfix-fallback_path_missing"')
    expect(traceHtml).toContain('data-testid="topology-trace-delegation-path"')
    for (const hiddenTerm of ["AgentConfig", "SubSession", "CompiledSnapshot", "raw JSON", "YAML"]) {
      expect(combinedHtml).not.toContain(hiddenTerm)
    }
  })

  it("keeps feature-flag-off fallback for workspace routes and root-run routing", () => {
    process.env["NOBIE_ENTERPRISE_TOPOLOGY_BUILDER_UI"] = "off"
    useCapabilitiesStore.getState().setItems([disabledBuilderCapability()])
    const apiCapability = createCapabilities().find((item) => item.key === "enterprise_topology_builder_ui")
    const featureGateHtml = renderToStaticMarkup(
      createElement(
        FeatureGate,
        { capabilityKey: "enterprise_topology_builder_ui", title: "토폴로지" },
        createElement("div", null, "workspace route content"),
      ),
    )
    const inventory = getUiRouteInventory()
    const appSource = readFileSync(new URL("../packages/webui/src/App.tsx", import.meta.url), "utf-8")
    const decision = resolveTopologyRootRunRouting({
      message: "topology:customer-success 고객 요청 처리",
      runId: "run:task012-off",
      sessionId: "session:task012-off",
      source: "webui",
      targetId: "topology:customer-success",
      isRootRequest: true,
      featureFlag: {
        featureKey: "topology_runtime_enabled",
        mode: "off",
        compatibilityMode: true,
        updatedAt: 0,
        updatedBy: "task012",
        reason: "task012 off path",
        evidence: null,
        source: "default",
      },
    })

    expect(apiCapability).toEqual(expect.objectContaining({ enabled: false, status: "disabled" }))
    expect(featureGateHtml).toContain("기능 플래그")
    expect(featureGateHtml).not.toContain("workspace route content")
    expect(getUiNavigation("advanced", false).filter((item) => item.path.includes("topology"))).toEqual([
      expect.objectContaining({ path: "/advanced/topology" }),
    ])
    expect(inventory.find((item) => item.path === "/advanced/enterprise-topology")).toEqual(
      expect.objectContaining({
        status: "compatibility",
        replacementPath: "/advanced/topology?mode=build",
      }),
    )
    expect(resolveLegacyAdvancedRoute("/enterprise-topology")).toBe("/advanced/topology")
    expect(resolveTopologyWorkspaceInitialLayer("?mode=resources")).toBe("build")
    expect(resolveTopologyWorkspaceInitialLayer("?mode=improve")).toBe("improve")
    expect(appSource).toContain('path="/advanced/enterprise-topology"')
    expect(appSource).toContain('to="/advanced/topology?mode=build"')
    expect(decision).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "feature_flag_off",
      explicitTopologyId: "topology:customer-success",
    }))
  })

  it("documents workspace rollout and rollback in the release runbook", () => {
    const runbook = readFileSync(new URL("../docs/release-runbook.md", import.meta.url), "utf-8")

    expect(runbook).toContain("Topology Workspace route gate")
    expect(runbook).toContain("/advanced/enterprise-topology")
    expect(runbook).toContain("/advanced/topology?mode=build")
    expect(runbook).toContain("/advanced/topology?mode=resources")
    expect(runbook).toContain("must stay on the simple Executor Graph surface")
    expect(runbook).toContain("old Runtime Topology menu")
    expect(runbook).toContain("Executor-first usability gate")
    expect(runbook).toContain("Default UX leak gate")
    expect(runbook).toContain("enterprise_topology_builder_ui=off")
    expect(runbook).toContain("declared_observed_topology_analysis=off")
    expect(runbook).toContain("topology_runtime_enabled")
  })
})
