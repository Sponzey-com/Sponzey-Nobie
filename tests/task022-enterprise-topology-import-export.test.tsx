import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { registerTopologyRoutes, resetTopologyGuiDraftStoreForTest } from "../packages/core/src/api/routes/topologies.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  buildAgentTeamTopologyImportPreview,
  buildExampleEnterpriseTopology,
  stringifyTopologyDocument,
  type EnterpriseTopology,
} from "../packages/core/src/index.ts"
import { topologyIssueTargetId } from "../packages/webui/src/components/topology/TopologyValidationAssistant.tsx"

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

const now = Date.UTC(2026, 3, 30, 12, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function topologyFixture(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function topologyWithDeclaredToolIssue(): EnterpriseTopology {
  const topology = topologyFixture()
  const toolId = topology.nodes[0]!.allowedToolIds[0]
  topology.relations = topology.relations.filter((relation) => {
    return !(relation.from.id === topology.nodes[0]!.id && relation.to.id === toolId)
  })
  return topology
}

function useTempState(): void {
  closeDb()
  resetTopologyGuiDraftStoreForTest()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task022-topology-import-export-"))
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

describe("task022 enterprise topology import/export and migration assistant", () => {
  it("keeps JSON/YAML topology import-export out of the WebUI advanced panel surface", () => {
    const topology = topologyFixture()
    const json = stringifyTopologyDocument(topology, "json")
    const yaml = stringifyTopologyDocument(topology, "yaml")
    const pageSource = readFileSync(
      new URL("../packages/webui/src/pages/EnterpriseTopologyPage.tsx", import.meta.url),
      "utf-8",
    )
    const removedPanelPath = new URL(
      "../packages/webui/src/components/topology/TopologyAdvancedImportExportPanel.tsx",
      import.meta.url,
    )

    expect(JSON.parse(json).id).toBe(topology.id)
    expect(yaml).toContain("schemaVersion: 1")
    expect(existsSync(removedPanelPath)).toBe(false)
    expect(pageSource).not.toContain("TopologyAdvancedImportExportPanel")
    expect(pageSource).not.toContain("buildTopologyDraftExportText")
    expect(pageSource).not.toContain("JSON/YAML")
  })

  it("adds API/client methods for JSON/YAML export and dry-run import issue mapping", async () => {
    useTempState()
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const topology = topologyWithDeclaredToolIssue()
      const imported = await app.inject({
        method: "POST",
        url: "/api/topologies/import",
        payload: { topology, importSource: "task022-test" },
        remoteAddress: "127.0.0.1",
      })
      const exported = await app.inject({
        method: "GET",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/export?format=yaml`,
        remoteAddress: "127.0.0.1",
      })
      const dryRun = await app.inject({
        method: "POST",
        url: "/api/topologies/import",
        payload: {
          content: JSON.stringify(topology),
          format: "json",
          dryRun: true,
          sourceRef: "declared-tool-issue.json",
        },
        remoteAddress: "127.0.0.1",
      })
      const dryRunBody = dryRun.json()
      const clientSource = readFileSync(
        new URL("../packages/webui/src/api/client.ts", import.meta.url),
        "utf-8",
      )

      expect(imported.statusCode).toBe(201)
      expect(exported.statusCode).toBe(200)
      expect(exported.json()).toEqual(expect.objectContaining({
        ok: true,
        format: "yaml",
        filename: expect.stringMatching(/\.yaml$/),
      }))
      expect(exported.json().content).toContain("nodes:")
      expect(dryRun.statusCode).toBe(200)
      expect(dryRunBody.dryRun).toBe(true)
      expect(dryRunBody.issues.map((issue: { reasonCode: string }) => issue.reasonCode)).toContain(
        "declared_tool_relation_missing",
      )
      const declaredIssue = dryRunBody.issues.find((issue: { reasonCode: string }) => {
        return issue.reasonCode === "declared_tool_relation_missing"
      })
      expect(topologyIssueTargetId(declaredIssue)).toBe(`node:${topology.nodes[0]!.id}`)
      expect(dryRunBody.issues.map(topologyIssueTargetId)).toContain(`node:${topology.nodes[0]!.id}`)
      expect(clientSource).toContain("exportEnterpriseTopology")
      expect(clientSource).toContain("/api/topologies/import")
      expect(clientSource).toContain("/api/topologies/import/agent-team-preview")
    } finally {
      await app.close()
    }
  })

  it("previews AgentConfig, TeamConfig, and parent_child conversion without auto OrgUnit conversion", () => {
    const preview = buildAgentTeamTopologyImportPreview({
      topologyId: "topology:agent-team-preview",
      name: "Agent Team Preview",
      now,
      teamImportMode: "team",
      agents: [
        {
          agentId: "agent:intake",
          displayName: "Intake Agent",
          role: "Receive customer requests",
          personality: "Concise and procedural",
          specialtyTags: ["customer-success"],
          capabilityPolicy: {
            skillMcpAllowlist: {
              enabledToolNames: ["crm.search"],
              enabledMcpServerIds: ["crm"],
            },
            permissionProfile: {
              allowExternalNetwork: true,
            },
          },
          profileVersion: 3,
          createdAt: now,
          updatedAt: now,
        },
        {
          agentId: "agent:research",
          displayName: "Research Agent",
          role: "Collect case evidence",
          specialtyTags: ["research"],
          createdAt: now,
          updatedAt: now,
        },
      ],
      teams: [{
        teamId: "team:customer-success",
        displayName: "Customer Success Team",
        purpose: "Handle customer requests",
        memberAgentIds: ["agent:intake", "agent:research"],
        roleHints: ["support"],
        createdAt: now,
        updatedAt: now,
      }],
      relationships: [{
        edgeId: "edge:intake-research",
        parentAgentId: "agent:intake",
        childAgentId: "agent:research",
        relationshipType: "parent_child",
        createdAt: now,
        updatedAt: now,
      }],
    })
    expect(preview.transformations.map((item) => item.summary)).toEqual(expect.arrayContaining([
      "AgentConfig -> NodeContract",
      "TeamConfig -> Team",
      "parent_child -> delegates_to",
    ]))
    expect(preview.topology.nodes[0]!.metadata).toEqual(expect.objectContaining({
      imported_from_agent_config: "agent:intake",
      importedFromAgentConfigId: "agent:intake",
      source_role: "migration_source_only",
    }))
    expect(preview.topology.relations[0]).toEqual(expect.objectContaining({
      relationType: "delegates_to",
      metadata: expect.objectContaining({ source_relationship_type: "parent_child" }),
    }))
    expect(preview.topology.teams).toHaveLength(1)
    expect(preview.topology.orgUnits).toHaveLength(0)
    expect(preview.metadata).toEqual(expect.objectContaining({
      sourceOfTruth: "enterprise_topology_draft",
      legacySourceRole: "migration_source_only",
      teamRequiresExplicitChoice: true,
    }))
    expect(preview.validation.issues.map((issue) => issue.reasonCode)).toEqual(expect.arrayContaining([
      "declared_tool_relation_missing",
      "declared_system_relation_missing",
      "responsibility_matrix_missing",
      "failure_policy_missing",
      "recovery_policy_missing",
    ]))
  })

  it("supports explicit TeamConfig skip mode in the legacy import wizard", async () => {
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/topologies/import/agent-team-preview",
        payload: {
          teamImportMode: "skip",
          agents: [{
            agentId: "agent:solo",
            displayName: "Solo Agent",
            createdAt: now,
            updatedAt: now,
          }],
          teams: [{
            teamId: "team:legacy",
            displayName: "Legacy Team",
            memberAgentIds: ["agent:solo"],
            createdAt: now,
            updatedAt: now,
          }],
          relationships: [],
        },
        remoteAddress: "127.0.0.1",
      })
      const body = response.json()

      expect(response.statusCode).toBe(200)
      expect(body.metadata.teamImportMode).toBe("skip")
      expect(body.metadata.teamRequiresExplicitChoice).toBe(true)
      expect(body.topology.teams).toEqual([])
      expect(body.topology.orgUnits).toEqual([])
      expect(body.transformations.map((item: { summary: string }) => item.summary)).not.toContain("TeamConfig -> Team")
    } finally {
      await app.close()
    }
  })
})
