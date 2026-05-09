import { createHash, randomUUID } from "node:crypto"
import type { EnterpriseTopology } from "../contracts/enterprise-topology.js"
import type { CompiledTopologySnapshot } from "./compiler.js"
import { computeTopologySourceHash } from "./compiler.js"

export type TopologyRegistryHistoryEventType =
  | "imported"
  | "version_appended"
  | "activated"
  | "archived"
  | "rolled_back"
  | "activation_blocked"
  | "rollback_blocked"

export function computeTopologyRegistrySourceHash(topology: EnterpriseTopology): string {
  return computeTopologySourceHash(topology)
}

export function buildTopologyVersionId(topologyId: string, version: number): string {
  return `topology-version:${topologyId}:${version}`
}

export function buildTopologyValidationSnapshotId(topologyId: string, version: number, sourceHash: string): string {
  return `topology-validation:${hashText(`${topologyId}|${version}|${sourceHash}`).slice(0, 16)}`
}

export function buildTopologyHistoryId(
  eventType: TopologyRegistryHistoryEventType,
  topologyId: string,
  version: number | null,
): string {
  return `topology-history:${eventType}:${hashText(`${topologyId}|${version ?? "none"}|${Date.now()}|${randomUUID()}`).slice(0, 18)}`
}

export function compiledSnapshotMatchesTopologyVersion(input: {
  compiledSnapshot: CompiledTopologySnapshot
  topologyId: string
  version: number
  sourceHash: string
}): boolean {
  return input.compiledSnapshot.topologyId === input.topologyId
    && input.compiledSnapshot.sourceTopologyVersion === String(input.version)
    && input.compiledSnapshot.sourceTopologyHash === input.sourceHash
}

export function describeCompiledSnapshotMismatch(input: {
  compiledSnapshot: CompiledTopologySnapshot
  topologyId: string
  version: number
  sourceHash: string
}): string[] {
  const mismatches: string[] = []
  if (input.compiledSnapshot.topologyId !== input.topologyId) mismatches.push("compiled_topology_id_mismatch")
  if (input.compiledSnapshot.sourceTopologyVersion !== String(input.version)) mismatches.push("compiled_source_version_mismatch")
  if (input.compiledSnapshot.sourceTopologyHash !== input.sourceHash) mismatches.push("compiled_source_hash_mismatch")
  return mismatches
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
