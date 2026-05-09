import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  registerTopologyRoutes,
  resetTopologyGuiDraftStoreForTest,
} from "../packages/core/src/api/routes/topologies.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
  applyEnterpriseTopologyGuiCommands,
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyGuiDraft,
  enterpriseTopologyGuiOperationScope,
  type EnterpriseTopology,
  type EnterpriseTopologyGuiCommand,
  type EnterpriseTopologyGuiOperation,
} from "../packages/core/src/index.ts"
import {
  buildCreateNodeGuiOperation,
  buildMoveNodeGuiOperation,
  reduceEnterpriseTopologyGuiPendingState,
} from "../packages/webui/src/lib/enterprise-topology-operations.ts"

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

const now = Date.UTC(2026, 3, 29, 9, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function topologyFixture(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function opBase<T extends EnterpriseTopologyGuiOperation["op"]>(
  op: T,
  operationId: string,
  offset = 0,
): {
  schemaVersion: typeof ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION
  operationId: string
  op: T
  at: number
} {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
    operationId,
    op,
    at: now + offset,
  }
}

function useTempState(): void {
  closeDb()
  resetTopologyGuiDraftStoreForTest()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task017-gui-operations-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

afterEach(() => {
  closeDb()
  resetTopologyGuiDraftStoreForTest()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
})

describe("task017 enterprise topology GUI draft operations", () => {
  it("applies create, update, and pending delete node operations without hard delete", () => {
    const draft = createEnterpriseTopologyGuiDraft({ topology: topologyFixture(), now })
    const created = applyEnterpriseTopologyGuiCommands(draft, [
      {
        ...opBase("createNode", "op:create:node:refund", 1),
        nodeId: "node:refund-review",
        name: "Refund Review",
        nodeType: "review_node",
        position: { x: 300, y: 180 },
      },
    ])
    const updated = applyEnterpriseTopologyGuiCommands(created.draft, [
      {
        ...opBase("updateNode", "op:update:node:refund", 2),
        nodeId: "node:refund-review",
        patch: {
          name: "Refund Review Updated",
          tags: ["finance", "review", "finance"],
        },
      },
      {
        ...opBase("deleteNode", "op:delete:node:refund", 3),
        nodeId: "node:refund-review",
      },
    ])

    const node = updated.draft.topology.nodes.find((candidate) => candidate.id === "node:refund-review")
    expect(created.structuralChanged).toBe(true)
    expect(created.layoutChanged).toBe(false)
    expect(created.draft.layout.nodes["node:refund-review"]).toEqual({ x: 300, y: 180 })
    expect(node).toEqual(expect.objectContaining({
      name: "Refund Review Updated",
      status: "archived",
      tags: ["finance", "review"],
    }))
    expect(updated.draft.topology.nodes.some((candidate) => candidate.id === "node:refund-review")).toBe(true)
    expect(updated.draft.pendingDeletes.nodeIds).toEqual(["node:refund-review"])
    expect(updated.draft.structuralRevision).toBe(3)
  })

  it("applies create, update, and pending delete relation operations", () => {
    const draft = createEnterpriseTopologyGuiDraft({ topology: topologyFixture(), now })
    const created = applyEnterpriseTopologyGuiCommands(draft, [
      {
        ...opBase("createRelation", "op:create:relation:triage-tool", 1),
        relationId: "relation:triage-crm-search",
        relationType: "uses_tool",
        from: { entityType: "node", id: "node:triage" },
        to: { entityType: "enterprise_tool", id: "tool:crm-search" },
        label: "uses_tool",
      },
    ])
    const updated = applyEnterpriseTopologyGuiCommands(created.draft, [
      {
        ...opBase("updateRelation", "op:update:relation:triage-tool", 2),
        relationId: "relation:triage-crm-search",
        patch: {
          name: "Triage checks CRM",
          label: "checks",
        },
      },
      {
        ...opBase("deleteRelation", "op:delete:relation:triage-tool", 3),
        relationId: "relation:triage-crm-search",
      },
    ])

    const relation = updated.draft.topology.relations.find((candidate) => candidate.id === "relation:triage-crm-search")
    const triage = updated.draft.topology.nodes.find((candidate) => candidate.id === "node:triage")
    expect(created.draft.topology.nodes.find((candidate) => candidate.id === "node:triage")?.allowedToolIds).toEqual(["tool:crm-search"])
    expect(relation).toEqual(expect.objectContaining({
      name: "Triage checks CRM",
      label: "checks",
      status: "archived",
    }))
    expect(triage?.allowedToolIds).toEqual([])
    expect(updated.draft.pendingDeletes.relationIds).toEqual(["relation:triage-crm-search"])
  })

  it("keeps layout operations separate from topology structure", () => {
    const draft = createEnterpriseTopologyGuiDraft({ topology: topologyFixture(), now })
    const beforeTopology = structuredClone(draft.topology)
    const moved = applyEnterpriseTopologyGuiCommands(draft, [
      {
        ...opBase("moveNode", "op:move:node:intake", 1),
        nodeId: "node:intake",
        position: { x: 640, y: 320 },
        collapsed: true,
      },
    ])

    expect(moved.layoutChanged).toBe(true)
    expect(moved.structuralChanged).toBe(false)
    expect(moved.draft.layout.nodes["node:intake"]).toEqual({ x: 640, y: 320, collapsed: true })
    expect(moved.draft.topology).toEqual(beforeTopology)
    expect(moved.draft.validation).toBe(draft.validation)
    expect(moved.draft.layoutRevision).toBe(1)
    expect(moved.draft.structuralRevision).toBe(0)
    expect(enterpriseTopologyGuiOperationScope(moved.applied[0]!)).toBe("layout")
  })

  it("runs validation for structural operations and reports draft issues", () => {
    const draft = createEnterpriseTopologyGuiDraft({ topology: topologyFixture(), now })
    const invalid = applyEnterpriseTopologyGuiCommands(draft, [
      {
        ...opBase("createRelation", "op:create:invalid:relation", 1),
        relationId: "relation:invalid-node-tool-report",
        relationType: "reports_to",
        from: { entityType: "node", id: "node:intake" },
        to: { entityType: "enterprise_tool", id: "tool:crm-search" },
      },
    ])

    expect(invalid.structuralChanged).toBe(true)
    expect(invalid.draft.structuralRevision).toBe(1)
    expect(invalid.draft.validation.executable).toBe(false)
    expect(invalid.draft.validation.issues.map((issue) => issue.reasonCode)).toContain("invalid_relation_endpoint")
  })

  it("reruns validation when structural operations replace an equal-length operation log", () => {
    const draft = createEnterpriseTopologyGuiDraft({ topology: topologyFixture(), now })
    const invalid = applyEnterpriseTopologyGuiCommands(draft, [
      {
        ...opBase("createRelation", "op:create:invalid:relation", 1),
        relationId: "relation:invalid-node-tool-report",
        relationType: "reports_to",
        from: { entityType: "node", id: "node:intake" },
        to: { entityType: "enterprise_tool", id: "tool:crm-search" },
      },
    ])
    const replaced = applyEnterpriseTopologyGuiCommands(invalid.draft, [
      {
        schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
        operationId: "op:undo:invalid:relation",
        op: "undo",
        at: now + 2,
      },
      {
        ...opBase("createNode", "op:create:replacement:node", 3),
        nodeId: "node:replacement-review",
        name: "Replacement Review",
        nodeType: "review_node",
      },
    ])

    expect(invalid.draft.operationLog).toHaveLength(1)
    expect(replaced.draft.operationLog).toHaveLength(1)
    expect(replaced.draft.structuralRevision).toBe(invalid.draft.structuralRevision)
    expect(replaced.draft.validation.executable).toBe(true)
  })

  it("supports undo and redo for pending operation changes", () => {
    const draft = createEnterpriseTopologyGuiDraft({ topology: topologyFixture(), now })
    const deleted = applyEnterpriseTopologyGuiCommands(draft, [
      {
        ...opBase("deleteNode", "op:delete:node:triage", 1),
        nodeId: "node:triage",
      },
    ])
    const undone = applyEnterpriseTopologyGuiCommands(deleted.draft, [
      {
        schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
        operationId: "op:undo:node:triage",
        op: "undo",
        at: now + 2,
      },
    ])
    const redone = applyEnterpriseTopologyGuiCommands(undone.draft, [
      {
        schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
        operationId: "op:redo:node:triage",
        op: "redo",
        at: now + 3,
      },
    ])

    expect(deleted.draft.pendingDeletes.nodeIds).toEqual(["node:triage"])
    expect(undone.draft.pendingDeletes.nodeIds).toEqual([])
    expect(undone.draft.redoStack.map((operation) => operation.operationId)).toEqual(["op:delete:node:triage"])
    expect(redone.draft.pendingDeletes.nodeIds).toEqual(["node:triage"])
    expect(redone.draft.redoStack).toEqual([])
  })

  it("keeps WebUI pending reducer compatible with the core operation model", () => {
    const createNode = buildCreateNodeGuiOperation({
      nodeId: "node:from-webui",
      name: "From WebUI",
      position: { x: 10, y: 20 },
      operationId: "op:webui:create",
      at: now,
    })
    const moveNode = buildMoveNodeGuiOperation({
      nodeId: "node:from-webui",
      position: { x: 40, y: 80 },
      operationId: "op:webui:move",
      at: now + 1,
    })
    const pending = [createNode, moveNode].reduce(
      (state, command) => reduceEnterpriseTopologyGuiPendingState(state, command),
      { operationLog: [], redoStack: [] },
    )
    const afterUndo = reduceEnterpriseTopologyGuiPendingState(pending, {
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: "op:webui:undo",
      op: "undo",
      at: now + 2,
    })

    expect(createNode.schemaVersion).toBe(ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION)
    expect(pending.operationLog.map((operation) => operation.op)).toEqual(["createNode", "moveNode"])
    expect(afterUndo.operationLog.map((operation) => operation.op)).toEqual(["createNode"])
    expect(afterUndo.redoStack.map((operation) => operation.op)).toEqual(["moveNode"])
  })

  it("exposes GUI draft operation API payload and response flow", async () => {
    useTempState()
    const app = Fastify({ logger: false })
    registerTopologyRoutes(app)
    await app.ready()
    try {
      const topology = topologyFixture()
      const imported = await app.inject({
        method: "POST",
        url: "/api/topologies/import",
        payload: { topology, createdBy: "task017-test" },
      })
      expect(imported.statusCode).toBe(201)

      const emptyDraft = await app.inject({
        method: "GET",
        url: "/api/topologies/workspace%3Adraft/gui-draft",
      })
      expect(emptyDraft.statusCode).toBe(200)
      expect(emptyDraft.json()).toEqual({
        ok: true,
        draft: null,
        reused: false,
        source: "empty",
      })

      const started = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: { reset: true },
      })
      expect(started.statusCode).toBe(201)
      expect(started.json().draft.operationLog).toHaveLength(0)

      const transientTopology = structuredClone(topology)
      transientTopology.nodes[0] = {
        ...transientTopology.nodes[0]!,
        name: "",
      }
      const transientDraft = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: { topology: transientTopology, reset: true },
      })
      expect(transientDraft.statusCode).toBe(201)
      expect(transientDraft.json().draft.validation.ok).toBe(false)
      expect(transientDraft.json().draft.validation.issues.map((issue: { reasonCode: string }) => issue.reasonCode)).toContain("missing_required_field")

      const invalidSave = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: { topology: transientTopology, reset: true, persist: true },
      })
      expect(invalidSave.statusCode).toBe(201)
      expect(invalidSave.json()).toEqual(expect.objectContaining({
        ok: true,
        persisted: false,
        persistError: "invalid_enterprise_topology",
      }))
      expect(invalidSave.json().persistIssues.map((issue: { reasonCode: string }) => issue.reasonCode)).toContain("missing_required_field")

      const restarted = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: { topology, reset: true },
      })
      expect(restarted.statusCode).toBe(201)

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft/operations`,
        payload: {
          operations: [
            {
              ...opBase("createNode", "op:api:create-node", 1),
              nodeId: "node:api-created",
              name: "API Created Node",
              position: { x: 220, y: 180 },
            },
          ] satisfies EnterpriseTopologyGuiCommand[],
        },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json()).toEqual(expect.objectContaining({
        ok: true,
        structuralChanged: true,
        layoutChanged: false,
      }))
      expect(patched.json().draft.topology.nodes.map((node: { id: string }) => node.id)).toContain("node:api-created")

      const issues = await app.inject({
        method: "GET",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft/issues`,
      })
      expect(issues.statusCode).toBe(200)
      expect(issues.json()).toEqual(expect.objectContaining({
        ok: true,
        topologyId: topology.id,
      }))
      expect(Array.isArray(issues.json().issues)).toBe(true)

      const saved = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
        payload: {
          topology: patched.json().draft.topology,
          reset: true,
          persist: true,
          createdBy: "task017-test",
          importSource: "task017-gui-save",
        },
      })
      expect(saved.statusCode).toBe(201)
      expect(saved.json().persisted).toBe(true)
      expect(saved.json().persistedVersion).toEqual(expect.objectContaining({
        topologyId: topology.id,
        version: 2,
        importSource: "task017-gui-save",
      }))

      const activatedFirstVersion = await app.inject({
        method: "POST",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/versions/1/activate`,
      })
      expect(activatedFirstVersion.statusCode).toBe(200)

      resetTopologyGuiDraftStoreForTest()
      const restored = await app.inject({
        method: "GET",
        url: `/api/topologies/${encodeURIComponent(topology.id)}/gui-draft`,
      })
      expect(restored.statusCode).toBe(200)
      expect(restored.json()).toEqual(expect.objectContaining({
        ok: true,
        reused: false,
        source: "registry",
        version: 2,
      }))
      expect(restored.json().draft.topology.nodes.map((node: { id: string }) => node.id)).toContain("node:api-created")

      const clientSource = readFileSync(new URL("../packages/webui/src/api/client.ts", import.meta.url), "utf-8")
      expect(clientSource).toContain("enterpriseTopologyGuiDraft:")
      expect(clientSource).toContain("/gui-draft")
      expect(clientSource).toContain("/gui-draft/operations")
      expect(clientSource).toContain("/gui-draft/issues")
    } finally {
      await app.close()
    }
  })
})
