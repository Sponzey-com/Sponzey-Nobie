import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { getWorkspaceRootPath } from "../version.js"

export type RuntimeBuildPackageKey = "core" | "cli"

export interface RuntimeBuildPackageInput {
  package: RuntimeBuildPackageKey
  sourceDir: string
  distDir: string
}

export interface RuntimeBuildFileMtime {
  path: string
  mtimeMs: number
  mtimeIso: string
}

export interface RuntimeBuildPackageStatus {
  package: RuntimeBuildPackageKey
  sourceDir: string
  distDir: string
  sourceNewest: RuntimeBuildFileMtime | null
  distNewest: RuntimeBuildFileMtime | null
  missingOutputs: string[]
  staleOutputs: Array<{
    sourcePath: string
    outputPath: string
    sourceMtimeIso: string
    outputMtimeIso: string | null
  }>
  buildRequired: boolean
  restartRequired: boolean
}

export interface RuntimeBuildStatus {
  checkedAt: string
  processStartedAt: string
  processStartTimeMs: number
  workspaceRoot: string
  gitCommit: string | null
  gitDescribe: string | null
  buildId: string
  buildRequired: boolean
  restartRequired: boolean
  packages: RuntimeBuildPackageStatus[]
  warnings: string[]
}

export interface RuntimeBuildStatusInput {
  workspaceRoot?: string
  processStartTimeMs?: number
  now?: Date
  packages?: RuntimeBuildPackageInput[]
  commandRunner?: (command: string, args: string[], cwd: string) => string | null
}

const MTIME_TOLERANCE_MS = 1
const IGNORED_DIR_NAMES = new Set([".git", "node_modules", ".turbo", ".cache"])
const processStartTimeMs = Math.floor(Date.now() - process.uptime() * 1000)

export function getGatewayProcessStartTimeMs(): number {
  return processStartTimeMs
}

function defaultPackages(workspaceRoot: string): RuntimeBuildPackageInput[] {
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
  ]
}

function toFileMtime(path: string, mtimeMs: number): RuntimeBuildFileMtime {
  return {
    path,
    mtimeMs,
    mtimeIso: new Date(mtimeMs).toISOString(),
  }
}

function newestFileMtime(dir: string): RuntimeBuildFileMtime | null {
  if (!existsSync(dir)) return null
  let newest: RuntimeBuildFileMtime | null = null
  const stack = [dir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (IGNORED_DIR_NAMES.has(entry)) continue
      const path = join(current, entry)
      let stat
      try {
        stat = statSync(path)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(path)
        continue
      }
      if (!stat.isFile()) continue
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = toFileMtime(path, stat.mtimeMs)
    }
  }

  return newest
}

function sourceBuildInputs(dir: string): RuntimeBuildFileMtime[] {
  if (!existsSync(dir)) return []
  const files: RuntimeBuildFileMtime[] = []
  const stack = [dir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (IGNORED_DIR_NAMES.has(entry)) continue
      const path = join(current, entry)
      let stat
      try {
        stat = statSync(path)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(path)
        continue
      }
      if (!stat.isFile()) continue
      if (!/\.(?:ts|tsx)$/u.test(path) || /\.d\.ts$/u.test(path)) continue
      files.push(toFileMtime(path, stat.mtimeMs))
    }
  }

  return files
}

function mappedDistOutput(sourceDir: string, distDir: string, sourcePath: string): string {
  const relativeSourcePath = relative(sourceDir, sourcePath)
  return join(distDir, relativeSourcePath.replace(/\.(?:ts|tsx)$/u, ".js"))
}

function outputMtime(path: string): RuntimeBuildFileMtime | null {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return null
    return toFileMtime(path, stat.mtimeMs)
  } catch {
    return null
  }
}

function newestFromFiles(files: RuntimeBuildFileMtime[]): RuntimeBuildFileMtime | null {
  return files.reduce<RuntimeBuildFileMtime | null>((newest, file) =>
    !newest || file.mtimeMs > newest.mtimeMs ? file : newest, null)
}

function defaultCommandRunner(command: string, args: string[], cwd: string): string | null {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return output || null
  } catch {
    return null
  }
}

function packageStatus(input: RuntimeBuildPackageInput, processStart: number): RuntimeBuildPackageStatus {
  const sourceInputs = sourceBuildInputs(input.sourceDir)
  const sourceNewest = newestFromFiles(sourceInputs)
  const distNewest = newestFileMtime(input.distDir)
  const missingOutputs: string[] = []
  const staleOutputs: RuntimeBuildPackageStatus["staleOutputs"] = []
  for (const source of sourceInputs) {
    const outputPath = mappedDistOutput(input.sourceDir, input.distDir, source.path)
    const output = outputMtime(outputPath)
    if (!output) {
      missingOutputs.push(outputPath)
    }
  }
  const buildRequired = Boolean(
    missingOutputs.length > 0
    || (sourceNewest && (!distNewest || sourceNewest.mtimeMs > distNewest.mtimeMs + MTIME_TOLERANCE_MS)),
  )
  const restartRequired = Boolean(
    distNewest && distNewest.mtimeMs > processStart + MTIME_TOLERANCE_MS,
  )

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
  }
}

export function buildRuntimeBuildStatus(input: RuntimeBuildStatusInput = {}): RuntimeBuildStatus {
  const workspaceRoot = input.workspaceRoot ?? getWorkspaceRootPath()
  const processStart = input.processStartTimeMs ?? getGatewayProcessStartTimeMs()
  const now = input.now ?? new Date()
  const commandRunner = input.commandRunner ?? defaultCommandRunner
  const packages = (input.packages ?? defaultPackages(workspaceRoot)).map((item) => packageStatus(item, processStart))
  const gitCommit = commandRunner("git", ["rev-parse", "HEAD"], workspaceRoot)
  const gitDescribe = commandRunner("git", ["describe", "--tags", "--always", "--dirty"], workspaceRoot)
  const buildRequired = packages.some((item) => item.buildRequired)
  const restartRequired = packages.some((item) => item.restartRequired)
  const warnings: string[] = []
  if (buildRequired) warnings.push("build_required")
  if (restartRequired) warnings.push("restart_required")

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
  }
}

export function getRuntimeBuildStatus(now?: Date): RuntimeBuildStatus {
  return now ? buildRuntimeBuildStatus({ now }) : buildRuntimeBuildStatus()
}
