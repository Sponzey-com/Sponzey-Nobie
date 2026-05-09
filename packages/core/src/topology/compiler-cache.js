import { compileTopology, computeTopologySourceHash, normalizeSourceTopologyVersion, TOPOLOGY_COMPILER_VERSION, } from "./compiler.js";
export function buildCompiledTopologyCacheKey(topology, options = {}) {
    const sourceTopologyVersion = normalizeSourceTopologyVersion(topology, options.sourceTopologyVersion);
    const sourceTopologyHash = computeTopologySourceHash(topology);
    return [
        TOPOLOGY_COMPILER_VERSION,
        topology.id,
        sourceTopologyVersion,
        sourceTopologyHash,
    ].join("|");
}
export function createInMemoryTopologyCompilerCache(initialEntries = []) {
    const entries = new Map(initialEntries.map((entry) => [entry.cacheKey, entry]));
    return {
        compileOrGet(topology, options = {}) {
            const cacheKey = buildCompiledTopologyCacheKey(topology, options);
            const cached = entries.get(cacheKey);
            if (cached !== undefined) {
                return {
                    ok: true,
                    fromCache: true,
                    entry: cached,
                    snapshot: cached.snapshot,
                };
            }
            const compiled = compileTopology(topology, options);
            if (!compiled.ok)
                return { ...compiled, fromCache: false };
            const entry = {
                cacheKey,
                topologyId: topology.id,
                sourceTopologyVersion: compiled.snapshot.sourceTopologyVersion,
                sourceTopologyHash: compiled.snapshot.sourceTopologyHash,
                compilerVersion: compiled.snapshot.compilerVersion,
                snapshot: compiled.snapshot,
                cachedAt: options.compiledAt ?? Date.now(),
            };
            entries.set(cacheKey, entry);
            return {
                ok: true,
                fromCache: false,
                entry,
                snapshot: compiled.snapshot,
            };
        },
        get(cacheKey) {
            return entries.get(cacheKey);
        },
        list() {
            return [...entries.values()];
        },
        delete(cacheKey) {
            return entries.delete(cacheKey);
        },
        clear() {
            entries.clear();
        },
    };
}
//# sourceMappingURL=compiler-cache.js.map