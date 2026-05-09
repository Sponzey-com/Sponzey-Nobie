import { existsSync, readdirSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"
import JSON5 from "json5"
import {
  type EnterpriseTopology,
  type EnterpriseTopologyValidationCode,
  type EnterpriseTopologyValidationIssue,
  validateEnterpriseTopology,
} from "../contracts/enterprise-topology.js"
import {
  type TopologyDocumentEnvelope,
  createTopologyDocumentEnvelope,
} from "./draft-store.js"

export type TopologyFixtureFormat = "json" | "json5" | "yaml"

export type TopologyFixtureIssueCode =
  | EnterpriseTopologyValidationCode
  | "topology_fixture_parse_failed"
  | "unsupported_topology_fixture_format"
  | "topology_fixture_file_not_found"

export interface TopologyFixtureIssue extends Omit<EnterpriseTopologyValidationIssue, "code" | "reasonCode"> {
  code: TopologyFixtureIssueCode
  reasonCode: TopologyFixtureIssueCode
}

export type TopologyFixtureParseResult =
  | { ok: true; topology: EnterpriseTopology; issues: []; format: TopologyFixtureFormat }
  | { ok: false; issues: TopologyFixtureIssue[]; format?: TopologyFixtureFormat }

export interface TopologyFixtureRecord {
  fixtureId: string
  sourceRef: string
  envelope: TopologyDocumentEnvelope
}

export interface TopologyFixtureStore {
  list(): TopologyFixtureRecord[]
  get(fixtureId: string): TopologyFixtureRecord | undefined
  require(fixtureId: string): TopologyFixtureRecord
}

export type TopologyFixtureDirectoryLoadResult =
  | { ok: true; store: TopologyFixtureStore; issues: [] }
  | { ok: false; issues: TopologyFixtureIssue[] }

function fixtureIssue(
  path: string,
  code: TopologyFixtureIssueCode,
  message: string,
): TopologyFixtureIssue {
  return { path, code, reasonCode: code, message }
}

export function inferTopologyFixtureFormat(sourceRef: string): TopologyFixtureFormat | undefined {
  const ext = extname(sourceRef).toLowerCase()
  if (ext === ".json") return "json"
  if (ext === ".json5") return "json5"
  if (ext === ".yaml" || ext === ".yml") return "yaml"
  return undefined
}

export function parseTopologyDocumentText(
  text: string,
  options: { sourceRef?: string; format?: TopologyFixtureFormat } = {},
): TopologyFixtureParseResult {
  const format = options.format ?? inferTopologyFixtureFormat(options.sourceRef ?? "topology.json") ?? "json"
  let parsed: unknown
  try {
    if (format === "yaml") {
      return {
        ok: false,
        format,
        issues: [
          fixtureIssue(
            "$",
            "unsupported_topology_fixture_format",
            "YAML topology fixtures are reserved for import helpers and require a parser before runtime use.",
          ),
        ],
      }
    }
    parsed = format === "json5" ? JSON5.parse(text) : JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      format,
      issues: [
        fixtureIssue(
          "$",
          "topology_fixture_parse_failed",
          error instanceof Error ? error.message : "Failed to parse topology fixture.",
        ),
      ],
    }
  }

  const validation = validateEnterpriseTopology(parsed)
  if (!validation.ok) return { ok: false, format, issues: validation.issues }
  return { ok: true, topology: validation.value, issues: [], format }
}

export function loadTopologyFixtureFile(filePath: string): TopologyFixtureParseResult {
  if (!existsSync(filePath)) {
    return {
      ok: false,
      issues: [fixtureIssue("$", "topology_fixture_file_not_found", `Topology fixture not found: ${filePath}`)],
    }
  }
  return parseTopologyDocumentText(readFileSync(filePath, "utf-8"), {
    sourceRef: filePath,
  })
}

export function createTopologyFixtureStore(records: TopologyFixtureRecord[]): TopologyFixtureStore {
  const fixtures = new Map<string, TopologyFixtureRecord>()
  for (const record of records) {
    fixtures.set(record.fixtureId, structuredClone(record))
  }
  return {
    list() {
      return [...fixtures.values()].map((record) => structuredClone(record))
    },
    get(fixtureId) {
      const record = fixtures.get(fixtureId)
      return record ? structuredClone(record) : undefined
    },
    require(fixtureId) {
      const record = fixtures.get(fixtureId)
      if (!record) throw new Error(`Missing topology fixture: ${fixtureId}`)
      return structuredClone(record)
    },
  }
}

export function loadTopologyFixtureDirectory(directoryPath: string): TopologyFixtureDirectoryLoadResult {
  if (!existsSync(directoryPath)) {
    return {
      ok: false,
      issues: [fixtureIssue("$", "topology_fixture_file_not_found", `Topology fixture directory not found: ${directoryPath}`)],
    }
  }
  const records: TopologyFixtureRecord[] = []
  for (const name of readdirSync(directoryPath).sort()) {
    const format = inferTopologyFixtureFormat(name)
    if (!format) continue
    const sourceRef = join(directoryPath, name)
    const parsed = loadTopologyFixtureFile(sourceRef)
    if (!parsed.ok) return { ok: false, issues: parsed.issues }
    const envelope = createTopologyDocumentEnvelope({
      document: parsed.topology,
      source: "fixture",
      sourceRef,
      draftId: `fixture:${parsed.topology.id}`,
      envelopeId: `fixture-envelope:${parsed.topology.id}`,
      now: parsed.topology.updatedAt,
    })
    if (!envelope.ok) return { ok: false, issues: envelope.issues }
    records.push({
      fixtureId: parsed.topology.id,
      sourceRef,
      envelope: envelope.envelope,
    })
  }
  return { ok: true, store: createTopologyFixtureStore(records), issues: [] }
}
