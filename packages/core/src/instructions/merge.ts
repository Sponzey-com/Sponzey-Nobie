import { discoverInstructionChain, type AgentInstructionSourceInput, type InstructionChain } from "./discovery.js"

const CACHE_TTL_MS = 5_000

export interface MergedInstructionBundle {
  chain: InstructionChain
  mergedText: string
}

export interface MergedInstructionOptions {
  agentSources?: AgentInstructionSourceInput[]
}

interface CacheEntry {
  expiresAt: number
  signature: string
  bundle: MergedInstructionBundle
}

const bundleCache = new Map<string, CacheEntry>()

export function loadMergedInstructions(workDir = process.cwd(), options: MergedInstructionOptions = {}): MergedInstructionBundle {
  const chain = discoverInstructionChain(workDir, options.agentSources ? { agentSources: options.agentSources } : {})
  const signature = buildChainSignature(chain)
  const cacheKey = buildCacheKey(workDir, options)
  const cached = bundleCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() && cached.signature === signature) {
    return cached.bundle
  }

  const mergedText = chain.sources
    .filter((source) => source.loaded && source.content?.trim())
    .map((source, index) => [
      source.sourceKind === "agent_prompt" ? `[Agent Instruction Source ${index + 1}]` : `[Instruction Source ${index + 1}]`,
      `path: ${source.path}`,
      `scope: ${source.scope}`,
      source.agentId ? `agentId: ${source.agentId}` : "",
      source.agentType ? `agentType: ${source.agentType}` : "",
      source.content?.trim() ?? "",
    ].filter(Boolean).join("\n"))
    .join("\n\n")

  const bundle = { chain, mergedText }
  bundleCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    signature,
    bundle,
  })
  return bundle
}

function buildCacheKey(workDir: string, options: MergedInstructionOptions): string {
  if (!options.agentSources?.length) return workDir
  return [
    workDir,
    ...options.agentSources.map((source) => [
      source.agentType,
      source.agentId,
      source.sourceId,
      source.version ?? "",
      source.content,
    ].join(":")),
  ].join("|")
}

function buildChainSignature(chain: InstructionChain): string {
  return chain.sources.map((source) => (
    [
      source.path,
      source.scope,
      source.level,
      source.loaded ? "1" : "0",
      source.size,
      source.mtimeMs ?? 0,
      source.content ?? "",
      source.error ?? "",
    ].join(":")
  )).join("|")
}
