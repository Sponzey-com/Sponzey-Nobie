import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { getWorkspaceRootPath } from "../version.js";
const MTIME_TOLERANCE_MS = 1;
const IGNORED_DIR_NAMES = new Set([".git", "node_modules", ".turbo", ".cache"]);
const processStartTimeMs = Math.floor(Date.now() - process.uptime() * 1000);
export function getGatewayProcessStartTimeMs() {
    return processStartTimeMs;
}
function defaultPackages(workspaceRoot) {
    return [
        {
            package: "core",
            sourceDir: join(workspaceRoot, "packages", "core", "src"),
            distDir: join(workspaceRoot, "packages", "core", "dist"),
        },
        {
            package: "cli",
            sourceDir: join(workspaceRoot, "packages", "cli", "src"),
            distDir: join(workspaceRoot, "packages", "cli", "dist"),
        },
    ];
}
function toFileMtime(path, mtimeMs) {
    return {
        path,
        mtimeMs,
        mtimeIso: new Date(mtimeMs).toISOString(),
    };
}
function newestFileMtime(dir) {
    if (!existsSync(dir))
        return null;
    let newest = null;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current)
            continue;
        let entries;
        try {
            entries = readdirSync(current);
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (IGNORED_DIR_NAMES.has(entry))
                continue;
            const path = join(current, entry);
            let stat;
            try {
                stat = statSync(path);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                stack.push(path);
                continue;
            }
            if (!stat.isFile())
                continue;
            if (!newest || stat.mtimeMs > newest.mtimeMs)
                newest = toFileMtime(path, stat.mtimeMs);
        }
    }
    return newest;
}
function sourceBuildInputs(dir) {
    if (!existsSync(dir))
        return [];
    const files = [];
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current)
            continue;
        let entries;
        try {
            entries = readdirSync(current);
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (IGNORED_DIR_NAMES.has(entry))
                continue;
            const path = join(current, entry);
            let stat;
            try {
                stat = statSync(path);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                stack.push(path);
                continue;
            }
            if (!stat.isFile())
                continue;
            if (!/\.(?:ts|tsx)$/u.test(path) || /\.d\.ts$/u.test(path))
                continue;
            files.push(toFileMtime(path, stat.mtimeMs));
        }
    }
    return files;
}
function mappedDistOutput(sourceDir, distDir, sourcePath) {
    const relativeSourcePath = relative(sourceDir, sourcePath);
    return join(distDir, relativeSourcePath.replace(/\.(?:ts|tsx)$/u, ".js"));
}
function outputMtime(path) {
    try {
        const stat = statSync(path);
        if (!stat.isFile())
            return null;
        return toFileMtime(path, stat.mtimeMs);
    }
    catch {
        return null;
    }
}
function newestFromFiles(files) {
    return files.reduce((newest, file) => !newest || file.mtimeMs > newest.mtimeMs ? file : newest, null);
}
function defaultCommandRunner(command, args, cwd) {
    try {
        const output = execFileSync(command, args, {
            cwd,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return output || null;
    }
    catch {
        return null;
    }
}
function packageStatus(input, processStart) {
    const sourceInputs = sourceBuildInputs(input.sourceDir);
    const sourceNewest = newestFromFiles(sourceInputs);
    const distNewest = newestFileMtime(input.distDir);
    const missingOutputs = [];
    const staleOutputs = [];
    for (const source of sourceInputs) {
        const outputPath = mappedDistOutput(input.sourceDir, input.distDir, source.path);
        const output = outputMtime(outputPath);
        if (!output) {
            missingOutputs.push(outputPath);
        }
    }
    const buildRequired = Boolean(missingOutputs.length > 0 || (sourceNewest && (!distNewest || sourceNewest.mtimeMs > distNewest.mtimeMs + MTIME_TOLERANCE_MS)));
    const restartRequired = Boolean(distNewest && distNewest.mtimeMs > processStart + MTIME_TOLERANCE_MS);
    return {
        package: input.package,
        sourceDir: input.sourceDir,
        distDir: input.distDir,
        sourceNewest,
        distNewest,
        missingOutputs,
        staleOutputs,
        buildRequired,
        restartRequired,
    };
}
export function buildRuntimeBuildStatus(input = {}) {
    const workspaceRoot = input.workspaceRoot ?? getWorkspaceRootPath();
    const processStart = input.processStartTimeMs ?? getGatewayProcessStartTimeMs();
    const now = input.now ?? new Date();
    const commandRunner = input.commandRunner ?? defaultCommandRunner;
    const packages = (input.packages ?? defaultPackages(workspaceRoot)).map((item) => packageStatus(item, processStart));
    const gitCommit = commandRunner("git", ["rev-parse", "HEAD"], workspaceRoot);
    const gitDescribe = commandRunner("git", ["describe", "--tags", "--always", "--dirty"], workspaceRoot);
    const buildRequired = packages.some((item) => item.buildRequired);
    const restartRequired = packages.some((item) => item.restartRequired);
    const warnings = [];
    if (buildRequired)
        warnings.push("build_required");
    if (restartRequired)
        warnings.push("restart_required");
    return {
        checkedAt: now.toISOString(),
        processStartedAt: new Date(processStart).toISOString(),
        processStartTimeMs: processStart,
        workspaceRoot,
        gitCommit,
        gitDescribe,
        buildId: gitDescribe ?? (gitCommit ? gitCommit.slice(0, 12) : "unknown"),
        buildRequired,
        restartRequired,
        packages,
        warnings,
    };
}
export function getRuntimeBuildStatus(now) {
    return now ? buildRuntimeBuildStatus({ now }) : buildRuntimeBuildStatus();
}
