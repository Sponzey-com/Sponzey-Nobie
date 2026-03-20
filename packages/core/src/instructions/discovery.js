import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { PATHS } from "../config/index.js";
const MAX_INSTRUCTION_FILE_SIZE = 12_000;
const FALLBACK_FILENAMES = ["CLAUDE.md"];
const PER_DIR_CANDIDATES = ["AGENTS.override.md", "AGENTS.md", ...FALLBACK_FILENAMES];
export function discoverInstructionChain(workDir = process.cwd()) {
    const normalizedWorkDir = resolve(workDir);
    const gitRoot = findGitRoot(normalizedWorkDir);
    const sources = [];
    const globalSource = pickInstructionFile(PATHS.stateDir, "global", 0);
    if (globalSource)
        sources.push(globalSource);
    const dirs = gitRoot
        ? buildPathChain(gitRoot, normalizedWorkDir)
        : buildFallbackPathChain(normalizedWorkDir);
    dirs.forEach((dirPath, index) => {
        const source = pickInstructionFile(dirPath, "project", index + 1);
        if (source)
            sources.push(source);
    });
    return {
        workDir: normalizedWorkDir,
        ...(gitRoot ? { gitRoot } : {}),
        sources,
    };
}
function pickInstructionFile(dirPath, scope, level) {
    for (const filename of PER_DIR_CANDIDATES) {
        const candidate = join(dirPath, filename);
        if (!existsSync(candidate))
            continue;
        try {
            const stat = statSync(candidate);
            if (!stat.isFile())
                continue;
            const content = readFileSync(candidate, "utf-8").slice(0, MAX_INSTRUCTION_FILE_SIZE);
            return {
                path: candidate,
                scope,
                level,
                exists: true,
                loaded: true,
                size: Buffer.byteLength(content),
                mtimeMs: stat.mtimeMs,
                content,
            };
        }
        catch (error) {
            return {
                path: candidate,
                scope,
                level,
                exists: true,
                loaded: false,
                size: 0,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    return undefined;
}
function findGitRoot(startDir) {
    let current = startDir;
    while (true) {
        if (existsSync(join(current, ".git")))
            return current;
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
function buildPathChain(rootDir, targetDir) {
    const normalizedRoot = normalize(resolve(rootDir));
    const normalizedTarget = normalize(resolve(targetDir));
    const relativePath = relative(normalizedRoot, normalizedTarget);
    if (relativePath.startsWith("..") || relativePath === "") {
        if (relativePath === "")
            return [normalizedRoot];
        return [normalizedTarget];
    }
    const chain = [normalizedRoot];
    let current = normalizedRoot;
    const relativeParts = relativePath.split("/").filter(Boolean);
    for (const part of relativeParts) {
        current = join(current, part);
        chain.push(current);
    }
    return chain;
}
function buildFallbackPathChain(targetDir) {
    const normalizedTarget = normalize(resolve(targetDir));
    const normalizedHome = normalize(resolve(homedir()));
    const withinHome = isInside(normalizedHome, normalizedTarget);
    const chain = [normalizedTarget];
    let current = normalizedTarget;
    let depth = 0;
    while (depth < 8) {
        const parent = dirname(current);
        if (parent === current)
            break;
        if (withinHome && parent === normalizedHome)
            break;
        chain.push(parent);
        current = parent;
        depth += 1;
    }
    return [...new Set(chain.reverse())];
}
function isInside(parentDir, childDir) {
    const relativePath = relative(parentDir, childDir);
    return relativePath === "" || (!relativePath.startsWith("..") && relativePath !== ".");
}
//# sourceMappingURL=discovery.js.map