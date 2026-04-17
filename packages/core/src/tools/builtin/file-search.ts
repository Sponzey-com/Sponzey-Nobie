import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import { join, basename } from "node:path"
import { spawnSync } from "node:child_process"
import { assertAllowedPath } from "./file.js"
import type { AgentTool, ToolResult } from "../types.js"

const MAX_DEPTH = 10
const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", ".next", "__pycache__"]
const DEFAULT_MAX_RESULTS = 50

interface FileSearchParams {
  query: string
  searchIn?: "names" | "content" | "both" | undefined
  paths?: string[] | undefined
  includePatterns?: string[] | undefined
  excludePatterns?: string[] | undefined
  maxResults?: number | undefined
  contextLines?: number | undefined
  caseSensitive?: boolean | undefined
}

function matchesGlob(name: string, pattern: string): boolean {
  // Simple glob: *query* pattern — treat pattern as contains-check with wildcards
  // Convert glob to regex: * → .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  const re = new RegExp(`^${escaped}$`, "i")
  return re.test(name)
}

function shouldExclude(name: string, excludePatterns: string[]): boolean {
  if (DEFAULT_EXCLUDE.includes(name)) return true
  return excludePatterns.some((p) => matchesGlob(name, p))
}

function walkDir(
  dir: string,
  excludePatterns: string[],
  depth: number,
  results: string[],
  maxResults: number,
): void {
  if (depth > MAX_DEPTH || results.length >= maxResults) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= maxResults) break
    if (shouldExclude(entry, excludePatterns)) continue
    const full = join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkDir(full, excludePatterns, depth + 1, results, maxResults)
    } else {
      results.push(full)
    }
  }
}

function searchFileNames(
  searchPaths: string[],
  query: string,
  excludePatterns: string[],
  maxResults: number,
): string[] {
  const pattern = `*${query}*`
  const allFiles: string[] = []
  for (const sp of searchPaths) {
    walkDir(sp, excludePatterns, 0, allFiles, maxResults * 10)
  }
  const matched: string[] = []
  for (const f of allFiles) {
    if (matched.length >= maxResults) break
    if (matchesGlob(basename(f), pattern)) {
      matched.push(f)
    }
  }
  return matched
}

function findRg(): string | null {
  for (const cmd of ["rg", "ripgrep"]) {
    const result = spawnSync("which", [cmd], { encoding: "utf-8" })
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim()
    }
  }
  return null
}

interface ContentMatch {
  file: string
  line: number
  text: string
}

function searchContentWithRg(
  searchPaths: string[],
  query: string,
  caseSensitive: boolean,
  maxResults: number,
  rgPath: string,
): ContentMatch[] {
  const args: string[] = ["--json", "--max-count", "10"]
  if (!caseSensitive) args.push("--ignore-case")
  args.push(query)
  args.push(...searchPaths)

  const result = spawnSync(rgPath, args, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 })
  const matches: ContentMatch[] = []

  if (result.stdout) {
    const lines = result.stdout.split("\n")
    for (const raw of lines) {
      if (matches.length >= maxResults) break
      const trimmed = raw.trim()
      if (!trimmed) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "type" in parsed &&
        (parsed as Record<string, unknown>)["type"] === "match"
      ) {
        const data = (parsed as Record<string, unknown>)["data"] as Record<string, unknown> | undefined
        if (!data) continue
        const pathObj = data["path"] as Record<string, unknown> | undefined
        const lines_obj = data["lines"] as Record<string, unknown> | undefined
        const lineNumber = data["line_number"] as number | undefined
        const filePath = pathObj?.["text"] as string | undefined
        const lineText = lines_obj?.["text"] as string | undefined
        if (filePath && lineText !== undefined && lineNumber !== undefined) {
          matches.push({ file: filePath, line: lineNumber, text: lineText.trimEnd() })
        }
      }
    }
  }

  return matches
}

