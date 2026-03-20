import { discoverInstructionChain } from "./discovery.js";
const CACHE_TTL_MS = 5_000;
const bundleCache = new Map();
export function loadMergedInstructions(workDir = process.cwd()) {
    const chain = discoverInstructionChain(workDir);
    const signature = buildChainSignature(chain);
    const cached = bundleCache.get(workDir);
    if (cached && cached.expiresAt > Date.now() && cached.signature === signature) {
        return cached.bundle;
    }
    const mergedText = chain.sources
        .filter((source) => source.loaded && source.content?.trim())
        .map((source, index) => [
        `[Instruction Source ${index + 1}]`,
        `path: ${source.path}`,
        `scope: ${source.scope}`,
        source.content?.trim() ?? "",
    ].join("\n"))
        .join("\n\n");
    const bundle = { chain, mergedText };
    bundleCache.set(workDir, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        signature,
        bundle,
    });
    return bundle;
}
function buildChainSignature(chain) {
    return chain.sources.map((source) => ([
        source.path,
        source.scope,
        source.level,
        source.loaded ? "1" : "0",
        source.size,
        source.mtimeMs ?? 0,
        source.content ?? "",
        source.error ?? "",
    ].join(":"))).join("|");
}
//# sourceMappingURL=merge.js.map