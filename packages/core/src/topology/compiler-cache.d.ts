import type { EnterpriseTimestamp, EnterpriseTopology } from "../contracts/enterprise-topology.js";
import { TOPOLOGY_COMPILER_VERSION, type CompileTopologyOptions, type CompileTopologyResult, type CompiledTopologySnapshot } from "./compiler.js";
export interface CompiledTopologyCacheEntry {
    cacheKey: string;
    topologyId: string;
    sourceTopologyVersion: string;
    sourceTopologyHash: string;
    compilerVersion: typeof TOPOLOGY_COMPILER_VERSION;
    snapshot: CompiledTopologySnapshot;
    cachedAt: EnterpriseTimestamp;
}
export type CachedCompileTopologyResult = {
    ok: true;
    fromCache: boolean;
    entry: CompiledTopologyCacheEntry;
    snapshot: CompiledTopologySnapshot;
} | Extract<CompileTopologyResult, {
    ok: false;
}> & {
    fromCache: false;
};
export interface TopologyCompilerCache {
    compileOrGet(topology: EnterpriseTopology, options?: CompileTopologyOptions): CachedCompileTopologyResult;
    get(cacheKey: string): CompiledTopologyCacheEntry | undefined;
    list(): CompiledTopologyCacheEntry[];
    delete(cacheKey: string): boolean;
    clear(): void;
}
export declare function buildCompiledTopologyCacheKey(topology: EnterpriseTopology, options?: Pick<CompileTopologyOptions, "sourceTopologyVersion">): string;
export declare function createInMemoryTopologyCompilerCache(initialEntries?: CompiledTopologyCacheEntry[]): TopologyCompilerCache;
//# sourceMappingURL=compiler-cache.d.ts.map