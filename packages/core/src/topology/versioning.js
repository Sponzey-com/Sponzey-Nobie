import { createHash, randomUUID } from "node:crypto";
import { computeTopologySourceHash } from "./compiler.js";
export function computeTopologyRegistrySourceHash(topology) {
    return computeTopologySourceHash(topology);
}
export function buildTopologyVersionId(topologyId, version) {
    return `topology-version:${topologyId}:${version}`;
}
export function buildTopologyValidationSnapshotId(topologyId, version, sourceHash) {
    return `topology-validation:${hashText(`${topologyId}|${version}|${sourceHash}`).slice(0, 16)}`;
}
export function buildTopologyHistoryId(eventType, topologyId, version) {
    return `topology-history:${eventType}:${hashText(`${topologyId}|${version ?? "none"}|${Date.now()}|${randomUUID()}`).slice(0, 18)}`;
}
export function compiledSnapshotMatchesTopologyVersion(input) {
    return input.compiledSnapshot.topologyId === input.topologyId
        && input.compiledSnapshot.sourceTopologyVersion === String(input.version)
        && input.compiledSnapshot.sourceTopologyHash === input.sourceHash;
}
export function describeCompiledSnapshotMismatch(input) {
    const mismatches = [];
    if (input.compiledSnapshot.topologyId !== input.topologyId)
        mismatches.push("compiled_topology_id_mismatch");
    if (input.compiledSnapshot.sourceTopologyVersion !== String(input.version))
        mismatches.push("compiled_source_version_mismatch");
    if (input.compiledSnapshot.sourceTopologyHash !== input.sourceHash)
        mismatches.push("compiled_source_hash_mismatch");
    return mismatches;
}
function hashText(value) {
    return createHash("sha256").update(value).digest("hex");
}
//# sourceMappingURL=versioning.js.map