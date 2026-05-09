import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildExampleEnterpriseTopology,
  createInMemoryTopologyDraftStore,
  createTopologyDocumentEnvelope,
  createTopologyFixtureStore,
  loadTopologyFixtureDirectory,
  loadTopologyFixtureFile,
  parseTopologyDocumentText,
  type EnterpriseTopology,
} from "../packages/core/src/index.ts"

const fixtureDir = join(process.cwd(), "tests/fixtures/enterprise-topology")
const validFixturePath = join(fixtureDir, "customer-success-valid.json")
const invalidSchemaFixturePath = join(fixtureDir, "invalid-schema-version.json")
const invalidTeamFixturePath = join(fixtureDir, "invalid-team-execution.json")

describe("task003 topology draft store and fixtures", () => {
  it("loads and parses a valid reusable topology fixture", () => {
    const parsed = loadTopologyFixtureFile(validFixturePath)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("expected valid fixture")
    expect(parsed.topology.id).toBe("topology:customer-success")

    const envelope = createTopologyDocumentEnvelope({
      document: parsed.topology,
      source: "fixture",
      sourceRef: validFixturePath,
      now: parsed.topology.updatedAt,
    })
    expect(envelope.ok).toBe(true)
    if (!envelope.ok) throw new Error("expected fixture envelope")

    const fixtureStore = createTopologyFixtureStore([
      {
        fixtureId: parsed.topology.id,
        sourceRef: validFixturePath,
        envelope: envelope.envelope,
      },
    ])
    expect(fixtureStore.require("topology:customer-success").envelope.lifecycle).toBe("draft")
    expect(fixtureStore.list()).toHaveLength(1)
  })

  it("keeps invalid fixtures out of the draft store runtime path", () => {
    const parsed = loadTopologyFixtureFile(invalidTeamFixturePath)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error("expected invalid fixture")
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "team_execution_semantics_forbidden",
        }),
      ]),
    )

    const raw = JSON.parse(readFileSync(invalidTeamFixturePath, "utf-8")) as EnterpriseTopology
    const draftStore = createInMemoryTopologyDraftStore()
    const saved = draftStore.saveDraft({
      document: raw,
      source: "fixture",
      sourceRef: invalidTeamFixturePath,
    })

    expect(saved.ok).toBe(false)
    expect(draftStore.listDrafts()).toEqual([])
  })

  it("reports schema version mismatch with a stable reason code", () => {
    const parsed = loadTopologyFixtureFile(invalidSchemaFixturePath)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.schemaVersion",
            reasonCode: "unsupported_enterprise_topology_schema_version",
          }),
        ]),
      )
    }
  })

  it("runs without durable registry, activation, rollback, or DB migration semantics", () => {
    const store = createInMemoryTopologyDraftStore()
    const saved = store.saveDraft({
      document: buildExampleEnterpriseTopology(),
      now: 1777392000000,
    })

    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error("expected saved draft")
    expect(saved.envelope.lifecycle).toBe("draft")
    expect(saved.envelope.source).toBe("memory")
    expect("activeVersionId" in saved.envelope).toBe(false)
    expect("rollback" in store).toBe(false)
    expect("activate" in store).toBe(false)
    expect(store.getDraft(saved.envelope.draftId)?.topologyId).toBe("topology:customer-success")
  })

  it("loads a directory of valid fixtures as a shared harness", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "nobie-topology-fixtures-"))
    try {
      writeFileSync(join(tempDir, "customer-success-valid.json"), readFileSync(validFixturePath, "utf-8"), "utf-8")

      const loaded = loadTopologyFixtureDirectory(tempDir)

      expect(loaded.ok).toBe(true)
      if (!loaded.ok) throw new Error("expected fixture directory load")
      expect(loaded.store.require("topology:customer-success").fixtureId).toBe("topology:customer-success")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps YAML as an import-helper boundary until a parser is explicitly added", () => {
    const parsed = parseTopologyDocumentText("schemaVersion: 1\nentityType: topology\n", {
      sourceRef: "topology.yaml",
    })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "unsupported_topology_fixture_format",
          }),
        ]),
      )
    }
  })
})
