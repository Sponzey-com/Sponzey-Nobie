import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import {
  registerTopologyRoutes,
  resetTopologyGuiDraftStoreForTest,
} from "../packages/core/src/api/routes/topologies.ts"
import { registerTopologyRunRoutes } from "../packages/core/src/api/routes/topology-runs.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { buildExampleEnterpriseTopology } from "../packages/core/src/index.ts"
import { WORK_ORDER_TEMPLATE_CATALOG } from "../packages/core/src/topology-runtime/work-order-templates.ts"
import {
  EnterpriseTopologyCanvasShell,
  buildEnterpriseTopologyCanvasModel,
} from "../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx"
import { TopologyRunLauncher } from "../packages/webui/src/components/topology/TopologyRunLauncher.tsx"
import {
  TopologyRunTraceOverlay,
  buildTopologyRunOverlayState,
} from "../packages/webui/src/components/topology/TopologyRunTraceOverlay.tsx"

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
    remoteAddress?: string
  }): Promise<{ statusCode: number; json(): any }>
}

const now = Date.UTC(2026, 3, 30, 11, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function topologyFixture() {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function useTempState(): void {
  closeDb()
  resetTopologyGuiDraftStoreForTest()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task021-topology-run-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

afterEach(() => {
  closeDb()
  resetTopologyGuiDraftStoreForTest()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
})

async function startDraft(app: ReturnType<typeof Fastify>) {
  const topology = topologyFixture()
  const response = await app.inject({
    method: "POST",
    url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
    payload: { topology, reset: true },
    remoteAddress: "127.0.0.1",
  })
  expect(response.statusCode).toBe(201)
  return topology
}

describe("task021 enterprise topology manual run and trace UI", () => {
  it("keeps manual run target controls out of the removed advanced canvas surface", () => {
    const model = buildEnterpriseTopologyCanvasModel(topologyFixture())
    const html = renderToStaticMarkup(
      createElement(EnterpriseTopologyCanvasShell, {
        model,
        selectedNodeId: "node:node:intake",
        runTargetNodeId: "node:intake",
        onRunTargetChange: () => undefined,
      }),
    )

    expect(html).not.toContain('data-testid="topology-run-target-panel"')
    expect(html).not.toContain('data-testid="topology-run-target-select"')
    expect(html).toContain('data-testid="topology-run-trace-overlay"')
  })

  it("renders the simple run launcher without WorkOrder template or context pickers", () => {
    const template = WORK_ORDER_TEMPLATE_CATALOG.templates[0]!
    const html = renderToStaticMarkup(
      createElement(TopologyRunLauncher, {
        templates: WORK_ORDER_TEMPLATE_CATALOG.templates,
        selectedTemplateId: template.templateId,
        selectedContextPresetId: template.contextPresets[0]!.id,
        simulationMode: template.defaultSimulationMode,
        advancedInstruction: "",
        runTargetNodeId: "node:intake",
      }),
    )

    expect(html).toContain('data-testid="executor-run-panel"')
    expect(html).toContain('data-testid="topology-run-simple-panel"')
    expect(html).not.toContain('data-testid="topology-run-template-picker"')
    expect(html).not.toContain('data-testid="topology-run-context-picker"')
    expect(html).not.toContain("고객 요청 분류")
    expect(html).not.toContain("일반 문의")
    expect(html).not.toContain('data-testid="topology-run-advanced-input"')
    expect(html).not.toContain("<details open")
  })

  it("loads the WorkOrder template catalog through the API", async () => {
    const app = Fastify({ logger: false })
    registerTopologyRunRoutes(app)
    await app.ready()
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/work-order-templates",
        remoteAddress: "127.0.0.1",
      })
      const body = response.json()

      expect(response.statusCode).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.templates.map((template: { templateId: string }) => template.templateId)).toEqual([
        "work-order-template:customer-request-triage",
        "work-order-template:failure-drill",
      ])
    } finally {
      await app.close()
    }
  })

  it("starts a manual topology run and exposes trace through the run APIs", async () => {
    useTempState()
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    registerTopologyRunRoutes(app)
    await app.ready()
    try {
      const topology = await startDraft(app)
      const run = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft/run`,
        payload: {
          entryNodeId: "node:intake",
          templateId: "work-order-template:customer-request-triage",
          contextPresetId: "context:customer-general",
          input: { launchedFrom: "test" },
          simulationMode: "success",
        },
        remoteAddress: "127.0.0.1",
      })
      const runBody = run.json()
      const trace = await app.inject({
        method: "GET",
        url: `/api/topology-runs/${encodeURIComponent(runBody.topologyRunId)}/trace`,
        remoteAddress: "127.0.0.1",
      })
      const failures = await app.inject({
        method: "GET",
        url: `/api/topology-runs/${encodeURIComponent(runBody.topologyRunId)}/failure-reports`,
        remoteAddress: "127.0.0.1",
      })

      expect(run.statusCode).toBe(200)
      expect(runBody).toMatchObject({
        ok: true,
        entryNodeId: "node:intake",
        templateId: "work-order-template:customer-request-triage",
        contextPresetId: "context:customer-general",
        simulationMode: "success",
      })
      expect(runBody.topologyRun.run.metadata).toEqual(expect.objectContaining({
        source: "enterprise_topology_gui",
        templateId: "work-order-template:customer-request-triage",
        entryNodeId: "node:intake",
      }))
      expect(trace.statusCode).toBe(200)
      expect(trace.json().traceEvents.map((event: { phase: string }) => event.phase)).toEqual(
        expect.arrayContaining(["child_delegation", "tool_execution"]),
      )
      expect(failures.statusCode).toBe(200)
      expect(failures.json().failureReports).toEqual([])
    } finally {
      await app.close()
    }
  })

  it("renders delegation path, tool calls, failed candidate, and FailureReport overlay state", async () => {
    useTempState()
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    registerTopologyRunRoutes(app)
    await app.ready()
    try {
      const topology = await startDraft(app)
      const run = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft/run`,
        payload: {
          entryNodeId: "node:intake",
          templateId: "work-order-template:failure-drill",
          contextPresetId: "context:missing-data",
          simulationMode: "failure",
        },
        remoteAddress: "127.0.0.1",
      })
      const runBody = run.json()
      const traceEvents = runBody.topologyRun.traceEvents
      const toolCalls = runBody.topologyRun.toolCalls
      const failureReports = runBody.topologyRun.failureReports
      const overlay = {
        run: runBody.topologyRun.run,
        traceEvents,
        toolCalls,
        failureReports,
      }
      const overlayState = buildTopologyRunOverlayState(overlay)
      const html = renderToStaticMarkup(
        createElement(TopologyRunTraceOverlay, { overlay }),
      )

      expect(run.statusCode).toBe(200)
      expect(runBody.simulationMode).toBe("failure")
      expect(failureReports).toHaveLength(1)
      expect(overlayState.failedNodeIds).toContain("node:node:intake")
      expect(Object.values(overlayState.edgeStates)).toContain("delegation_path")
      expect(html).toContain('data-testid="topology-trace-delegation-path"')
      expect(html).toContain('data-testid="topology-trace-tool-call"')
      expect(html).toContain('data-testid="topology-trace-failure-report"')
      expect(html).toContain("Review retry and fallback candidates")
    } finally {
      await app.close()
    }
  })
})