function searchContentNode(
  searchPaths: string[],
  query: string,
  caseSensitive: boolean,
  maxResults: number,
  excludePatterns: string[],
): ContentMatch[] {
  const allFiles: string[] = []
  for (const sp of searchPaths) {
    walkDir(sp, excludePatterns, 0, allFiles, 10000)
  }

  const matches: ContentMatch[] = []
  const flags = caseSensitive ? "" : "i"
  let re: RegExp
  try {
    re = new RegExp(query, flags)
  } catch {
    // Fallback to literal match
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    re = new RegExp(escaped, flags)
  }

  for (const f of allFiles) {
    if (matches.length >= maxResults) break
    let content: string
    try {
      content = readFileSync(f, "utf-8")
    } catch {
      continue
    }
    const fileLines = content.split(/\r?\n/)
    for (let i = 0; i < fileLines.length; i++) {
      if (matches.length >= maxResults) break
      const line = fileLines[i] ?? ""
      if (re.test(line)) {
        matches.push({ file: f, line: i + 1, text: line })
      }
    }
  }

  return matches
}

export const fileSearchTool: AgentTool<FileSearchParams> = {
  name: "file_search",
  description: "로컬 workspace의 파일명 또는 파일 내용을 검색합니다. 정규식 패턴 지원. 웹 검색 결과, 브라우저 HTML, 실시간 시세/날씨 값 추출에는 사용하지 마세요.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "검색 쿼리 (파일명 패턴 또는 내용 정규식)" },
      searchIn: {
        type: "string",
        enum: ["names", "content", "both"],
        description: "검색 대상: names(파일명), content(내용), both(둘 다). 기본: both",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "검색할 디렉토리 목록. 미지정 시 workDir 사용",
      },
      includePatterns: {
        type: "array",
        items: { type: "string" },
        description: "포함할 파일 패턴 목록 (e.g. *.ts)",
      },
      excludePatterns: {
        type: "array",
        items: { type: "string" },
        description: "제외할 파일/디렉토리 패턴",
      },
      maxResults: { type: "number", description: "최대 결과 수. 기본: 50" },
      contextLines: { type: "number", description: "내용 검색 시 전후 컨텍스트 라인 수" },
      caseSensitive: { type: "boolean", description: "대소문자 구분 여부. 기본: false" },
    },
    required: ["query"],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params: FileSearchParams, ctx): Promise<ToolResult> {
    const searchIn = params.searchIn ?? "both"
    const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS
    const caseSensitive = params.caseSensitive ?? false
    const excludePatterns = params.excludePatterns ?? []

    // Determine search paths
    const rawPaths = params.paths && params.paths.length > 0 ? params.paths : [ctx.workDir]
    const searchPaths: string[] = []
    for (const p of rawPaths) {
      try {
        assertAllowedPath(p)
        if (existsSync(p)) {
          searchPaths.push(p)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, output: `Path not allowed: ${msg}`, error: msg }
      }
    }

    if (searchPaths.length === 0) {
      return { success: false, output: "No valid search paths found", error: "NO_PATHS" }
    }

    const outputParts: string[] = []

    // File name search
    if (searchIn === "names" || searchIn === "both") {
      const nameMatches = searchFileNames(searchPaths, params.query, excludePatterns, maxResults)
      if (nameMatches.length > 0) {
        const lines = nameMatches.map((f) => `  ${f}`)
        outputParts.push(`[파일명 검색]\n${lines.join("\n")}`)
      } else {
        outputParts.push("[파일명 검색]\n  (결과 없음)")
      }
    }

    // Content search
    if (searchIn === "content" || searchIn === "both") {
      let contentMatches: ContentMatch[]
      const rgPath = findRg()

      if (rgPath) {
        contentMatches = searchContentWithRg(searchPaths, params.query, caseSensitive, maxResults, rgPath)
      } else {
        contentMatches = searchContentNode(searchPaths, params.query, caseSensitive, maxResults, excludePatterns)
      }

      if (contentMatches.length > 0) {
        const lines = contentMatches.map((m) => `  ${m.file}:${m.line}:${m.text}`)
        outputParts.push(`[내용 검색]\n${lines.join("\n")}`)
      } else {
        outputParts.push("[내용 검색]\n  (결과 없음)")
      }
    }

    const output = outputParts.join("\n\n")
    return {
      success: true,
      output,
      details: { query: params.query, searchIn, searchPaths },
    }
  },
}
