import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { createElement } from "../packages/webui/node_modules/react/index.js"
import { renderToStaticMarkup } from "../packages/webui/node_modules/react-dom/server.js"
import { afterEach, describe, expect, it } from "vitest"
import {
  registerTopologyRoutes,
  resetTopologyGuiDraftStoreForTest,
} from "../packages/core/src/api/routes/topologies.ts"
import {
  buildExampleEnterpriseTopology,
  type EnterpriseTopology,
} from "../packages/core/src/index.ts"
import {
  TopologyCompilePreview,
  compiledDelegationNodeIds,
} from "../packages/webui/src/components/topology/TopologyCompilePreview.tsx"
import {
  TopologyValidationAssistant,
  buildTopologyQuickFixOperations,
  groupTopologyIssuesBySeverity,
  topologyIssueTargetId,
} from "../packages/webui/src/components/topology/TopologyValidationAssistant.tsx"
import type { EnterpriseTopologyValidationIssue } from "../packages/webui/src/contracts/enterprise-topology.ts"

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
  }): Promise<{ statusCode: number; json(): any }>
}

const now = Date.UTC(2026, 3, 30, 10, 0, 0)

function topologyFixture(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function topologyWithMissingToolPermission(): EnterpriseTopology {
  const topology = topologyFixture()
  topology.nodes[0]!.allowedToolIds = []
  return topology
}

function topologyWithReportsToRelation(): EnterpriseTopology {
  const topology = topologyFixture()
  topology.positions.push({
    schemaVersion: topology.schemaVersion,
    entityType: "position",
    id: "position:cs-agent",
    name: "Customer Success Agent",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    orgUnitId: "org:customer-success",
    personIds: [],
    responsibilityIds: [],
  })
  topology.orgUnits[0]!.positionIds.push("position:cs-agent")
  topology.relations.push({
    schemaVersion: topology.schemaVersion,
    entityType: "relation",
    id: "relation:lead-reports-agent",
    name: "Lead reports agent",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType: "reports_to",
    from: { entityType: "position", id: "position:cs-lead" },
    to: { entityType: "position", id: "position:cs-agent" },
  })
  return topology
}

function issue(input: Partial<EnterpriseTopologyValidationIssue>): EnterpriseTopologyValidationIssue {
  return {
    path: input.path ?? "$.nodes[0]",
    code: input.code ?? input.reasonCode ?? "tool_permission_missing",
    reasonCode: input.reasonCode ?? input.code ?? "tool_permission_missing",
    severity: input.severity ?? "blocked",
    message: input.message ?? "Node is missing tool permission.",
    ...input,
  }
}

afterEach(() => {
  resetTopologyGuiDraftStoreForTest()
})

describe("task020 enterprise topology validation and compile UI", () => {
  it("groups and renders validation issues by severity", () => {
    const issues = [
      issue({ severity: "blocked", reasonCode: "tool_permission_missing" }),
      issue({ severity: "warning", reasonCode: "responsibility_matrix_missing", message: "Responsibility is missing." }),
    ]
    const grouped = groupTopologyIssuesBySeverity(issues)
    const html = renderToStaticMarkup(
      createElement(TopologyValidationAssistant, { issues }),
    )

    expect(grouped.blocked).toHaveLength(1)
    expect(grouped.warning).toHaveLength(1)
    expect(html).toContain('data-testid="enterprise-topology-validation-assistant"')
    expect(html).toContain('data-testid="topology-validation-issue-tool_permission_missing"')
    expect(html).toContain('data-testid="topology-validation-issue-responsibility_matrix_missing"')
  })

  it("loads GUI draft issues through the API and displays them in the assistant", async () => {
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const topology = topologyWithMissingToolPermission()
      await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: { topology, reset: true },
      })
      const response = await app.inject({
        method: "GET",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft/issues`,
      })
      const body = response.json()
      const html = renderToStaticMarkup(
        createElement(TopologyValidationAssistant, { issues: body.issues, topology }),
      )

      expect(response.statusCode).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.issues.map((item: { reasonCode: string }) => item.reasonCode)).toContain("tool_permission_missing")
      expect(html).toContain('data-testid="topology-validation-issue-tool_permission_missing"')
      expect(html).not.toContain('data-testid="topology-validation-quickfix-tool_permission_missing"')
    } finally {
      await app.close()
    }
  })

  it("maps issue clicks to canvas targets and keeps viewport movement wired in the canvas", () => {
    const relationIssue = issue({
      relationId: "relation:intake-crm-search",
      entityId: "node:intake",
      entityType: "node",
    })
    const entityIssue = issue({
      relationId: undefined,
      entityId: "node:intake",
      entityType: "node",
    })
    const canvasSource = readFileSync(
      new URL("../packages/webui/src/components/topology/EnterpriseTopologyCanvas.tsx", import.meta.url),
      "utf-8",
    )

    expect(topologyIssueTargetId(relationIssue)).toBe("relation:intake-crm-search")
    expect(topologyIssueTargetId(entityIssue)).toBe("node:node:intake")
    expect(canvasSource).toContain("handleSelectTarget")
    expect(canvasSource).toContain("setCenter")
  })

  it("generates quick fix operations for delegation target, approver, and team/org while excluding permissions", () => {
    const topology = topologyWithMissingToolPermission()
    const permissionFix = buildTopologyQuickFixOperations(issue({
      reasonCode: "tool_permission_missing",
      entityId: "node:intake",
      entityType: "node",
      relationId: "relation:intake-crm-search",
      refId: "tool:crm-search",
      refType: "enterprise_tool",
    }), topology)
    const approverFix = buildTopologyQuickFixOperations(issue({
      reasonCode: "approval_authority_missing",
      entityId: "node:intake",
      entityType: "node",
      relationId: "relation:intake-crm-search",
    }), topology)
    const teamOrgFix = buildTopologyQuickFixOperations(issue({
      reasonCode: "invalid_relation_endpoint",
      relationId: "relation:bad-team-org",
      entityId: "relation:bad-team-org",
      entityType: "relation",
    }), topology)
    const delegationTargetFix = buildTopologyQuickFixOperations(issue({
      reasonCode: "empty_process_steps",
      entityId: "process:refund",
      entityType: "process_definition",
    }), topology)

    expect(permissionFix).toEqual([])
    expect(approverFix[0]).toEqual(expect.objectContaining({
      op: "createRelation",
      relationType: "approves",
      from: { entityType: "position", id: "position:cs-lead" },
    }))
    expect(teamOrgFix[0]).toEqual(expect.objectContaining({
      op: "updateRelation",
      patch: expect.objectContaining({ relationType: "belongs_to" }),
    }))
    expect(delegationTargetFix[0]).toEqual(expect.objectContaining({
      op: "createNode",
      nodeType: "process_step",
    }))
  })

  it("shows compile failure as GUI issues before source payloads", async () => {
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const topology = topologyWithMissingToolPermission()
      await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: { topology, reset: true },
      })
      const response = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft/compile`,
      })
      const body = response.json()
      const html = renderToStaticMarkup(
        createElement(TopologyCompilePreview, { preview: body }),
      )

      expect(response.statusCode).toBe(200)
      expect(body.ok).toBe(false)
      expect(body.issues.map((item: { reasonCode: string }) => item.reasonCode)).toContain("tool_permission_missing")
      expect(html).toContain('data-testid="enterprise-topology-compile-blocked"')
      expect(html).toContain("Node uses or accesses a tool")
      expect(html).not.toMatch(/schemaVersion|relations|YAML|JSON/i)
    } finally {
      await app.close()
    }
  })

  it("loads compiled-preview API data and renders only the delegation tree", async () => {
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const topology = topologyWithReportsToRelation()
      await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: { topology, reset: true },
      })
      const response = await app.inject({
        method: "GET",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft/compiled-preview`,
      })
      const body = response.json()
      const html = renderToStaticMarkup(
        createElement(TopologyCompilePreview, { preview: body }),
      )
      const nodeIds = compiledDelegationNodeIds(body)
      const clientSource = readFileSync(new URL("../packages/webui/src/api/client.ts", import.meta.url), "utf-8")

      expect(response.statusCode).toBe(200)
      expect(body.ok).toBe(true)
      expect(nodeIds).toEqual(["node:intake", "node:triage"])
      expect(html).toContain('data-testid="enterprise-topology-compile-preview"')
      expect(html).toContain('data-testid="compiled-delegation-edge"')
      expect(html).toContain("WorkOrder Preview")
      expect(html).toContain("Runtime profile snapshot")
      expect(html).not.toContain("reports_to")
      expect(clientSource).toContain("validateEnterpriseTopologyGuiDraft")
      expect(clientSource).toContain("compileEnterpriseTopologyGuiDraft")
      expect(clientSource).toContain("enterpriseTopologyGuiDraftCompiledPreview")
    } finally {
      await app.close()
    }
  })
})
