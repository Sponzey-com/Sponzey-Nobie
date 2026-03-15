import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs"
import { resolve, join, relative, dirname } from "node:path"
import { homedir } from "node:os"
import { getConfig } from "../../config/index.js"
import type { AgentTool, ToolContext, ToolResult } from "../types.js"
import { parsePatch } from "./patch-parser.js"
import { applyPatch } from "./patch-applier.js"

const MAX_FILE_SIZE = 500 * 1024 // 500 KB read limit

export function assertAllowedPath(filePath: string): void {
  const resolved = resolve(filePath)
  const config = getConfig()
  const home = homedir()

  // Always allow home directory subtree by default
  const allowed = config.security.allowedPaths.length > 0
    ? config.security.allowedPaths.map((p) => resolve(p.replace("~", home)))
    : [home]

  const isAllowed = allowed.some((a) => resolved.startsWith(a + "/") || resolved === a)
  if (!isAllowed) {
    throw new Error(
      `Access denied: "${resolved}" is outside the allowed paths.\n` +
      `Allowed: ${allowed.join(", ")}`,
    )
  }

  // Absolute deny list — OS system directories
  const denied = ["/System", "/usr", "/bin", "/sbin", "/etc", "/boot", "/sys", "C:\\Windows"]
  if (denied.some((d) => resolved.startsWith(d))) {
    throw new Error(`Access denied: "${resolved}" is a protected system path`)
  }
}

// --- file_read ---

interface FileReadParams {
  path: string
  encoding?: string
}

export const fileReadTool: AgentTool<FileReadParams> = {
  name: "file_read",
  description:
    "Read the contents of a file. Returns the text content. " +
    "Large files are truncated with a notice.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or home-relative (~) path to the file" },
      encoding: {
        type: "string",
        enum: ["utf-8", "base64"],
        description: "Encoding for the output. Default: utf-8",
      },
    },
    required: ["path"],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params, _ctx: ToolContext): Promise<ToolResult> {
    const filePath = params.path.replace(/^~/, homedir())
    try {
      assertAllowedPath(filePath)
      if (!existsSync(filePath)) {
        return { success: false, output: `File not found: "${filePath}"`, error: "ENOENT" }
      }
      const stat = statSync(filePath)
      if (!stat.isFile()) {
        return { success: false, output: `"${filePath}" is not a file`, error: "EISDIR" }
      }

      const enc = params.encoding === "base64" ? "base64" : "utf-8"
      if (stat.size > MAX_FILE_SIZE) {
        const raw = readFileSync(filePath, enc)
        const truncated = raw.slice(0, MAX_FILE_SIZE)
        return {
          success: true,
          output:
            truncated +
            `\n\n[Truncated: file is ${stat.size} bytes, showing first ${MAX_FILE_SIZE} bytes]`,
          details: { path: filePath, size: stat.size, truncated: true },
        }
      }

      const content = readFileSync(filePath, enc)
      return {
        success: true,
        output: content,
        details: { path: filePath, size: stat.size },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `Error reading file: ${msg}`, error: msg }
    }
  },
}

// --- file_write ---

interface FileWriteParams {
  path: string
  content: string
  createDirs?: boolean
}

export const fileWriteTool: AgentTool<FileWriteParams> = {
  name: "file_write",
  description: "Write text content to a file. Creates the file if it does not exist.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Text content to write" },
      createDirs: {
        type: "boolean",
        description: "Create parent directories if they do not exist. Default: true",
      },
    },
    required: ["path", "content"],
  },
  riskLevel: "moderate",
  requiresApproval: false,

  async execute(params, _ctx: ToolContext): Promise<ToolResult> {
    const filePath = params.path.replace(/^~/, homedir())
    try {
      assertAllowedPath(filePath)
      if (params.createDirs !== false) {
        mkdirSync(dirname(filePath), { recursive: true })
      }
      writeFileSync(filePath, params.content, "utf-8")
      return {
        success: true,
        output: `File written: "${filePath}" (${params.content.length} chars)`,
        details: { path: filePath, bytes: Buffer.byteLength(params.content) },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `Error writing file: ${msg}`, error: msg }
    }
  },
}

