import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, normalize, relative, resolve } from "node:path"
import { PATHS } from "../config/index.js"

const MAX_INSTRUCTION_FILE_SIZE = 12_000
const FALLBACK_FILENAMES = ["CLAUDE.md"] as const
const PER_DIR_CANDIDATES = ["AGENTS.override.md", "AGENTS.md", ...FALLBACK_FILENAMES] as const

export interface InstructionSource {
  path: string
  scope: "global" | "project"
  level: number
  exists: boolean
  loaded: boolean
  size: number
  mtimeMs?: number
  content?: string
  error?: string
}

export interface InstructionChain {
  workDir: string
  gitRoot?: string
  sources: InstructionSource[]
}

export function discoverInstructionChain(workDir = process.cwd()): InstructionChain {
  const normalizedWorkDir = resolve(workDir)
  const gitRoot = findGitRoot(normalizedWorkDir)
  const sources: InstructionSource[] = []

  const globalSource = pickInstructionFile(PATHS.stateDir, "global", 0)
  if (globalSource) sources.push(globalSource)

  const dirs = gitRoot
    ? buildPathChain(gitRoot, normalizedWorkDir)
    : buildFallbackPathChain(normalizedWorkDir)

  dirs.forEach((dirPath, index) => {
    const source = pickInstructionFile(dirPath, "project", index + 1)
    if (source) sources.push(source)
  })

  return {
    workDir: normalizedWorkDir,
    ...(gitRoot ? { gitRoot } : {}),
    sources,
  }
}

function pickInstructionFile(dirPath: string, scope: "global" | "project", level: number): InstructionSource | undefined {
  for (const filename of PER_DIR_CANDIDATES) {
    const candidate = join(dirPath, filename)
    if (!existsSync(candidate)) continue

    try {
      const stat = statSync(candidate)
      if (!stat.isFile()) continue
      const content = readFileSync(candidate, "utf-8").slice(0, MAX_INSTRUCTION_FILE_SIZE)
      return {
        path: candidate,
        scope,
        level,
        exists: true,
        loaded: true,
        size: Buffer.byteLength(content),
        mtimeMs: stat.mtimeMs,
        content,
      }
    } catch (error) {
      return {
        path: candidate,
        scope,
        level,
        exists: true,
        loaded: false,
        size: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return undefined
}

function findGitRoot(startDir: string): string | undefined {
  let current = startDir
  while (true) {
    if (existsSync(join(current, ".git"))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function buildPathChain(rootDir: string, targetDir: string): string[] {
  const normalizedRoot = normalize(resolve(rootDir))
  const normalizedTarget = normalize(resolve(targetDir))
  const relativePath = relative(normalizedRoot, normalizedTarget)
  if (relativePath.startsWith("..") || relativePath === "") {
    if (relativePath === "") return [normalizedRoot]
    return [normalizedTarget]
  }

  const chain = [normalizedRoot]
  let current = normalizedRoot
  const relativeParts = relativePath.split("/").filter(Boolean)
  for (const part of relativeParts) {
    current = join(current, part)
    chain.push(current)
  }

  return chain
}

function buildFallbackPathChain(targetDir: string): string[] {
  const normalizedTarget = normalize(resolve(targetDir))
  const normalizedHome = normalize(resolve(homedir()))
  const withinHome = isInside(normalizedHome, normalizedTarget)
  const chain = [normalizedTarget]
  let current = normalizedTarget
  let depth = 0

  while (depth < 8) {
    const parent = dirname(current)
    if (parent === current) break
    if (withinHome && parent === normalizedHome) break
    chain.push(parent)
    current = parent
    depth += 1
  }

  return [...new Set(chain.reverse())]
}

function isInside(parentDir: string, childDir: string): boolean {
  const relativePath = relative(parentDir, childDir)
  return relativePath === "" || (!relativePath.startsWith("..") && relativePath !== ".")
}
