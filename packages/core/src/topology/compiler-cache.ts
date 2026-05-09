import type { EnterpriseTimestamp, EnterpriseTopology } from "../contracts/enterprise-topology.js"
import {
  compileTopology,
  computeTopologySourceHash,
  normalizeSourceTopologyVersion,
  TOPOLOGY_COMPILER_VERSION,
  type CompileTopologyOptions,
  type CompileTopologyResult,
  type CompiledTopologySnapshot,
} from "./compiler.js"

export interface CompiledTopologyCacheEntry {
  cacheKey: string
  topologyId: string
  sourceTopologyVersion: string
  sourceTopologyHash: string
  compilerVersion: typeof TOPOLOGY_COMPILER_VERSION
  snapshot: CompiledTopologySnapshot
  cachedAt: EnterpriseTimestamp
}

export type CachedCompileTopologyResult =
  | { ok: true; fromCache: boolean; entry: CompiledTopologyCacheEntry; snapshot: CompiledTopologySnapshot }
  | Extract<CompileTopologyResult, { ok: false }> & { fromCache: false }

export interface TopologyCompilerCache {
  compileOrGet(topology: EnterpriseTopology, options?: CompileTopologyOptions): CachedCompileTopologyResult
  get(cacheKey: string): CompiledTopologyCacheEntry | undefined
  list(): CompiledTopologyCacheEntry[]
  delete(cacheKey: string): boolean
  clear(): void
}

export function buildCompiledTopologyCacheKey(
  topology: EnterpriseTopology,
  options: Pick<CompileTopologyOptions, "sourceTopologyVersion"> = {},
): string {
  const sourceTopologyVersion = normalizeSourceTopologyVersion(topology, options.sourceTopologyVersion)
  const sourceTopologyHash = computeTopologySourceHash(topology)
  return [
    TOPOLOGY_COMPILER_VERSION,
    topology.id,
    sourceTopologyVersion,
    sourceTopologyHash,
  ].join("|")
}

export function createInMemoryTopologyCompilerCache(initialEntries: CompiledTopologyCacheEntry[] = []): TopologyCompilerCache {
  const entries = new Map(initialEntries.map((entry) => [entry.cacheKey, entry]))

  return {
    compileOrGet(topology, options = {}) {
      const cacheKey = buildCompiledTopologyCacheKey(topology, options)
      const cached = entries.get(cacheKey)
      if (cached !== undefined) {
        return {
          ok: true,
          fromCache: true,
          entry: cached,
          snapshot: cached.snapshot,
        }
      }

      const compiled = compileTopology(topology, options)
      if (!compiled.ok) return { ...compiled, fromCache: false }

      const entry: CompiledTopologyCacheEntry = {
        cacheKey,
        topologyId: topology.id,
        sourceTopologyVersion: compiled.snapshot.sourceTopologyVersion,
        sourceTopologyHash: compiled.snapshot.sourceTopologyHash,
        compilerVersion: compiled.snapshot.compilerVersion,
        snapshot: compiled.snapshot,
        cachedAt: options.compiledAt ?? Date.now(),
      }
      entries.set(cacheKey, entry)

      return {
        ok: true,
        fromCache: false,
        entry,
        snapshot: compiled.snapshot,
      }
    },
    get(cacheKey) {
      return entries.get(cacheKey)
    },
    list() {
      return [...entries.values()]
    },
    delete(cacheKey) {
      return entries.delete(cacheKey)
    },
    clear() {
      entries.clear()
    },
  }
}
