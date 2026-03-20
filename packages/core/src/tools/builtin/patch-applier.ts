import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "node:fs"
import { join, dirname, isAbsolute } from "node:path"
import { assertAllowedPath } from "./file.js"
import type { ParsedPatch, Hunk } from "./patch-parser.js"

export interface ApplyResult {
  success: boolean
  message: string
  filesChanged: string[]
}

function resolveFilePath(filePath: string, workDir: string): string {
  if (isAbsolute(filePath)) return filePath
  return join(workDir, filePath)
}

function applyHunkToLines(lines: string[], hunk: Hunk): string[] | null {
  // Collect context lines from changes (lines that are "context" or "remove")
  // We need to find where this hunk applies in the file
  const contextAndRemoveLines = hunk.changes
    .filter((c) => c.op === "context" || c.op === "remove")
    .map((c) => c.line)

  if (contextAndRemoveLines.length === 0) {
    // Pure insertion — append at end
    const result = [...lines]
    for (const change of hunk.changes) {
      if (change.op === "add") {
        result.push(change.line)
      }
    }
    return result
  }

  // Find the position in lines where contextAndRemoveLines matches
  let matchStart = -1
  outer: for (let i = 0; i <= lines.length - contextAndRemoveLines.length; i++) {
    for (let j = 0; j < contextAndRemoveLines.length; j++) {
      if (lines[i + j] !== contextAndRemoveLines[j]) {
        continue outer
      }
    }
    matchStart = i
    break
  }

  if (matchStart === -1) {
    return null
  }

  // Apply the changes
  const result: string[] = [...lines.slice(0, matchStart)]
  let fileIdx = matchStart

  for (const change of hunk.changes) {
    if (change.op === "context") {
      result.push(lines[fileIdx] ?? change.line)
      fileIdx++
    } else if (change.op === "remove") {
      fileIdx++
    } else if (change.op === "add") {
      result.push(change.line)
    }
  }

  result.push(...lines.slice(fileIdx))
  return result
}

export function applyPatch(patch: ParsedPatch, workDir: string): ApplyResult {
  const filesChanged: string[] = []

  for (const op of patch.operations) {
    const absPath = resolveFilePath(op.filePath, workDir)

    try {
      assertAllowedPath(absPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, message: `Path check failed for "${op.filePath}": ${msg}`, filesChanged }
    }

    if (op.type === "add") {
      if (existsSync(absPath)) {
        return {
          success: false,
          message: `Add File failed: "${absPath}" already exists`,
          filesChanged,
        }
      }
      try {
        mkdirSync(dirname(absPath), { recursive: true })
        writeFileSync(absPath, op.content, "utf-8")
        filesChanged.push(absPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, message: `Add File failed for "${absPath}": ${msg}`, filesChanged }
      }
      continue
    }

    if (op.type === "delete") {
      if (existsSync(absPath)) {
        try {
          unlinkSync(absPath)
          filesChanged.push(absPath)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { success: false, message: `Delete File failed for "${absPath}": ${msg}`, filesChanged }
        }
      }
      continue
    }

    if (op.type === "update") {
      if (!existsSync(absPath)) {
        return {
          success: false,
          message: `Update File failed: "${absPath}" does not exist`,
          filesChanged,
        }
      }

      let lines: string[]
      try {
        const raw = readFileSync(absPath, "utf-8")
        lines = raw.split(/\r?\n/)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, message: `Failed to read "${absPath}": ${msg}`, filesChanged }
      }

      for (const hunk of op.hunks) {
        const result = applyHunkToLines(lines, hunk)
        if (result === null) {
          const contextLines = hunk.changes
            .filter((c) => c.op === "context" || c.op === "remove")
            .map((c) => c.line)
            .slice(0, 3)
            .join(", ")
          return {
            success: false,
            message: `Hunk context not found in "${absPath}". Expected lines near: ${contextLines}`,
            filesChanged,
          }
        }
        lines = result
      }

      const tmpPath = absPath + ".nobie.tmp"
      try {
        writeFileSync(tmpPath, lines.join("\n"), "utf-8")
        renameSync(tmpPath, absPath)
        filesChanged.push(absPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        try { unlinkSync(tmpPath) } catch { /* ignore */ }
        return { success: false, message: `Failed to write "${absPath}": ${msg}`, filesChanged }
      }
      continue
    }
  }

  return {
    success: true,
    message: `Patch applied successfully. ${filesChanged.length} file(s) changed: ${filesChanged.join(", ")}`,
    filesChanged,
  }
}