// --- file_list ---

interface FileListParams {
  path: string
  recursive?: boolean
  pattern?: string
  showHidden?: boolean
}

export const fileListTool: AgentTool<FileListParams> = {
  name: "file_list",
  description: "List files and directories at a given path.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
      recursive: { type: "boolean", description: "Recurse into subdirectories. Default: false" },
      showHidden: {
        type: "boolean",
        description: "Include hidden files (starting with '.'). Default: false",
      },
    },
    required: ["path"],
  },
  riskLevel: "safe",
  requiresApproval: false,

  async execute(params, _ctx: ToolContext): Promise<ToolResult> {
    const dirPath = params.path.replace(/^~/, homedir())
    try {
      assertAllowedPath(dirPath)
      if (!existsSync(dirPath)) {
        return { success: false, output: `Directory not found: "${dirPath}"`, error: "ENOENT" }
      }
      const stat = statSync(dirPath)
      if (!stat.isDirectory()) {
        return { success: false, output: `"${dirPath}" is not a directory`, error: "ENOTDIR" }
      }

      const entries = listDir(dirPath, params.recursive ?? false, params.showHidden ?? false)
      const lines = entries.map((e) => {
        const rel = relative(dirPath, e.path)
        return `${e.isDir ? "d" : "f"} ${rel}${e.isDir ? "/" : ""}`
      })

      const output = lines.length > 0
        ? lines.join("\n")
        : "(empty directory)"

      return {
        success: true,
        output,
        details: { path: dirPath, count: lines.length },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `Error listing directory: ${msg}`, error: msg }
    }
  },
}

interface Entry { path: string; isDir: boolean }

function listDir(dir: string, recursive: boolean, showHidden: boolean, depth = 0): Entry[] {
  if (depth > 5) return [] // max depth guard
  const results: Entry[] = []
  const items = readdirSync(dir)
  for (const item of items) {
    if (!showHidden && item.startsWith(".")) continue
    const full = join(dir, item)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    results.push({ path: full, isDir })
    if (isDir && recursive) {
      results.push(...listDir(full, true, showHidden, depth + 1))
    }
  }
  return results
}

// --- file_patch ---

interface FilePatchParams {
  patch: string
}

export const filePatchTool: AgentTool<FilePatchParams> = {
  name: "file_patch",
  description: "구조화된 패치 형식으로 파일을 편집합니다. Update/Add/Delete 지시어를 지원합니다.",
  parameters: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description: "*** Begin Patch ... *** End Patch 형식의 패치 텍스트",
      },
    },
    required: ["patch"],
  },
  riskLevel: "moderate",
  requiresApproval: false,

  async execute(params, ctx: ToolContext): Promise<ToolResult> {
    try {
      const parsed = parsePatch(params.patch)
      const result = applyPatch(parsed, ctx.workDir)
      if (!result.success) {
        return { success: false, output: result.message, error: result.message }
      }
      return {
        success: true,
        output: result.message,
        details: { filesChanged: result.filesChanged, hasDeletes: parsed.hasDeletes },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `Patch failed: ${msg}`, error: msg }
    }
  },
}

// --- file_delete ---

interface FileDeleteParams {
  path: string
}

export const fileDeleteTool: AgentTool<FileDeleteParams> = {
  name: "file_delete",
  description: "Delete a file. Requires approval.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to delete" },
    },
    required: ["path"],
  },
  riskLevel: "dangerous",
  requiresApproval: true,

  async execute(params, _ctx: ToolContext): Promise<ToolResult> {
    const filePath = params.path.replace(/^~/, homedir())
    try {
      assertAllowedPath(filePath)
      if (!existsSync(filePath)) {
        return { success: false, output: `File not found: "${filePath}"`, error: "ENOENT" }
      }
      const { unlinkSync } = await import("node:fs")
      unlinkSync(filePath)
      return { success: true, output: `Deleted: "${filePath}"` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: `Error deleting file: ${msg}`, error: msg }
    }
  },
}
